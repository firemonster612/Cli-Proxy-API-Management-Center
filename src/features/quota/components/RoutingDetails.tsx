/**
 * Expanded under a row: what this account actually served, from core's
 * recent-request history. Model mix for the last hour, then the newest
 * requests with time, model, tokens, latency and outcome.
 */

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { AccountActivity } from '../routing';
import { formatAgo, formatClock } from '../timeCopy';
import styles from './RoutingDetails.module.scss';

const SHOWN_REQUESTS = 12;

const formatTokens = (value: number | null): string => {
  if (value === null) return '–';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
};

export function RoutingDetails({ activity }: { activity: AccountActivity | undefined }) {
  const { t, i18n } = useTranslation();
  const now = useNow();

  if (!activity) {
    return <div className={styles.details}>{t('quota_management.routing_no_requests')}</div>;
  }

  return (
    <div className={styles.details} data-shot="routing-details">
      <div className={styles.summary}>
        <span>
          {t('quota_management.routing_last_hour', { count: activity.recentCount })}
          {activity.recentFailures > 0 && (
            <span className={styles.failures}>
              {' · '}
              {t('quota_management.routing_failures', { count: activity.recentFailures })}
            </span>
          )}
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

      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('quota_management.routing_col_time')}</th>
            <th>{t('quota_management.routing_col_model')}</th>
            <th className={styles.num}>{t('quota_management.routing_col_tokens')}</th>
            <th className={styles.num}>{t('quota_management.routing_col_latency')}</th>
            <th className={styles.num}>{t('quota_management.routing_col_result')}</th>
          </tr>
        </thead>
        <tbody>
          {activity.requests.slice(0, SHOWN_REQUESTS).map((request, index) => (
            <tr key={`${request.timeMs}-${index}`}>
              <td>
                <span className={styles.clock}>
                  {formatClock(request.timeMs, i18n.resolvedLanguage)}
                </span>
                <span className={styles.ago}>{formatAgo(request.timeMs, now, t)}</span>
              </td>
              <td className={styles.model}>{request.model}</td>
              <td className={styles.num}>
                {formatTokens(request.inputTokens)} → {formatTokens(request.outputTokens)}
              </td>
              <td className={styles.num}>
                {request.latencyMs === null ? '–' : `${(request.latencyMs / 1000).toFixed(1)}s`}
              </td>
              <td className={`${styles.num} ${request.failed ? styles.failed : styles.ok}`}>
                {request.failed
                  ? (request.statusCode ?? t('quota_management.routing_failed'))
                  : 'OK'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {activity.requests.length > SHOWN_REQUESTS && (
        <div className={styles.more}>
          {t('quota_management.routing_more', { count: activity.requests.length - SHOWN_REQUESTS })}
        </div>
      )}
    </div>
  );
}
