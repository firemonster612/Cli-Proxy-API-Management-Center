/**
 * Every account's traffic in one place, above the board. Collapsed it is one
 * line (requests in the last hour, failures, running now); open it shows an
 * activity strip per provider, what is running, and the newest requests
 * across accounts, so a request that went somewhere unexpected stands out.
 * Running attempts show even with usage statistics off; only the history
 * needs them.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { InFlightRequests, RecentRequest } from '@/services/api';
import type { ResolvedTheme } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { activitySummary, failuresCopy, requestsCopy } from '../activityCopy';
import {
  ACTIVITY_WINDOW_MS,
  activityBuckets,
  newestStartedFirst,
  type AccountActivity,
  type RequestLookup,
} from '../routing';
import { ActivityStrip } from './ActivityStrip';
import { InFlightList } from './InFlightList';
import { RequestTable } from './RequestTable';
import styles from './ActivityOverview.module.scss';

const SHOWN_REQUESTS = 20;

export function ActivityOverview({
  requests,
  activityByAuth,
  inFlight,
  lookup,
  providerOf,
  historyEnabled,
  resolvedTheme,
}: {
  requests: RecentRequest[];
  /** Per-account activity, for whether an account's history was cut short. */
  activityByAuth: Map<string, AccountActivity>;
  inFlight: InFlightRequests | null;
  lookup: RequestLookup;
  /** The board's provider for an account; records from other accounts keep their own. */
  providerOf: (authIndex: string) => string | undefined;
  historyEnabled: boolean;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const attempts = useMemo(() => inFlight?.attempts ?? [], [inFlight]);
  const truncated = inFlight?.truncated ?? false;
  const isPartial = useCallback(
    (authIndex: string) => activityByAuth.get(authIndex)?.partial ?? false,
    [activityByAuth]
  );

  const recent = useMemo(
    () => requests.filter((request) => now - request.completedAtMs <= ACTIVITY_WINDOW_MS),
    [requests, now]
  );
  const history = {
    requests: recent.length,
    failures: recent.filter((request) => request.failed).length,
    // Only an account whose retained history lies inside the hour can be cut short.
    partial: recent.some((request) => isPartial(request.authIndex)),
  };
  const newest = useMemo(() => newestStartedFirst(requests).slice(0, SHOWN_REQUESTS), [requests]);

  const providers = useMemo(() => {
    const byProvider = new Map<
      string,
      { requests: RecentRequest[]; running: number; partial: boolean }
    >();
    const entryFor = (provider: string) => {
      const entry = byProvider.get(provider) ?? { requests: [], running: 0, partial: false };
      byProvider.set(provider, entry);
      return entry;
    };
    recent.forEach((request) => {
      const entry = entryFor(providerOf(request.authIndex) ?? request.provider);
      entry.requests.push(request);
      entry.partial ||= isPartial(request.authIndex);
    });
    attempts.forEach((attempt) => {
      entryFor(providerOf(attempt.authIndex) ?? attempt.provider).running += 1;
    });
    return [...byProvider]
      .map(([provider, entry]) => ({
        provider,
        running: entry.running,
        history: {
          requests: entry.requests.length,
          failures: entry.requests.filter((request) => request.failed).length,
          partial: entry.partial,
        },
        buckets: activityBuckets(entry.requests, now),
      }))
      .sort(
        (a, b) =>
          b.history.requests - a.history.requests ||
          b.running - a.running ||
          a.provider.localeCompare(b.provider)
      );
  }, [recent, attempts, providerOf, isPartial, now]);

  const running = { count: attempts.length, truncated };
  const summary = historyEnabled
    ? activitySummary(t, history, running)
    : `${activitySummary(t, null, running)} · ${t('quota_management.routing_history_disabled')}`;

  return (
    <section className={styles.overview}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <IconChevronDown
          size={14}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        />
        <span className={styles.title}>{t('quota_management.activity_title')}</span>
        <span className={styles.summary}>
          {summary}
          {historyEnabled && history.failures > 0 && (
            <span className={styles.failureMark} aria-hidden="true" />
          )}
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          {providers.length > 0 && (
            <div className={styles.providers}>
              {providers.map((entry) => {
                const icon = getAuthFileIcon(entry.provider, resolvedTheme);
                const failures = failuresCopy(t, entry.history);
                return (
                  <div key={entry.provider} className={styles.providerRow}>
                    <span className={styles.providerName}>
                      {icon && <img src={icon} alt="" className={styles.icon} />}
                      {getTypeLabel(t, entry.provider)}
                    </span>
                    <ActivityStrip
                      buckets={historyEnabled ? entry.buckets : null}
                      partial={entry.history.partial}
                      running={{ count: entry.running, truncated }}
                    />
                    <span className={styles.providerCount}>
                      {historyEnabled && requestsCopy(t, entry.history)}
                      {historyEnabled && failures && (
                        <span className={styles.failures}> · {failures}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {inFlight && (
            <InFlightList
              attempts={attempts}
              observedAtMs={inFlight.observedAtMs}
              labelOf={lookup.labelOf}
            />
          )}

          {!historyEnabled ? (
            <div className={styles.empty}>{t('quota_management.routing_history_disabled')}</div>
          ) : newest.length > 0 ? (
            <RequestTable requests={newest} lookup={lookup} showAccount />
          ) : (
            <div className={styles.empty}>{t('quota_management.activity_none')}</div>
          )}
        </div>
      )}
    </section>
  );
}
