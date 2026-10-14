/**
 * Pooled weekly capacity per provider.
 *
 * Each account counts in proportion to its subscription multiplier (Max 20x
 * counts four times a Max 5x), so "62% of the pool left" means 62% of the
 * combined weekly capacity, not the average of the bars. The multipliers are
 * the advertised plan multiples, not measured limits, so the UI labels the
 * total as an estimate and shows each account's weight.
 *
 * The pool is weekly only: accounts on a monthly window (Codex Team) are
 * counted separately rather than mixed into weekly capacity.
 *
 * Pace compares how much of the pool is used with how much of each account's
 * weekly window has passed, both weighted the same way.
 *
 * Pure and clock-free; React-free so tests can consume it directly.
 */

import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/utils/quota';
import { DAY_MS, MINUTE_MS } from '@/utils/time/durations';
import { buildQuotaColumns, type QuotaCellData } from './columns';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

const WEEK_HOURS = 7 * 24;
const WEEK_MS = 7 * DAY_MS;
/** Up to this much more used than elapsed still counts as on pace. */
const PACE_AHEAD_SLACK = 0.05;
/** This much less used than elapsed counts as under pace. */
const PACE_UNDER_SLACK = 0.15;

/** Multiplier in units of the provider's base paid plan (Claude Pro, ChatGPT Plus). */
export function planWeight(type: QuotaProviderType, quota: QuotaCardState | undefined): number {
  if (!quota || quota.status !== 'success') return 1;
  if (type === 'claude') {
    const claude = quota as ClaudeQuotaState;
    const multiple = /(\d+)x\b/i.exec(claude.rateLimitTier ?? '');
    if (multiple) return Number(multiple[1]);
    return claude.planType === 'plan_max' ? 5 : 1;
  }
  if (type === 'codex') {
    const plan = normalizePlanType((quota as CodexQuotaState).planType);
    if (plan === 'pro') return 20;
    if (plan && PREMIUM_CODEX_PLAN_TYPES.has(plan)) return 5;
  }
  return 1;
}

export const isWeeklySpent = (cell: QuotaCellData | null): boolean =>
  cell !== null && cell.remaining !== null && cell.remaining <= 0;

const isMonthlyWindow = (cell: QuotaCellData): boolean =>
  cell.periodHours !== null && cell.periodHours > WEEK_HOURS;

export interface PoolAccountInput {
  key: string;
  label: string;
  authIndex: string;
  type: QuotaProviderType;
  quota: QuotaCardState | undefined;
  /** Team/Enterprise organization; null for personal accounts. */
  organizationName: string | null;
}

export interface PoolAccount {
  key: string;
  label: string;
  authIndex: string;
  organizationName: string | null;
  weight: number;
  /** Weekly percent left, 0..100. */
  remaining: number;
  /** Five-hour percent left, when the account has that window. */
  fiveHourRemaining: number | null;
  resetAtMs: number | null;
}

export interface PoolResetStep {
  atMs: number;
  /** Pool percent left right after this reset, assuming no further use. */
  percent: number;
  /** How much of the pool this reset gives back. */
  restoresPercent: number;
  /** Every account resetting in this minute. */
  accounts: PoolAccount[];
}

export interface PoolSummary {
  provider: QuotaProviderType;
  accounts: PoolAccount[];
  /** Accounts whose weekly window hasn't loaded or failed to; the total leaves them out. */
  notLoadedCount: number;
  /** Accounts on a monthly window, left out of the weekly pool. */
  monthlyCount: number;
  totalWeight: number;
  remainingPercent: number;
  fiveHourRemainingPercent: number | null;
  /** Upcoming resets that give capacity back, soonest first. */
  resets: PoolResetStep[];
  /** Null when no account reports when its week resets. */
  pace: PoolPace | null;
}

