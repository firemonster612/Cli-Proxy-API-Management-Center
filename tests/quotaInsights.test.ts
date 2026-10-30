/**
 * Pool weighting and forecast, banked-reset normalization, routing activity,
 * Claude plan/organization resolution, and the long-form time copy.
 */

import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { bankedResetsFor } from '@/features/quota/bankedResets';
import { buildPoolSummary, planWeight, poolPace, type PoolAccount } from '@/features/quota/pool';
import {
  resolveClaudeOrganizationName,
  resolveClaudePlanType,
} from '@/features/quota/providers/claude/data';
import { settlePoll } from '@/features/quota/hooks/usePolled';
import {
  activityBuckets,
  groupActivityByAccount,
  isLive,
  isRouteLive,
  latestRoutes,
  requestsByRequestId,
  retriedOn,
} from '@/features/quota/routing';
import {
  formatLongDuration,
  formatResetInstant,
  formatResetInstantShort,
} from '@/features/quota/timeCopy';
import type { InFlightAttempt, RecentRequest } from '@/services/api';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 13, 12);

const claude = (weeklyUsed: number, tier: string, resetAtMs: number): ClaudeQuotaState => ({
  status: 'success',
  windows: [{ id: 'seven-day', label: '', usedPercent: weeklyUsed, resetLabel: '', resetAtMs }],
  planType: 'plan_max',
  rateLimitTier: tier,
});

describe('planWeight', () => {
  test('reads the Claude multiple from rate_limit_tier, falling back to Max 5x', () => {
    expect(planWeight('claude', claude(0, 'default_claude_max_20x', NOW))).toBe(20);
    expect(planWeight('claude', claude(0, 'default_claude_max_5x', NOW))).toBe(5);
    expect(planWeight('claude', claude(0, '', NOW))).toBe(5);
    expect(
      planWeight('claude', { ...claude(0, 'default_claude_ultra', NOW), planType: 'plan_ultra' })
    ).toBe(20);
  });

  test('maps Codex plans to their multiples', () => {
    const codex = (planType: string): CodexQuotaState => ({
      status: 'success',
      windows: [],
      planType,
    });
    expect(planWeight('codex', codex('pro'))).toBe(20);
    expect(planWeight('codex', codex('prolite'))).toBe(5);
    expect(planWeight('codex', codex('plus'))).toBe(1);
  });
});

describe('buildPoolSummary', () => {
  const inputs = [
    {
      key: 'big',
      label: 'big',
      authIndex: '1',
      type: 'claude' as const,
      quota: claude(50, 'max_20x', NOW + 30 * HOUR),
      organizationName: null,
    },
    {
      key: 'small',
      label: 'small',
      authIndex: '2',
      type: 'claude' as const,
      quota: claude(100, 'max_5x', NOW + 2 * HOUR),
      organizationName: 'Northwind Labs',
    },
    {
      key: 'idle',
      label: 'idle',
      authIndex: '3',
      type: 'claude' as const,
      quota: undefined,
      organizationName: null,
    },
  ];

  test('weights remaining capacity by plan and counts unloaded accounts', () => {
    const pool = buildPoolSummary('claude', inputs, NOW);
    // (20 * 50 + 5 * 0) / 25
    expect(pool?.remainingPercent).toBe(40);
    expect(pool?.notLoadedCount).toBe(1);
  });

  test('forecasts resets soonest first with what each gives back', () => {
    const pool = buildPoolSummary('claude', inputs, NOW);
    expect(
      pool?.resets.map((step) => [step.accounts[0].key, step.restoresPercent, step.percent])
    ).toEqual([
      ['small', 20, 60],
      ['big', 40, 100],
    ]);
  });

  test('accounts resetting within a minute restore in one step, even across a minute boundary', () => {
    const resetAt = NOW + 2 * HOUR + 59_900;
    const pool = buildPoolSummary(
      'claude',
      [
        { ...inputs[1], key: 'x', quota: claude(100, 'max_5x', resetAt) },
        { ...inputs[1], key: 'y', quota: claude(100, 'max_5x', resetAt + 20_000) },
      ],
      NOW
    );
    expect(
      pool?.resets.map((step) => [step.accounts.map((a) => a.key), step.restoresPercent])
    ).toEqual([[['x', 'y'], 100]]);
  });

  test('leaves monthly-window accounts out of the weekly pool', () => {
    const codex = (id: string, periodHours: number): CodexQuotaState => ({
      status: 'success',
      planType: 'plus',
      windows: [{ id, label: '', usedPercent: 100, resetLabel: '', periodHours }],
    });
    const pool = buildPoolSummary(
      'codex',
      [
        {
          key: 'plus',
          label: '',
          authIndex: '1',
          type: 'codex',
          quota: codex('weekly', 168),
          organizationName: null,
        },
        {
          key: 'team',
          label: '',
          authIndex: '2',
          type: 'codex',
          quota: codex('monthly', 720),
          organizationName: 'Northwind Labs',
        },
      ],
      NOW
    );
    expect(pool?.accounts.map((account) => account.key)).toEqual(['plus']);
    expect(pool?.monthlyCount).toBe(1);
  });

  test("carries each resetting account's organization for the next-reset line", () => {
    const pool = buildPoolSummary('claude', inputs, NOW);
    expect(pool?.resets[0].accounts[0].organizationName).toBe('Northwind Labs');
  });
});

