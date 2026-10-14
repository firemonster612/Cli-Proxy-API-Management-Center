/**
 * Polls a management endpoint while the tab is visible, one request at a time
 * so a slow response can't land after a newer one. A core without the
 * endpoint (404) is remembered so the board stops asking.
 */

import { useEffect, useState } from 'react';

/** The API client rejects with { status } (services/api/client.ts). */
export const isNotFound = (err: unknown): boolean =>
  (err as { status?: number } | null)?.status === 404;

export interface Polled<T> {
  data: T | null;
  supported: boolean;
  /** The last poll failed; `data` is what an earlier poll returned. */
  failed: boolean;
}

const INITIAL_POLL = { data: null, supported: true, failed: false } as const;

/**
 * State after one poll. A 404 drops what earlier polls returned, so nothing
 * from an endpoint core no longer serves stays on screen.
 */
export function settlePoll<T>(
  prev: Polled<T>,
  outcome: { data: T } | { error: unknown }
): Polled<T> {
  if ('data' in outcome) return { data: outcome.data, supported: true, failed: false };
  if (isNotFound(outcome.error)) return { data: null, supported: false, failed: true };
  return { ...prev, failed: true };
}

export function usePolled<T>(
  /** Must be stable (useCallback); a new function restarts polling. */
  load: () => Promise<T>,
  intervalMs: number,
  active: boolean
): Polled<T> {
  const [state, setState] = useState<Polled<T>>(INITIAL_POLL);
  const { supported } = state;

  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const data = await load();
        if (!cancelled) setState((prev) => settlePoll(prev, { data }));
      } catch (error: unknown) {
        if (!cancelled) setState((prev) => settlePoll(prev, { error }));
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

  return state;
}
