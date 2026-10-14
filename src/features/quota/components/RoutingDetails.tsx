/**
 * Expanded under a row: what this account is doing and has served, from
 * core's in-flight list and recent-request history. Running attempts first,
 * then the last hour's model mix, then the newest requests.
 */

import { useTranslation } from 'react-i18next';
import type { InFlightAttempt } from '@/services/api';
import { failuresCopy, requestsCopy } from '../activityCopy';
import type { AccountActivity, RequestLookup } from '../routing';
import { InFlightList } from './InFlightList';
import { RequestTable } from './RequestTable';
import styles from './RoutingDetails.module.scss';

const SHOWN_REQUESTS = 12;

export function RoutingDetails({
  activity,
  inFlight,
  observedAtMs,
  lookup,
  historyEnabled,
}: {
  activity: AccountActivity | undefined;
  inFlight: InFlightAttempt[];
  observedAtMs: number;
  lookup: RequestLookup;
  /** False when core's usage statistics are off, so no routing data exists. */
  historyEnabled: boolean;
}) {
  const { t } = useTranslation();
  const running = <InFlightList attempts={inFlight} observedAtMs={observedAtMs} />;

  if (!historyEnabled || !activity) {
    return (
      <div className={styles.details}>
        {running}
        {historyEnabled
          ? t('quota_management.routing_no_requests')
          : t('quota_management.routing_history_disabled')}
      </div>
    );
  }

  const counts = {
    requests: activity.recentCount,
    failures: activity.recentFailures,
    partial: activity.partial,
  };
  const failures = failuresCopy(t, counts);
  return (
    <div className={styles.details}>
      {running}
      <div className={styles.summary}>
        <span>
          {requestsCopy(t, counts)}
          {failures && <span className={styles.failures}> · {failures}</span>}
        </span>
        <span className={styles.models}>
          {activity.models.map((entry) => (
            <span key={entry.model} className={styles.modelChip}>
              {entry.model}
              <span className={styles.modelCount}>×{entry.count}</span>
            </span>
          ))}
        </span>
      </div>

      <RequestTable requests={activity.requests.slice(0, SHOWN_REQUESTS)} lookup={lookup} />
      {activity.requests.length > SHOWN_REQUESTS && (
        <div className={styles.more}>
          {t('quota_management.routing_more', { count: activity.requests.length - SHOWN_REQUESTS })}
        </div>
      )}
    </div>
  );
}
