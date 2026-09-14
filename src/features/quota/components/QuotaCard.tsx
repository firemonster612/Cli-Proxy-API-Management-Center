/**
 * Board row: [icon] [email / chips] [5-hour] [weekly] [weekly · model] [actions].
 * Rows share the page's --quota-grid so bars line up in columns.
 *
 * Claude and Codex map onto the three cells (see ../columns.ts). Other
 * providers keep their own body, spanning the three cell columns.
 *
 * Burn pins ("only burn this account") open from a right-click anywhere on
 * the row or from the flame button, independent of the quota load state.
 */

import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HoverCard } from '@/components/ui/HoverCard';
import { IconCloud, IconFlame, IconRefreshCw } from '@/components/ui/icons';
import type { BurnPin } from '@/services/api';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, resolveQuotaErrorMessage, resolveResetMs } from '@/utils/quota';
import { formatDateTimeValue } from '@/utils/format';
import { getTypeLabel } from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { buildQuotaColumns, hasQuotaColumns, isRunningLow } from '../columns';
import { formatBurnRemaining, type BurnChoice } from '../hooks/useBurnPins';
import { BurnMenu } from './BurnMenu';
import { QuotaCell } from './QuotaCell';
import { quotaPlanLabel } from './planLabel';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaCard.module.scss';

/** Typed contract over the QuotaBody module (missing keys throw at module init). */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type QuotaCardProps = {
  entry: QuotaFileEntry;
  quota?: QuotaCardState;
  pin?: BurnPin;
  canRefresh: boolean;
  resetting: boolean;
  burnBusy: boolean;
  /** First-paint cascade delay; null = no entrance (tab switch / paging / refresh mounts). */
  entranceDelayMs?: number | null;
  onRefresh: () => void;
  onReset: () => void;
  onBurn: (choice: BurnChoice) => void;
  onStopBurning: () => void;
};

/** The email is the identity; the filename only disambiguates in the tooltip. */
const identityFor = (name: string, email?: string): string =>
  email && email.trim() !== '' ? email : name.replace(/\.json$/, '');

