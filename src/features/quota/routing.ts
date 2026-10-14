/**
 * Where requests actually went, from core's recent-request history
 * (GET /recent-requests). Each record is one completed upstream attempt, so a
 * retry that moved accounts shows up on both.
 *
 * Pure and clock-free; React-free so tests can consume it directly.
 */

import {
  RECENT_REQUESTS_MAX,
  RECENT_REQUESTS_MAX_PER_ACCOUNT,
  type InFlightAttempt,
  type RecentRequest,
} from '@/services/api';
import { MINUTE_MS } from '@/utils/time/durations';

/** An account that served a request this recently is "receiving traffic now". */
export const LIVE_WINDOW_MS = 3 * MINUTE_MS;
/** Request counts and model mix cover this window. */
export const ACTIVITY_WINDOW_MS = 60 * MINUTE_MS;
/** The activity strip splits ACTIVITY_WINDOW_MS into buckets of this size. */
export const ACTIVITY_BUCKET_MS = 5 * MINUTE_MS;
/** A retry on another account starts right after the attempt it replaces fails. */
const RETRY_GAP_MS = 2_000;

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
  /** Model of the account's newest completed request. */
  lastModel: string;
  /** Requests inside ACTIVITY_WINDOW_MS. */
  recentCount: number;
  recentFailures: number;
  /** The counts are lower bounds: core's retention cap cut the history short of the full window. */
  partial: boolean;
  /** Model mix inside ACTIVITY_WINDOW_MS, busiest first. */
  models: ModelCount[];
  /** ACTIVITY_WINDOW_MS in ACTIVITY_BUCKET_MS slices, oldest first. */
  buckets: ActivityBucket[];
  /** Every retained request for the account, newest start first (the order tables show). */
  requests: RecentRequest[];
}

/** Where a provider's traffic is going, or last went. */
export interface Route {
  authIndex: string;
  model: string;
  /** The newest completion, or the start of a newer attempt that is still running. */
  atMs: number;
  /** The route comes from an attempt still running. */
  running: boolean;
}

/** What a request table needs to name accounts and spot retries. */
export interface RequestLookup {
  requestsById: Map<string, RecentRequest[]>;
  labelOf: (authIndex: string) => string;
}

const overlapWithGap = (a: RecentRequest, b: RecentRequest): boolean =>
  a.startedAtMs <= b.completedAtMs + RETRY_GAP_MS &&
  b.startedAtMs <= a.completedAtMs + RETRY_GAP_MS;

/**
 * Other accounts the same logged request also went to. A shared request id
 * alone isn't enough: WebSocket turns reuse their connection's id, so only
 * attempts that overlap in time (or follow within RETRY_GAP_MS) count as one
 * request that moved. Two turns that run back to back within the gap can
 * still read as a retry.
 */
export function retriedOn(request: RecentRequest, lookup: RequestLookup): string[] {
  if (!request.requestId) return [];
  const others = (lookup.requestsById.get(request.requestId) ?? []).filter(
    (other) => other.authIndex !== request.authIndex && overlapWithGap(request, other)
  );
  return [...new Set(others.map((other) => other.authIndex))];
}

export const isLive = (activity: AccountActivity | undefined, nowMs: number): boolean =>
  activity !== undefined && nowMs - activity.lastAtMs <= LIVE_WINDOW_MS;

export const isRouteLive = (route: Route | undefined, nowMs: number): boolean =>
  route !== undefined && (route.running || nowMs - route.atMs <= LIVE_WINDOW_MS);

export const newestStartedFirst = (requests: RecentRequest[]): RecentRequest[] =>
  [...requests].sort((a, b) => b.startedAtMs - a.startedAtMs);

/**
 * Whether counts over ACTIVITY_WINDOW_MS are lower bounds: the history hit
 * core's retention cap and its oldest record is inside the window, so older
 * requests in the window may have been dropped.
 */
export function cutShort(requests: RecentRequest[], cap: number, nowMs: number): boolean {
  if (requests.length < cap) return false;
  const oldest = requests.reduce((min, request) => Math.min(min, request.completedAtMs), nowMs);
  return nowMs - oldest < ACTIVITY_WINDOW_MS;
}

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

/** Records grouped by logged request id; core retries a failed attempt on another account under the same id. */
export function requestsByRequestId(requests: RecentRequest[]): Map<string, RecentRequest[]> {
  const byId = new Map<string, RecentRequest[]>();
  for (const request of requests) {
    if (!request.requestId) continue;
    byId.set(request.requestId, [...(byId.get(request.requestId) ?? []), request]);
  }
  return byId;
}

export function groupActivityByAccount(
  requests: RecentRequest[],
  nowMs: number
): Map<string, AccountActivity> {
  // Records publish on completion, so completion time is what "recent" means.
  const sorted = [...requests].sort((a, b) => b.completedAtMs - a.completedAtMs);
  const globalCutShort = cutShort(requests, RECENT_REQUESTS_MAX, nowMs);
  const byAccount = new Map<string, AccountActivity>();
  const modelCounts = new Map<string, Map<string, number>>();

  for (const request of sorted) {
    let activity = byAccount.get(request.authIndex);
    if (!activity) {
      activity = {
        authIndex: request.authIndex,
        lastAtMs: request.completedAtMs,
        lastModel: request.model,
        recentCount: 0,
        recentFailures: 0,
        partial: false,
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
    activity.partial =
      globalCutShort || cutShort(activity.requests, RECENT_REQUESTS_MAX_PER_ACCOUNT, nowMs);
    activity.requests = newestStartedFirst(activity.requests);
    activity.buckets = activityBuckets(activity.requests, nowMs);
    activity.models = [...(modelCounts.get(authIndex) ?? new Map<string, number>())]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  });
  return byAccount;
}

/**
 * Per provider, the account that served the newest request, live or not
 * (check with isRouteLive). An attempt that started after that completion
 * and is still running is where traffic goes now, so it takes the route.
 * `providerOf` maps an auth index to the board's provider type; the record's
 * own provider string differs for API-key providers.
 */
export function latestRoutes(
  activity: Map<string, AccountActivity>,
  attempts: InFlightAttempt[],
  providerOf: (authIndex: string) => string | undefined
): Map<string, Route> {
  const routes = new Map<string, Route>();
  const offer = (route: Route) => {
    const provider = providerOf(route.authIndex);
    if (!provider) return;
    const current = routes.get(provider);
    if (!current || route.atMs > current.atMs) routes.set(provider, route);
  };
  activity.forEach((entry) =>
    offer({
      authIndex: entry.authIndex,
      model: entry.lastModel,
      atMs: entry.lastAtMs,
      running: false,
    })
  );
  attempts.forEach((attempt) =>
    offer({
      authIndex: attempt.authIndex,
      model: attempt.model,
      atMs: attempt.startedAtMs,
      running: true,
    })
  );
  return routes;
}
