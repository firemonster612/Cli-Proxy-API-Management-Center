/**
 * Quota row: cloud icon + identity column (email over plan) + four-state body
 * + compact actions. One credential per full-width row so the usage meters
 * read as horizontal bars in a dense list.
 *
 * - idle: the body is a click-to-load button (upstream fetches are rate
 *   sensitive, so nothing loads automatically);
 * - loading: ghost-row skeleton (aria-busy, visually hidden text equivalent);
 * - error: failure strip + footer refresh retries;
 * - success: provider Body (dressed by QuotaBody.module.scss).
 */

import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCloud, IconRefreshCw } from '@/components/ui/icons';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getTypeLabel } from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { quotaPlanLabel } from './planLabel';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaCard.module.scss';

/** Typed contract over the QuotaBody module (missing keys throw at module init). */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type QuotaCardProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  canRefresh: boolean;
  resetting: boolean;
  /** First-paint cascade delay; null = no entrance (tab switch / paging / refresh mounts). */
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onReset: () => void;
};

/** The email is the identity; the filename only disambiguates in the tooltip. */
const identityFor = (name: string, email?: string): string =>
  email && email.trim() !== '' ? email : name.replace(/\.json$/, '');

export function QuotaCard(props: QuotaCardProps) {
  const { entry, quota, canRefresh, resetting, entranceDelayMs, onRefresh, onReset } = props;
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;

  // Capture the delay once on mount: later prop changes to null must not
  // affect this card (React 19 forbids reading refs during render).
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--card-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const typeLabel = getTypeLabel(t, entry.type);
  const plan = quotaPlanLabel(entry.type, quota, t);
  const planTierClass =
    plan?.tier === 'elite'
      ? quotaClasses.elitePlanValue
      : plan?.tier === 'premium'
        ? quotaClasses.premiumPlanValue
        : '';
  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const showReset =
    status === 'success' &&
    Boolean(adapter.resetQuota) &&
    quota !== undefined &&
    Boolean(adapter.canResetQuota?.(quota));

  return (
    <article
      className={`${styles.card} ${mountEntranceDelayMs === null ? '' : styles.cardEnter}`}
      style={entranceStyle}
    >
      <span className={styles.iconWrap} title={typeLabel}>
        <IconCloud size={17} className={styles.cloudIcon} />
      </span>

      <div className={styles.identity} title={file.name}>
        <span className={styles.email}>{identityFor(file.name, file.email)}</span>
        <span className={plan ? `${styles.plan} ${planTierClass}` : styles.planFallback}>
          {plan?.label ?? typeLabel}
        </span>
      </div>

      <div className={styles.body}>
        {status === 'idle' ? (
          <button
            type="button"
            className={styles.idleBody}
            onClick={onRefresh}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={13} aria-hidden="true" className={styles.idleGlyph} />
            <span className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</span>
          </button>
        ) : loading ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1].map((row) => (
              <div key={row} className={styles.skeletonRow} aria-hidden="true">
                <span className={styles.skeletonLabel} />
                <span className={styles.skeletonTrack} />
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <div className={styles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
          </div>
        ) : quota ? (
          <adapter.Body quota={quota} classes={quotaClasses} />
        ) : (
          <div className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</div>
        )}
      </div>

      {status !== 'idle' && (
        <footer className={styles.actionRow}>
          {showReset && (
            <button
              type="button"
              className={styles.actionPill}
              onClick={onReset}
              disabled={!canRefresh || loading || resetting}
              title={t('codex_quota.reset_button')}
            >
              <IconRefreshCw size={13} className={resetting ? styles.spinning : undefined} />
              {t('codex_quota.reset_button')}
            </button>
          )}
          <button
            type="button"
            className={styles.actionPill}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </footer>
      )}
    </article>
  );
}
