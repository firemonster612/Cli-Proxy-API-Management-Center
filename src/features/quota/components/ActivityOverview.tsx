/**
 * Every account's traffic in one place, above the board. Collapsed it is one
 * line (requests in the last hour, failures, running now); open it shows an
 * activity strip per provider, what is running, and the newest requests
 * across accounts, so a request that went somewhere unexpected stands out.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronDown } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { InFlightRequests, RecentRequest } from '@/services/api';
import type { ResolvedTheme } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { ACTIVITY_WINDOW_MS, activityBuckets, type RequestLookup } from '../routing';
import { ActivityStrip } from './ActivityStrip';
import { InFlightList } from './InFlightList';
import { RequestTable } from './RequestTable';
import styles from './ActivityOverview.module.scss';

const SHOWN_REQUESTS = 20;

export function ActivityOverview({
  requests,
  inFlight,
  lookup,
  providerOf,
  historyEnabled,
  resolvedTheme,
}: {
  /** Newest completion first. */
  requests: RecentRequest[];
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

  const recent = useMemo(
    () => requests.filter((request) => now - request.completedAtMs <= ACTIVITY_WINDOW_MS),
    [requests, now]
  );
  const failures = recent.filter((request) => request.failed).length;

  const providers = useMemo(() => {
    const byProvider = new Map<string, { requests: RecentRequest[]; running: number }>();
    const entryFor = (provider: string) => {
      const entry = byProvider.get(provider) ?? { requests: [], running: 0 };
      byProvider.set(provider, entry);
      return entry;
    };
    recent.forEach((request) =>
      entryFor(providerOf(request.authIndex) ?? request.provider).requests.push(request)
    );
    attempts.forEach((attempt) => {
      entryFor(providerOf(attempt.authIndex) ?? attempt.provider).running += 1;
    });
    return [...byProvider]
      .map(([provider, entry]) => ({
        provider,
        running: entry.running,
        count: entry.requests.length,
        failures: entry.requests.filter((request) => request.failed).length,
        buckets: activityBuckets(entry.requests, now),
      }))
      .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));
  }, [recent, attempts, providerOf, now]);

  const summary = historyEnabled
    ? [
        t('quota_management.routing_last_hour', { count: recent.length }),
        failures > 0 ? t('quota_management.routing_failures', { count: failures }) : null,
        t('quota_management.activity_in_flight', { count: attempts.length }),
      ]
        .filter(Boolean)
        .join(' · ')
    : t('quota_management.routing_history_disabled');

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
          {failures > 0 && <span className={styles.failureMark} aria-hidden="true" />}
        </span>
      </button>

      {open && (
        <div className={styles.body}>
          {providers.length > 0 && (
            <div className={styles.providers}>
              {providers.map((entry) => {
                const icon = getAuthFileIcon(entry.provider, resolvedTheme);
                return (
                  <div key={entry.provider} className={styles.providerRow}>
                    <span className={styles.providerName}>
                      {icon && <img src={icon} alt="" className={styles.icon} />}
                      {getTypeLabel(t, entry.provider)}
                    </span>
                    <ActivityStrip buckets={entry.buckets} inFlight={entry.running} />
                    <span className={styles.providerCount}>
                      {t('quota_management.routing_last_hour', { count: entry.count })}
                      {entry.failures > 0 && (
                        <span className={styles.failures}>
                          {' · '}
                          {t('quota_management.routing_failures', { count: entry.failures })}
                        </span>
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

          {requests.length > 0 ? (
            <RequestTable
              requests={requests.slice(0, SHOWN_REQUESTS)}
              lookup={lookup}
              showAccount
            />
          ) : (
            <div className={styles.empty}>{t('quota_management.activity_none')}</div>
          )}
        </div>
      )}
    </section>
  );
}
