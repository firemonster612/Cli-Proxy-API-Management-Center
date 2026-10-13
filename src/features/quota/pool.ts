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
 * Pure and clock-free; React-free so tests can consume it directly.
 */

import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { normalizePlanType, PREMIUM_CODEX_PLAN_TYPES } from '@/utils/quota';
import { MINUTE_MS } from '@/utils/time/durations';
import { buildQuotaColumns, type QuotaCellData } from './columns';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

const WEEK_HOURS = 7 * 24;

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
}

export interface PoolAccount {
  key: string;
  label: string;
  authIndex: string;
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
      weight: planWeight(input.type, input.quota),
      remaining: weekly.remaining,
      fiveHourRemaining: columns?.fiveHour?.remaining ?? null,
      resetAtMs: weekly.resetAtMs,
    });
  }
  const totalWeight = accounts.reduce((sum, account) => sum + account.weight, 0);
  const counts = { provider, accounts, notLoadedCount, monthlyCount, totalWeight };
  if (totalWeight === 0) {
    return { ...counts, remainingPercent: 0, fiveHourRemainingPercent: null, resets: [] };
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
  // Accounts resetting in the same minute restore together, so they share one step.
  const resets: PoolResetStep[] = [];
  let running = remainingPercent;
  for (const account of upcoming) {
    const atMs = account.resetAtMs as number;
    const restoresPercent = share(account, 100 - account.remaining);
    running += restoresPercent;
    const last = resets[resets.length - 1];
    if (last && Math.floor(last.atMs / MINUTE_MS) === Math.floor(atMs / MINUTE_MS)) {
      last.percent = running;
      last.restoresPercent += restoresPercent;
      last.accounts.push(account);
    } else {
      resets.push({ atMs, percent: running, restoresPercent, accounts: [account] });
    }
  }

  return { ...counts, remainingPercent, fiveHourRemainingPercent, resets };
}
