/**
 * Where a new request would go next, per provider shown on the board. A
 * provider the preview can't predict (supported=false) or a core without the
 * endpoint yields no entry, so the UI simply hides the line.
 */

import { useCallback, useMemo } from 'react';
import { quotaInsightsApi, type RoutingPreview } from '@/services/api';
import { isNotFound, usePolled } from './usePolled';

const POLL_MS = 20_000;

export function useRoutingPreviews(
  providers: readonly string[],
  active: boolean
): Map<string, RoutingPreview> {
  // A stable key, so a re-rendered array with the same providers doesn't restart polling.
  const key = providers.join(',');
  const load = useCallback(
    () =>
      Promise.all(
        key
          .split(',')
          .filter(Boolean)
          .map((provider) =>
            quotaInsightsApi.routingPreview(provider).catch((err: unknown) => {
              // A missing endpoint stops all polling; a bad provider only loses its own line.
              if (isNotFound(err)) throw err;
              return null;
            })
          )
      ),
    [key]
  );
  const { data } = usePolled(load, POLL_MS, active && key !== '');
  return useMemo(
    () =>
      new Map(
        (data ?? [])
          .filter((preview): preview is RoutingPreview => preview?.supported === true)
          .map((preview) => [preview.provider, preview])
      ),
    [data]
  );
}
