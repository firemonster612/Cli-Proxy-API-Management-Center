/**
 * Upstream attempts running right now. Polled faster than the history so
 * "running 42s" stays close to true; an empty list when core lacks the endpoint.
 */

import { quotaInsightsApi, type InFlightRequests } from '@/services/api';
import { usePolled } from './usePolled';

const POLL_MS = 5_000;
const load = () => quotaInsightsApi.inFlightRequests();

export function useInFlightRequests(active: boolean): InFlightRequests | null {
  return usePolled(load, POLL_MS, active).data;
}
