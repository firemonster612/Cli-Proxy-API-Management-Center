/**
 * Polls core's recent-request history while the tab is visible. A core
 * without the endpoint (404) is remembered so the board stops asking.
 */

import { useEffect, useState } from 'react';
import { quotaInsightsApi, type RecentRequest } from '@/services/api';

const POLL_MS = 20_000;

export function useRecentRequests(enabled: boolean): {
  requests: RecentRequest[];
  supported: boolean;
} {
  const [requests, setRequests] = useState<RecentRequest[]>([]);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!enabled || !supported) return;
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await quotaInsightsApi.recentRequests();
        if (!cancelled) setRequests(next);
      } catch (err: unknown) {
        // The API client rejects with { status } (services/api/client.ts).
        if (!cancelled && (err as { status?: number })?.status === 404) setSupported(false);
      }
    };
    void load();
    const timer = setInterval(load, POLL_MS);
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [enabled, supported]);

  return { requests, supported };
}
