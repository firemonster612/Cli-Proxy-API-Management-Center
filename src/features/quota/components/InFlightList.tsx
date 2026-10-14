/**
 * Attempts running right now: "● running 42s · claude-opus-5-5 · stream".
 * Durations are measured against the server's snapshot clock.
 */

import { useTranslation } from 'react-i18next';
import type { InFlightAttempt } from '@/services/api';
import { formatRunningFor } from '../timeCopy';
import styles from './RoutingDetails.module.scss';

export function InFlightList({
  attempts,
  observedAtMs,
  labelOf,
}: {
  attempts: InFlightAttempt[];
  observedAtMs: number;
  /** Given for the combined view, to name each attempt's account. */
  labelOf?: (authIndex: string) => string;
}) {
  const { t } = useTranslation();
  if (attempts.length === 0) return null;
  const longestFirst = [...attempts].sort((a, b) => a.startedAtMs - b.startedAtMs);
  return (
    <ul className={styles.inFlight}>
      {longestFirst.map((attempt) => (
        <li key={attempt.attemptId}>
          <span className={styles.runningDot} aria-hidden="true" />
          <span className={styles.runningFor}>
            {t('quota_management.routing_running', {
              duration: formatRunningFor(observedAtMs - attempt.startedAtMs),
            })}
          </span>
          {labelOf && <span className={styles.account}>{labelOf(attempt.authIndex)}</span>}
          <span className={styles.model}>{attempt.model}</span>
          {attempt.kind && <span className={styles.muted}>{attempt.kind}</span>}
        </li>
      ))}
    </ul>
  );
}
