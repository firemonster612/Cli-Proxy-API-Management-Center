/**
 * The "N requests in the last hour · N failed · N in flight" copy, shared by
 * the row strip, the row details and the aggregate panel. A count that may be
 * short (capped history, a truncated in-flight list) reads as "500+".
 */

import type { TFunction } from 'i18next';

export interface HistoryCounts {
  requests: number;
  failures: number;
  /** Both counts are lower bounds. */
  partial: boolean;
}

export interface RunningCount {
  count: number;
  /** Core left attempts out, so the count is a lower bound. */
  truncated: boolean;
}

const amount = (count: number, lowerBound: boolean): string =>
  lowerBound ? `${count}+` : String(count);

export const requestsCopy = (t: TFunction, { requests, partial }: HistoryCounts): string =>
  t('quota_management.routing_last_hour', { count: requests, amount: amount(requests, partial) });

/** Null when nothing failed. */
export const failuresCopy = (t: TFunction, { failures, partial }: HistoryCounts): string | null =>
  failures > 0
    ? t('quota_management.routing_failures', { count: failures, amount: amount(failures, partial) })
    : null;

export const runningCopy = (t: TFunction, { count, truncated }: RunningCount): string =>
  t('quota_management.activity_in_flight', { count, amount: amount(count, truncated) });

/** Each part is left out when null: history when core keeps none, running when not shown. */
export const activitySummary = (
  t: TFunction,
  history: HistoryCounts | null,
  running: RunningCount | null
): string =>
  [
    history && requestsCopy(t, history),
    history && failuresCopy(t, history),
    running && runningCopy(t, running),
  ]
    .filter(Boolean)
    .join(' · ');
