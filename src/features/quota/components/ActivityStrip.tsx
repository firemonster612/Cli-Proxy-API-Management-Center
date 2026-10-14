/**
 * The last hour of requests as twelve five-minute bars, oldest on the left.
 * Failures stack on top in the danger color; running attempts get a count
 * beside the bars. Without history (usage statistics off) only the running
 * count shows, since core tracks attempts regardless.
 */

import { useTranslation } from 'react-i18next';
import { activitySummary, type RunningCount } from '../activityCopy';
import type { ActivityBucket } from '../routing';
import { RunningDot } from './RunningDot';
import styles from './ActivityStrip.module.scss';

/** Below this many requests per bucket the bars scale as if this many, so a trickle looks like one. */
const MIN_SCALE = 4;

export function ActivityStrip({
  buckets,
  partial = false,
  running,
}: {
  /** Null when core keeps no history. */
  buckets: ActivityBucket[] | null;
  /** The bucket counts are lower bounds. */
  partial?: boolean;
  running: RunningCount;
}) {
  const { t } = useTranslation();
  if (!buckets && running.count === 0) return null;
  const history = buckets && {
    requests: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    failures: buckets.reduce((sum, bucket) => sum + bucket.failures, 0),
    partial,
  };
  const label = activitySummary(t, history, running.count > 0 ? running : null);
  const scale = Math.max(MIN_SCALE, ...(buckets ?? []).map((bucket) => bucket.count));

  return (
    <span className={styles.strip} title={label} aria-label={label} role="img">
      {buckets && (
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
      )}
      {running.count > 0 && (
        <span className={styles.running} aria-hidden="true">
          <RunningDot />
          {running.count}
          {running.truncated && '+'}
        </span>
      )}
    </span>
  );
}
