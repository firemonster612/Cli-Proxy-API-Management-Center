/**
 * The last hour of requests as twelve five-minute bars, oldest on the left.
 * Failures stack on top in the danger color; running attempts get a count
 * beside the bars.
 */

import { useTranslation } from 'react-i18next';
import type { ActivityBucket } from '../routing';
import styles from './ActivityStrip.module.scss';

/** Below this many requests per bucket the bars scale as if this many, so a trickle looks like one. */
const MIN_SCALE = 4;

export function ActivityStrip({
  buckets,
  inFlight = 0,
}: {
  buckets: ActivityBucket[];
  inFlight?: number;
}) {
  const { t } = useTranslation();
  const total = buckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const failures = buckets.reduce((sum, bucket) => sum + bucket.failures, 0);
  const scale = Math.max(MIN_SCALE, ...buckets.map((bucket) => bucket.count));
  const label = [
    t('quota_management.routing_last_hour', { count: total }),
    failures > 0 ? t('quota_management.routing_failures', { count: failures }) : null,
    inFlight > 0 ? t('quota_management.routing_running_count', { count: inFlight }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span className={styles.strip} title={label} aria-label={label} role="img">
      <span className={styles.bars} aria-hidden="true">
        {buckets.map((bucket, index) => (
          <span key={index} className={styles.bar}>
            <span
              className={styles.failed}
              style={{ height: `${(bucket.failures / scale) * 100}%` }}
            />
            <span
              className={styles.ok}
              style={{ height: `${((bucket.count - bucket.failures) / scale) * 100}%` }}
            />
          </span>
        ))}
      </span>
      {inFlight > 0 && (
        <span className={styles.running} aria-hidden="true">
          <span className={styles.runningDot} />
          {inFlight}
        </span>
      )}
    </span>
  );
}
