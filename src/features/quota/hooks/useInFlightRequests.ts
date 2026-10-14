/**
 * Upstream attempts running right now. Polled faster than the history so
 * "running 42s" stays close to true. Null when core lacks the endpoint or the
 * last poll failed: a stale list would claim something is still running.
 */

import { quotaInsightsApi, type InFlightRequests } from '@/services/api';
import { usePolled } from './usePolled';

const POLL_MS = 5_000;
const load = () => quotaInsightsApi.inFlightRequests();

export function useInFlightRequests(active: boolean): InFlightRequests | null {
  const { data, failed } = usePolled(load, POLL_MS, active);
  return failed ? null : data;
}