export function QuotaCard(props: QuotaCardProps) {
  const {
    entry,
    quota,
    pin,
    canRefresh,
    resetting,
    burnBusy,
    entranceDelayMs,
    onRefresh,
    onReset,
    onBurn,
    onStopBurning,
  } = props;
  const { t, i18n } = useTranslation();
  const now = useNow(Boolean(pin));
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;

  // Capture the delay once on mount: later prop changes to null must not
  // affect this card (React 19 forbids reading refs during render).
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--card-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenuAt(null), []);
  const openMenuAtPointer = (event: MouseEvent) => {
    event.preventDefault();
    setMenuAt({ x: event.clientX, y: event.clientY });
  };
  const openMenuUnderButton = (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuAt({ x: rect.right - 224, y: rect.bottom + 6 });
  };

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

  const columns = buildQuotaColumns(entry.type, quota);
  const columnar = hasQuotaColumns(entry.type);
  const low = isRunningLow(columns);

  const burning = Boolean(pin);
  const burnRemaining = pin ? formatBurnRemaining(pin, now) : null;
  const burnModeLabel =
    pin?.mode === 'five-hour-reset'
      ? t('quota_management.burn_chip_until_five_hour')
      : pin?.mode === 'weekly-reset'
        ? t('quota_management.burn_chip_until_weekly')
        : pin?.indefinite
          ? t('quota_management.burn_chip_indefinite')
          : null;
  const identity = identityFor(file.name, file.email);

  // Identity tooltip: filename always; Claude extra-usage spend when enabled.
  const extraUsage = entry.type === 'claude' ? (quota as ClaudeQuotaState | undefined)?.extraUsage : null;
  const identityTooltip = (
    <div className={styles.tooltip}>
      <div className={styles.tooltipMono}>{file.name}</div>
      {extraUsage?.is_enabled && (
        <div>
          {t('claude_quota.extra_usage_label')}{' '}
          <span className={styles.tooltipMono}>
            {`$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`}
          </span>
        </div>
      )}
    </div>
  );

  // Codex weekly extras: subscription expiry and manual reset credits.
  let weeklyExtras: ReactNode = null;
  if (entry.type === 'codex' && quota?.status === 'success') {
    const codex = quota as CodexQuotaState;
    const expiryMs = resolveResetMs([codex.subscriptionActiveUntil ?? null]);
    const expiry = codex.subscriptionActiveUntil
      ? buildResetDisplay(
          expiryMs === null ? formatDateTimeValue(codex.subscriptionActiveUntil) : null,
          expiryMs,
          now,
          i18n.resolvedLanguage
        )
      : null;
    const credits = codex.rateLimitResetCreditsAvailableCount ?? null;
    if (expiry || credits !== null) {
      weeklyExtras = (
        <>
          {expiry && (
            <div>
              {t('codex_quota.expires_label')}{' '}
              <span className={styles.tooltipMono}>{expiry.absolute}</span>
              {expiry.relative && <span className={styles.tooltipMuted}> · {expiry.relative}</span>}
            </div>
          )}
          {credits !== null && (
            <div>
              {t('quota_management.cell_reset_credits')}{' '}
              <span className={styles.tooltipMono}>{credits}</span>
            </div>
          )}
        </>
      );
    }
  }

  const columnLabels = {
    fiveHour: t('quota_management.col_five_hour'),
    weekly: t('quota_management.col_weekly'),
    weeklyModel: t('quota_management.col_weekly_model'),
  };

  const renderCells = () => {
    if (status === 'idle') {
      return (
        <button
          type="button"
          className={styles.idleBody}
          onClick={onRefresh}
          disabled={!canRefresh}
        >
          <IconRefreshCw size={13} aria-hidden="true" className={styles.idleGlyph} />
          <span className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</span>
        </button>
      );
    }
    if (loading) {
      return (
        <>
          <span className={styles.srOnly} aria-busy="true">
            {t(`${adapter.i18nPrefix}.loading`)}
          </span>
          {[0, 1, 2].map((index) => (
            <span key={index} className={styles.shimmerCell} aria-hidden="true">
              <span className={styles.shimmerTrack} />
            </span>
          ))}
        </>
      );
    }
    if (status === 'error') {
      return (
        <div className={styles.errorStrip} role="alert">
          {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
        </div>
      );
    }
    if (columnar && columns) {
      return (
        <>
          <QuotaCell cell={columns.fiveHour} columnLabel={columnLabels.fiveHour} />
          <QuotaCell cell={columns.weekly} columnLabel={columnLabels.weekly} extras={weeklyExtras} />
          <QuotaCell cell={columns.weeklyModel} columnLabel={columnLabels.weeklyModel} />
        </>
      );
    }
    if (quota) {
      return (
        <div className={styles.providerBody}>
          <adapter.Body quota={quota} classes={quotaClasses} />
        </div>
      );
    }
    return <div className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</div>;
  };

  return (
    <article
      className={[
        styles.card,
        mountEntranceDelayMs === null ? '' : styles.cardEnter,
        burning ? styles.burning : '',
        low ? styles.low : '',
      ].join(' ')}
      style={entranceStyle}
      onContextMenu={openMenuAtPointer}
    >
      <span className={styles.iconWrap} title={typeLabel}>
        <IconCloud size={18} className={styles.cloudIcon} />
      </span>

      <HoverCard content={identityTooltip} className={styles.identity}>
        <span className={styles.email}>{identity}</span>
        <span className={styles.chips}>
          <span className={plan ? `${styles.chip} ${styles.planChip} ${planTierClass}` : styles.chipMuted}>
            {plan?.label ?? typeLabel}
          </span>
          {burning && (
            <span className={`${styles.chip} ${styles.burnChip}`}>
              <IconFlame size={11} aria-hidden="true" />
              {t('quota_management.burn_chip')}
              {burnRemaining && <span className={styles.chipDetail}>{burnRemaining}</span>}
              {burnModeLabel && <span className={styles.chipDetail}>{burnModeLabel}</span>}
            </span>
          )}
        </span>
      </HoverCard>

      {renderCells()}

      <div className={styles.actions}>
        {status !== 'idle' && showReset && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onReset}
            disabled={!canRefresh || loading || resetting}
            title={t('codex_quota.reset_button')}
            aria-label={t('codex_quota.reset_button')}
          >
            <IconRefreshCw size={14} className={resetting ? styles.spinning : undefined} />
          </button>
        )}
        {status !== 'idle' && (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
            title={t('auth_files.quota_refresh_hint')}
            aria-label={t('auth_files.quota_refresh_single')}
          >
            <IconRefreshCw size={14} className={loading ? styles.spinning : undefined} />
          </button>
        )}
        <button
          type="button"
          className={`${styles.iconButton} ${burning ? styles.iconButtonBurning : ''}`}
          onClick={openMenuUnderButton}
          disabled={burnBusy}
          title={burning ? t('quota_management.burn_stop') : t('quota_management.burn_only_this')}
          aria-label={t('quota_management.burn_only_this')}
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
        >
          <IconFlame size={14} />
        </button>
      </div>

      {menuAt && (
        <BurnMenu
          at={menuAt}
          title={identity}
          pin={pin}
          busy={burnBusy}
          onChoose={onBurn}
          onStop={onStopBurning}
          onClose={closeMenu}
        />
      )}
    </article>
  );
}
