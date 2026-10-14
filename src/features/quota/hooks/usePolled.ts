/**
 * Polls a management endpoint while the tab is visible, one request at a time
 * so a slow response can't land after a newer one. A core without the
 * endpoint (404) is remembered so the board stops asking.
 */

import { useEffect, useState } from 'react';

/** The API client rejects with { status } (services/api/client.ts). */
export const isNotFound = (err: unknown): boolean =>
  (err as { status?: number } | null)?.status === 404;

export function usePolled<T>(
  /** Must be stable (useCallback); a new function restarts polling. */
  load: () => Promise<T>,
  intervalMs: number,
  active: boolean
): { data: T | null; supported: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const next = await load();
        if (!cancelled) setData(next);
      } catch (err: unknown) {
        if (!cancelled && isNotFound(err)) setSupported(false);
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, intervalMs);
    document.addEventListener('visibilitychange', poll);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [load, intervalMs, active, supported]);

  return { data, supported };
}