describe('poolPace', () => {
  const DAY = 24 * HOUR;
  const account = (weight: number, remaining: number, resetInMs: number | null): PoolAccount => ({
    key: `${weight}-${remaining}`,
    label: '',
    authIndex: '',
    organizationName: null,
    weight,
    remaining,
    fiveHourRemaining: null,
    resetAtMs: resetInMs === null ? null : NOW + resetInMs,
  });
  const halfWeek = 3.5 * DAY;

  test('is on pace up to 5 points over the elapsed share of the week', () => {
    // Half the week gone; 55% used is the edge, 56% is ahead.
    expect(poolPace([account(1, 45, halfWeek)], NOW)?.status).toBe('on');
    expect(poolPace([account(1, 44, halfWeek)], NOW)?.status).toBe('ahead');
  });

  test('is under pace more than 15 points below', () => {
    expect(poolPace([account(1, 66, halfWeek)], NOW)?.status).toBe('under');
    expect(poolPace([account(1, 64, halfWeek)], NOW)?.status).toBe('on');
  });

  test('weights elapsed and used shares by plan', () => {
    // A 20x that just reset and is untouched, a 5x at the end of a spent week: 5/25 on both sides.
    const pace = poolPace([account(20, 100, 7 * DAY), account(5, 0, 0)], NOW);
    expect(pace?.expected).toBeCloseTo(0.2);
    expect(pace?.actual).toBeCloseTo(0.2);
    expect(pace?.status).toBe('on');
  });

  test('projects when an ahead-of-pace pool runs out at the burn so far', () => {
    // 75% used in 3.5 days; the last 25% lasts a third as long: 28 hours.
    const pace = poolPace([account(1, 25, halfWeek)], NOW);
    expect(pace?.status).toBe('ahead');
    expect(pace?.runsOutAtMs).toBe(NOW + 28 * HOUR);
  });

  test('counts an untouched account with no reset time as a week not yet started', () => {
    // A 20x at 100% left with no reset beside a 1x at 60% used, halfway through: 0.6/21 vs 0.5/21.
    const pace = poolPace([account(20, 100, null), account(1, 40, halfWeek)], NOW);
    expect(pace?.expected).toBeCloseTo(0.5 / 21);
    expect(pace?.actual).toBeCloseTo(0.6 / 21);
    expect(pace?.status).toBe('on');
  });

  test('leaves out used accounts with no reset time, and is null when no week has started', () => {
    expect(poolPace([account(1, 100, null)], NOW)).toBeNull();
    expect(poolPace([account(1, 45, halfWeek), account(20, 0, null)], NOW)?.status).toBe('on');
  });
});