export interface PoolPace {
  /** Weighted share of the accounts' weekly windows already elapsed, 0..1. */
  expected: number;
  /** Weighted share of the pool already used, 0..1. */
  actual: number;
  status: 'on' | 'under' | 'ahead';
  /** When the pool runs dry at the burn so far; only when ahead of pace. */
  runsOutAtMs: number | null;
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Accounts without a reset time are left out: without it there is no way to
 * tell how far into its week an account is.
 */
export function poolPace(accounts: PoolAccount[], nowMs: number): PoolPace | null {
  const timed = accounts.filter((account) => account.resetAtMs !== null);
  const totalWeight = timed.reduce((sum, account) => sum + account.weight, 0);
  if (totalWeight === 0) return null;

  let expected = 0;
  let actual = 0;
  for (const account of timed) {
    const elapsed = clampUnit(1 - ((account.resetAtMs as number) - nowMs) / WEEK_MS);
    const used = clampUnit((100 - account.remaining) / 100);
    expected += (account.weight * elapsed) / totalWeight;
    actual += (account.weight * used) / totalWeight;
  }

  if (actual < expected - PACE_UNDER_SLACK) {
    return { expected, actual, status: 'under', runsOutAtMs: null };
  }
  if (actual <= expected + PACE_AHEAD_SLACK) {
    return { expected, actual, status: 'on', runsOutAtMs: null };
  }
  // Pool burn per elapsed millisecond so far, carried over what's left.
  const elapsedMs = expected * WEEK_MS;
  const runsOutAtMs = elapsedMs > 0 ? nowMs + ((1 - actual) * elapsedMs) / actual : null;
  return { expected, actual, status: 'ahead', runsOutAtMs };
}

export function buildPoolSummary(
  provider: QuotaProviderType,
  inputs: PoolAccountInput[],
  nowMs: number
): PoolSummary | null {
  if (inputs.length === 0) return null;
  const accounts: PoolAccount[] = [];
  let notLoadedCount = 0;
  let monthlyCount = 0;
  for (const input of inputs) {
    const columns = buildQuotaColumns(input.type, input.quota);
    const weekly = columns?.weekly;
    if (!weekly || weekly.remaining === null) {
      notLoadedCount += 1;
      continue;
    }
    if (isMonthlyWindow(weekly)) {
      monthlyCount += 1;
      continue;
    }
    accounts.push({
      key: input.key,
      label: input.label,
      authIndex: input.authIndex,
      organizationName: input.organizationName,
      weight: planWeight(input.type, input.quota),
      remaining: weekly.remaining,
      fiveHourRemaining: columns?.fiveHour?.remaining ?? null,
      resetAtMs: weekly.resetAtMs,
    });
  }
  const totalWeight = accounts.reduce((sum, account) => sum + account.weight, 0);
  const counts = { provider, accounts, notLoadedCount, monthlyCount, totalWeight };
  if (totalWeight === 0) {
    return {
      ...counts,
      remainingPercent: 0,
      fiveHourRemainingPercent: null,
      resets: [],
      pace: null,
    };
  }

  const share = (account: PoolAccount, percent: number) => (account.weight * percent) / totalWeight;
  const remainingPercent = accounts.reduce(
    (sum, account) => sum + share(account, account.remaining),
    0
  );

  // An account's five-hour window can't hand out more than its weekly window has left.
  const withFiveHour = accounts.filter((account) => account.fiveHourRemaining !== null);
  const fiveHourRemainingPercent =
    withFiveHour.length === 0
      ? null
      : accounts.reduce(
          (sum, account) =>
            sum +
            share(
              account,
              Math.min(account.remaining, account.fiveHourRemaining ?? account.remaining)
            ),
          0
        );

  const upcoming = accounts
    .filter(
      (account) =>
        account.resetAtMs !== null && account.resetAtMs > nowMs && account.remaining < 100
    )
    .sort((a, b) => (a.resetAtMs as number) - (b.resetAtMs as number));
  // Accounts resetting within a minute of each other restore together, so they share one step.
  const resets: PoolResetStep[] = [];
  let running = remainingPercent;
  for (const account of upcoming) {
    const atMs = account.resetAtMs as number;
    const restoresPercent = share(account, 100 - account.remaining);
    running += restoresPercent;
    const last = resets[resets.length - 1];
    // Measured from the step's first reset, so a chain of resets can't creep forward.
    if (last && atMs - last.atMs < MINUTE_MS) {
      last.percent = running;
      last.restoresPercent += restoresPercent;
      last.accounts.push(account);
    } else {
      resets.push({ atMs, percent: running, restoresPercent, accounts: [account] });
    }
  }

  return {
    ...counts,
    remainingPercent,
    fiveHourRemainingPercent,
    resets,
    pace: poolPace(accounts, nowMs),
  };
}
