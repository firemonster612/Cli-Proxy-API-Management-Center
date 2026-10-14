/**
 * Pool weighting and forecast, banked-reset normalization, routing activity,
 * Claude plan/organization resolution, and the long-form time copy.
 */

import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { bankedResetsFor } from '@/features/quota/bankedResets';
import { buildPoolSummary, planWeight } from '@/features/quota/pool';
import {
  resolveClaudeOrganizationName,
  resolveClaudePlanType,
} from '@/features/quota/providers/claude/data';
import { currentRoutes, groupActivityByAccount, isLive } from '@/features/quota/routing';
import {
  formatLongDuration,
  formatResetInstant,
  formatResetInstantShort,
} from '@/features/quota/timeCopy';
import type { RecentRequest } from '@/services/api';
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
    },
    {
      key: 'small',
      label: 'small',
      authIndex: '2',
      type: 'claude' as const,
      quota: claude(100, 'max_5x', NOW + 2 * HOUR),
    },
    { key: 'idle', label: 'idle', authIndex: '3', type: 'claude' as const, quota: undefined },
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
        { key: 'plus', label: '', authIndex: '1', type: 'codex', quota: codex('weekly', 168) },
        { key: 'team', label: '', authIndex: '2', type: 'codex', quota: codex('monthly', 720) },
      ],
      NOW
    );
    expect(pool?.accounts.map((account) => account.key)).toEqual(['plus']);
    expect(pool?.monthlyCount).toBe(1);
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
  });

  test('groups per account with a model mix, and routes to the newest live account', () => {
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
    const routes = currentRoutes(activity, NOW, () => 'claude');
    expect(routes.get('claude')?.authIndex).toBe('1');
  });

  test('a long request is live when it completes, not when it started', () => {
    const longRun = { ...request('1', 10 * 60_000, 'opus'), completedAtMs: NOW - 30_000 };
    const activity = groupActivityByAccount([longRun], NOW);
    expect(activity.get('1')?.lastAtMs).toBe(NOW - 30_000);
    expect(isLive(activity.get('1'), NOW)).toBe(true);
  });
});

describe('Claude profile', () => {
  const profile = (tier: string, organizationType: string) => ({
    account: { has_claude_max: true },
    organization: { name: 'Northwind Labs', organization_type: organizationType, rate_limit_tier: tier },
  });

  test('maps the Max tier to plan_max5 / plan_max20', () => {
    expect(resolveClaudePlanType(profile('default_claude_max_5x', 'claude_max'))).toBe('plan_max5');
    expect(resolveClaudePlanType(profile('default_claude_max_20x', 'claude_max'))).toBe(
      'plan_max20'
    );
    expect(resolveClaudePlanType(profile('', 'claude_max'))).toBe('plan_max');
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
  test('is American weekday, date and 12-hour clock in the local zone', () => {
    // Local-time constructor, so the expectation holds in any time zone.
    expect(formatResetInstant(new Date(2026, 9, 15, 4, 12).getTime())).toBe('Thu, Oct 15, 4:12 AM');
  });

  test('has a short numeric-date variant for the bar cells that never splits the clock', () => {
    expect(formatResetInstantShort(new Date(2026, 9, 15, 17, 34).getTime())).toBe(
      'Thu, 10/15, 5:34\u00a0PM'
    );
  });
});