describe('bankedResetsFor', () => {
  test('Codex credits sort by expiry', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: 2,
      rateLimitResetCredits: [
        { id: 'late', status: 'available', grantedAt: '', expiresAt: '2026-11-08T00:00:00Z' },
        { id: 'soon', status: 'available', grantedAt: '', expiresAt: '2026-10-14T00:00:00Z' },
      ],
    };
    const banked = bankedResetsFor('codex', quota);
    expect(banked?.available).toBe(2);
    expect(banked?.items.map((item) => item.id)).toEqual(['soon', 'late']);
  });

  test('Claude counts only usable, unpaused grants', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [],
      bankedResets: {
        grants: [
          { id: 'a', resets_left: 2, usable_now: true },
          { id: 'b', resets_left: 1, usable_now: true, paused: true },
          { id: 'c', resets_left: 0, usable_now: true },
        ],
      },
    };
    const banked = bankedResetsFor('claude', quota);
    expect(banked?.available).toBe(2);
    expect(banked?.items.map((item) => [item.id, item.usableNow, item.expiresAtMs])).toEqual([
      ['a', true, null],
      ['b', false, null],
    ]);
  });
});

describe('routing activity', () => {
  const request = (authIndex: string, agoMs: number, model: string): RecentRequest => ({
    startedAtMs: NOW - agoMs,
    completedAtMs: NOW - agoMs,
    provider: 'claude',
    authIndex,
    model,
    failed: false,
    statusCode: null,
    latencyMs: null,
    inputTokens: null,
    outputTokens: null,
    requestId: null,
    clientKeyLabel: null,
    clientKeyFingerprint: null,
    userAgent: null,
    clientIp: null,
  });
  const MINUTE = 60_000;

  test('groups per account with a model mix, and routes to the newest account', () => {
    const activity = groupActivityByAccount(
      [
        request('1', 30_000, 'opus'),
        request('1', 90_000, 'opus'),
        request('1', 120_000, 'sonnet'),
        request('2', 10 * 60_000, 'opus'),
      ],
      NOW
    );
    expect(activity.get('1')?.models).toEqual([
      { model: 'opus', count: 2 },
      { model: 'sonnet', count: 1 },
    ]);
    const routes = latestRoutes(activity, null, () => 'claude');
    expect(routes.get('claude')?.authIndex).toBe('1');
  });

  test('keeps the last route when nothing is live, so the board can say where traffic last went', () => {
    const activity = groupActivityByAccount(
      [request('1', 40 * MINUTE, 'opus'), request('2', 23 * MINUTE, 'opus')],
      NOW
    );
    const route = latestRoutes(activity, null, () => 'claude').get('claude');
    expect(route?.authIndex).toBe('2');
    expect(isRouteLive(route, NOW)).toBe(false);
  });

  test('an attempt running since after the newest completion is the live route', () => {
    const activity = groupActivityByAccount([request('1', 10 * MINUTE, 'opus')], NOW);
    const running = (authIndex: string, agoMs: number): InFlightAttempt => ({
      attemptId: authIndex,
      requestId: null,
      provider: 'claude',
      authIndex,
      model: 'sonnet',
      kind: 'stream',
      startedAtMs: NOW - agoMs,
    });
    const snapshot = (attempt: InFlightAttempt) => ({ attempts: [attempt], observedAtMs: NOW });
    const route = latestRoutes(activity, snapshot(running('2', 4 * MINUTE)), () => 'claude').get(
      'claude'
    );
    // A running route keeps the snapshot clock, so its age isn't measured against a stale page clock.
    expect(route).toMatchObject({
      authIndex: '2',
      model: 'sonnet',
      running: true,
      observedAtMs: NOW,
    });
    expect(isRouteLive(route, NOW)).toBe(true);
    // Started before the newest completion: the completed request stays the route.
    const older = latestRoutes(activity, snapshot(running('2', 20 * MINUTE)), () => 'claude').get(
      'claude'
    );
    expect(older?.authIndex).toBe('1');
  });

  test('buckets the last hour into twelve five-minute slices, oldest first, failures counted', () => {
    const failed = { ...request('1', 2 * MINUTE, 'opus'), failed: true };
    const buckets = activityBuckets(
      [
        request('1', 1 * MINUTE, 'opus'),
        failed,
        request('1', 7 * MINUTE, 'opus'),
        request('1', 61 * MINUTE, 'opus'),
      ],
      NOW
    );
    expect(buckets).toHaveLength(12);
    expect(buckets[11]).toEqual({ count: 2, failures: 1 });
    expect(buckets[10]).toEqual({ count: 1, failures: 0 });
    expect(buckets.slice(0, 10).every((bucket) => bucket.count === 0)).toBe(true);
  });

  test('finds the other accounts a retried request went to', () => {
    // The first attempt fails after 20s; the retry starts half a second later.
    const first = {
      ...request('2', 3 * MINUTE, 'opus'),
      completedAtMs: NOW - 3 * MINUTE + 20_000,
      requestId: 'ab12cd34',
      failed: true,
    };
    const retry = {
      ...request('1', 3 * MINUTE - 20_500, 'opus'),
      completedAtMs: NOW - MINUTE,
      requestId: 'ab12cd34',
    };
    const alone = { ...request('1', MINUTE, 'opus'), requestId: 'ffff0000' };
    const lookup = {
      requestsById: requestsByRequestId([first, retry, alone]),
      labelOf: (authIndex: string) => authIndex,
    };
    expect(retriedOn(retry, lookup)).toEqual(['2']);
    expect(retriedOn(first, lookup)).toEqual(['1']);
    expect(retriedOn(alone, lookup)).toEqual([]);
    expect(retriedOn(request('1', MINUTE, 'opus'), lookup)).toEqual([]);
  });

  test('turns of one WebSocket session that share an id but not a time are not retries', () => {
    const turn1 = { ...request('2', 5 * MINUTE, 'opus'), requestId: 'ws000001' };
    const turn2 = { ...request('1', 2 * MINUTE, 'opus'), requestId: 'ws000001' };
    const lookup = {
      requestsById: requestsByRequestId([turn1, turn2]),
      labelOf: (authIndex: string) => authIndex,
    };
    expect(retriedOn(turn2, lookup)).toEqual([]);
  });

  test('counts are lower bounds when a capped history starts inside the hour', () => {
    // 200 requests for one account across the last 40 minutes: the per-account cap.
    const capped = Array.from({ length: 200 }, (_, i) => request('1', i * 12_000, 'opus'));
    const spread = [...capped.slice(1), request('1', 61 * MINUTE, 'opus')];
    expect(groupActivityByAccount(capped, NOW).get('1')?.partial).toBe(true);
    // Same count, but the oldest record is older than the hour: the hour is complete.
    expect(groupActivityByAccount(spread, NOW).get('1')?.partial).toBe(false);
    // Under the cap: complete however recent.
    expect(groupActivityByAccount(capped.slice(1), NOW).get('1')?.partial).toBe(false);
  });

  test('a global cap inside the hour makes every account partial', () => {
    const full = Array.from({ length: 2000 }, (_, i) => request(String(i % 20), i * 1_000, 'opus'));
    const activity = groupActivityByAccount(full, NOW);
    expect(activity.get('7')?.recentCount).toBe(100);
    expect(activity.get('7')?.partial).toBe(true);
  });

  test("tables list an account's requests by start time", () => {
    const longRun = { ...request('1', 10 * MINUTE, 'opus'), completedAtMs: NOW - 10_000 };
    const quick = request('1', 2 * MINUTE, 'sonnet');
    const activity = groupActivityByAccount([longRun, quick], NOW).get('1');
    expect(activity?.requests.map((entry) => entry.model)).toEqual(['sonnet', 'opus']);
    expect(activity?.lastModel).toBe('opus');
  });

  test('a long request is live when it completes, not when it started', () => {
    const longRun = { ...request('1', 10 * 60_000, 'opus'), completedAtMs: NOW - 30_000 };
    const activity = groupActivityByAccount([longRun], NOW);
    expect(activity.get('1')?.lastAtMs).toBe(NOW - 30_000);
    expect(isLive(activity.get('1'), NOW)).toBe(true);
  });
});

