/**
 * Where requests actually went, from core's recent-request history
 * (GET /recent-requests). Each record is one completed upstream attempt, so a
 * retry that moved accounts shows up on both.
 *
 * Pure and clock-free; React-free so tests can consume it directly.
 */

import type { RecentRequest } from '@/services/api';
import { MINUTE_MS } from '@/utils/time/durations';

/** An account that served a request this recently is "receiving traffic now". */
export const LIVE_WINDOW_MS = 3 * MINUTE_MS;
/** Request counts and model mix cover this window. */
export const ACTIVITY_WINDOW_MS = 60 * MINUTE_MS;

export interface ModelCount {
  model: string;
  count: number;
}

export interface AccountActivity {
  authIndex: string;
  /** Completion time of the account's newest request. */
  lastAtMs: number;
  /** Requests inside ACTIVITY_WINDOW_MS. */
  recentCount: number;
  recentFailures: number;
  /** Model mix inside ACTIVITY_WINDOW_MS, busiest first. */
  models: ModelCount[];
  /** Every retained request for the account, newest completion first. */
  requests: RecentRequest[];
}

export const isLive = (activity: AccountActivity | undefined, nowMs: number): boolean =>
  activity !== undefined && nowMs - activity.lastAtMs <= LIVE_WINDOW_MS;

export function groupActivityByAccount(
  requests: RecentRequest[],
  nowMs: number
): Map<string, AccountActivity> {
  // Records publish on completion, so completion time is what "recent" means.
  const sorted = [...requests].sort((a, b) => b.completedAtMs - a.completedAtMs);
  const byAccount = new Map<string, AccountActivity>();
  const modelCounts = new Map<string, Map<string, number>>();

  for (const request of sorted) {
    let activity = byAccount.get(request.authIndex);
    if (!activity) {
      activity = {
        authIndex: request.authIndex,
        lastAtMs: request.completedAtMs,
        recentCount: 0,
        recentFailures: 0,
        models: [],
        requests: [],
      };
      byAccount.set(request.authIndex, activity);
      modelCounts.set(request.authIndex, new Map());
    }
    activity.requests.push(request);
    if (nowMs - request.completedAtMs > ACTIVITY_WINDOW_MS) continue;
    activity.recentCount += 1;
    if (request.failed) activity.recentFailures += 1;
    const counts = modelCounts.get(request.authIndex) as Map<string, number>;
    counts.set(request.model, (counts.get(request.model) ?? 0) + 1);
  }

  byAccount.forEach((activity, authIndex) => {
    activity.models = [...(modelCounts.get(authIndex) ?? new Map<string, number>())]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  });
  return byAccount;
}

/**
 * Per provider, the account that served the newest request inside the live
 * window. `providerOf` maps an auth index to the board's provider type; the
 * record's own provider string differs for API-key providers.
 */
export function currentRoutes(
  activity: Map<string, AccountActivity>,
  nowMs: number,
  providerOf: (authIndex: string) => string | undefined
): Map<string, AccountActivity> {
  const routes = new Map<string, AccountActivity>();
  activity.forEach((entry) => {
    const provider = providerOf(entry.authIndex);
    if (!provider || !isLive(entry, nowMs)) return;
    const current = routes.get(provider);
    if (!current || entry.lastAtMs > current.lastAtMs) routes.set(provider, entry);
  });
  return routes;
}
