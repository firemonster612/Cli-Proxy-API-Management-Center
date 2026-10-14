/**
 * Recent requests as a table: when, which model, which client, tokens,
 * latency and outcome. With `showAccount` it also names the account, for the
 * combined view across accounts. A request that core retried on another
 * account says where else it went.
 */

import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import type { RecentRequest } from '@/services/api';
import { retriedOn, type RequestLookup } from '../routing';
import { formatAgo, formatClock } from '../timeCopy';
import styles from './RoutingDetails.module.scss';

const FINGERPRINT_CHARS = 6;
const UNKNOWN_CLIENT_LABEL = 'Key ?';

const formatTokens = (value: number | null): string => {
  if (value === null) return '–';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
};

function ClientCell({ request }: { request: RecentRequest }) {
  const { t } = useTranslation();
  if (!request.clientKeyLabel && !request.clientKeyFingerprint) {
    return <td className={styles.muted}>–</td>;
  }
  const details = [
    request.userAgent && `${t('quota_management.routing_client_agent')}: ${request.userAgent}`,
    request.clientIp && `${t('quota_management.routing_client_ip')}: ${request.clientIp}`,
  ]
    .filter(Boolean)
    .join('\n');
  // A key the proxy doesn't know is the stray request worth noticing.
  const unknown = request.clientKeyLabel === UNKNOWN_CLIENT_LABEL;
  return (
    <td className={styles.client} title={details || undefined}>
      <span className={unknown ? styles.unknownClient : undefined}>
        {request.clientKeyLabel ?? '–'}
      </span>
      {request.clientKeyFingerprint && (
        <span className={styles.fingerprint}>
          {request.clientKeyFingerprint.slice(0, FINGERPRINT_CHARS)}
        </span>
      )}
    </td>
  );
}

export function RequestTable({
  requests,
  lookup,
  showAccount = false,
}: {
  requests: RecentRequest[];
  lookup: RequestLookup;
  showAccount?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();

  // The table keeps its columns and scrolls sideways on narrow screens, so Client and Result stay reachable.
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t('quota_management.routing_col_time')}</th>
            {showAccount && <th>{t('quota_management.routing_col_account')}</th>}
            <th>{t('quota_management.routing_col_model')}</th>
            <th>{t('quota_management.routing_col_client')}</th>
            <th className={styles.num}>{t('quota_management.routing_col_tokens')}</th>
            <th className={styles.num}>{t('quota_management.routing_col_latency')}</th>
            <th className={styles.num}>{t('quota_management.routing_col_result')}</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request, index) => {
            const alsoTried = retriedOn(request, lookup);
            return (
              <tr key={`${request.authIndex}-${request.startedAtMs}-${index}`}>
                <td>
                  <span className={styles.clock}>
                    {formatClock(request.startedAtMs, i18n.resolvedLanguage)}
                  </span>
                  <span className={styles.ago}>{formatAgo(request.startedAtMs, now, t)}</span>
                </td>
                {showAccount && (
                  <td className={styles.account}>{lookup.labelOf(request.authIndex)}</td>
                )}
                <td className={styles.model}>
                  {request.model}
                  {alsoTried.length > 0 && (
                    <span className={styles.retry}>
                      ↻{' '}
                      {t('quota_management.routing_also_tried', {
                        accounts: alsoTried.map(lookup.labelOf).join(', '),
                      })}
                    </span>
                  )}
                </td>
                <ClientCell request={request} />
                <td className={styles.num}>
                  {formatTokens(request.inputTokens)} → {formatTokens(request.outputTokens)}
                </td>
                <td className={styles.num}>
                  {request.latencyMs === null ? '–' : `${(request.latencyMs / 1000).toFixed(1)}s`}
                </td>
                <td className={`${styles.num} ${request.failed ? styles.failed : styles.ok}`}>
                  {request.failed
                    ? (request.statusCode ?? t('quota_management.routing_failed'))
                    : t('quota_management.routing_ok')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
