/**
 * Polls core's recent-request history while the tab is visible. A core
 * without the endpoint (404) is remembered so the board stops asking.
 */

import { useEffect, useState } from 'react';
import { quotaInsightsApi, type RecentRequests } from '@/services/api';

const POLL_MS = 20_000;
const EMPTY: RecentRequests = { enabled: true, requests: [] };

export function useRecentRequests(active: boolean): RecentRequests & { supported: boolean } {
  const [history, setHistory] = useState<RecentRequests>(EMPTY);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;
    // One request at a time, so a slow response can't land after a newer one.
    let inFlight = false;
    const load = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const next = await quotaInsightsApi.recentRequests();
        if (!cancelled) setHistory(next);
      } catch (err: unknown) {
        // The API client rejects with { status } (services/api/client.ts).
        if (!cancelled && (err as { status?: number })?.status === 404) setSupported(false);
      } finally {
        inFlight = false;
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
  }, [active, supported]);

  return { ...history, supported };
}