describe('settlePoll', () => {
  test('a 404 after a successful poll drops the earlier data and stops polling', () => {
    const initial = { data: null, supported: true, failed: false };
    const loaded = settlePoll(initial, { data: ['preview'] });
    expect(loaded).toEqual({ data: ['preview'], supported: true, failed: false });
    expect(settlePoll(loaded, { error: { status: 404 } })).toEqual({
      data: null,
      supported: false,
      failed: true,
    });
  });

  test('another failure keeps the data but marks it failed', () => {
    const loaded = settlePoll({ data: null, supported: true, failed: false }, { data: 1 });
    expect(settlePoll(loaded, { error: { status: 500 } })).toEqual({
      data: 1,
      supported: true,
      failed: true,
    });
    expect(settlePoll(loaded, { error: new Error('network') }).failed).toBe(true);
  });
});

describe('Claude profile', () => {
  const profile = (tier: string, organizationType: string) => ({
    account: { has_claude_max: true },
    organization: {
      name: 'Northwind Labs',
      organization_type: organizationType,
      rate_limit_tier: tier,
    },
  });

  test('maps Max 20x to Ultra and Max 5x to Max', () => {
    expect(resolveClaudePlanType(profile('default_claude_max_5x', 'claude_max'))).toBe('plan_max');
    expect(resolveClaudePlanType(profile('default_claude_max_20x', 'claude_max'))).toBe(
      'plan_ultra'
    );
    expect(resolveClaudePlanType(profile('', 'claude_max'))).toBe('plan_max');
  });

  test('recognizes Ultra under the names the profile may switch to', () => {
    expect(resolveClaudePlanType(profile('default_claude_ultra', 'claude_max'))).toBe('plan_ultra');
    expect(resolveClaudePlanType(profile('', 'claude_ultra'))).toBe('plan_ultra');
    expect(resolveClaudePlanType({ account: { has_claude_ultra: true }, organization: {} })).toBe(
      'plan_ultra'
    );
  });

  test('names only Team and Enterprise organizations', () => {
    expect(resolveClaudeOrganizationName(profile('', 'claude_team'))).toBe('Northwind Labs');
    expect(resolveClaudeOrganizationName(profile('', 'claude_enterprise'))).toBe('Northwind Labs');
    expect(resolveClaudeOrganizationName(profile('', 'claude_max'))).toBeNull();
  });
});

describe('formatLongDuration', () => {
  const t = ((key: string, options?: { count?: number }) => {
    const unit = key.split('_').pop();
    return `${options?.count} ${unit}${options?.count === 1 ? '' : 's'}`;
  }) as unknown as TFunction;

  test('keeps the two largest units', () => {
    expect(formatLongDuration(31 * HOUR + 12 * 60_000, t)).toBe('1 day, 7 hours');
    expect(formatLongDuration(3 * HOUR + 5 * 60_000, t)).toBe('3 hours, 5 minutes');
    expect(formatLongDuration(20_000, t)).toBe('1 minute');
  });
});

describe('formatResetInstant', () => {
  test('is English weekday, day before month and 12-hour clock in the local zone', () => {
    // Local-time constructor, so the expectation holds in any time zone.
    expect(formatResetInstant(new Date(2026, 9, 15, 4, 12).getTime())).toBe('Thu, 15 Oct, 4:12 AM');
  });

  test('has a short numeric-date variant for the bar cells that never splits the clock', () => {
    expect(formatResetInstantShort(new Date(2026, 9, 15, 17, 34).getTime())).toBe(
      'Thu, 15/10, 5:34\u00a0PM'
    );
  });
});
