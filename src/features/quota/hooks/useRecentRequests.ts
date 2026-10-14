/**
 * Core's recent-request history, polled while the tab is visible.
 */

import { quotaInsightsApi, type RecentRequests } from '@/services/api';
import { usePolled } from './usePolled';

const POLL_MS = 20_000;
const EMPTY: RecentRequests = { enabled: true, requests: [] };
const load = () => quotaInsightsApi.recentRequests();

export function useRecentRequests(active: boolean): RecentRequests & { supported: boolean } {
  const { data, supported } = usePolled(load, POLL_MS, active);
  return { ...(data ?? EMPTY), supported };
}
