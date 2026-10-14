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
/** The activity strip splits ACTIVITY_WINDOW_MS into buckets of this size. */
export const ACTIVITY_BUCKET_MS = 5 * MINUTE_MS;

export interface ActivityBucket {
  count: number;
  failures: number;
}

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
  /** ACTIVITY_WINDOW_MS in ACTIVITY_BUCKET_MS slices, oldest first. */
  buckets: ActivityBucket[];
  /** Every retained request for the account, newest completion first. */
  requests: RecentRequest[];
}

/** What a request table needs to name accounts and spot retries. */
export interface RequestLookup {
  accountsByRequest: Map<string, Set<string>>;
  labelOf: (authIndex: string) => string;
}

/** Accounts other than `authIndex` that the same logged request also went to. */
export function retriedOn(request: RecentRequest, lookup: RequestLookup): string[] {
  if (!request.requestId) return [];
  const accounts = lookup.accountsByRequest.get(request.requestId);
  if (!accounts) return [];
  return [...accounts].filter((authIndex) => authIndex !== request.authIndex);
}

export const isLive = (activity: AccountActivity | undefined, nowMs: number): boolean =>
  activity !== undefined && nowMs - activity.lastAtMs <= LIVE_WINDOW_MS;

/** Requests per ACTIVITY_BUCKET_MS over the last ACTIVITY_WINDOW_MS, oldest bucket first. */
export function activityBuckets(requests: RecentRequest[], nowMs: number): ActivityBucket[] {
  const count = ACTIVITY_WINDOW_MS / ACTIVITY_BUCKET_MS;
  const buckets = Array.from({ length: count }, () => ({ count: 0, failures: 0 }));
  for (const request of requests) {
    const age = Math.max(0, nowMs - request.completedAtMs);
    const fromNewest = Math.floor(age / ACTIVITY_BUCKET_MS);
    if (fromNewest >= count) continue;
    const bucket = buckets[count - 1 - fromNewest];
    bucket.count += 1;
    if (request.failed) bucket.failures += 1;
  }
  return buckets;
}

/**
 * Every account each logged request id was sent to. Core retries a failed
 * attempt on another account under the same id, so a set of two or more is
 * one client request that moved.
 */
export function accountsByRequestId(requests: RecentRequest[]): Map<string, Set<string>> {
  const byId = new Map<string, Set<string>>();
  for (const request of requests) {
    if (!request.requestId) continue;
    const accounts = byId.get(request.requestId) ?? new Set<string>();
    accounts.add(request.authIndex);
    byId.set(request.requestId, accounts);
  }
  return byId;
}

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
        buckets: [],
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
    activity.buckets = activityBuckets(activity.requests, nowMs);
    activity.models = [...(modelCounts.get(authIndex) ?? new Map<string, number>())]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  });
  return byAccount;
}

/**
 * Per provider, the account that served the newest request, live or not
 * (check with isLive). `providerOf` maps an auth index to the board's
 * provider type; the record's own provider string differs for API-key
 * providers.
 */
export function latestRoutes(
  activity: Map<string, AccountActivity>,
  providerOf: (authIndex: string) => string | undefined
): Map<string, AccountActivity> {
  const routes = new Map<string, AccountActivity>();
  activity.forEach((entry) => {
    const provider = providerOf(entry.authIndex);
    if (!provider) return;
    const current = routes.get(provider);
    if (!current || entry.lastAtMs > current.lastAtMs) routes.set(provider, entry);
  });
  return routes;
}
