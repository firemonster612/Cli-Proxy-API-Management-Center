/**
 * Board row: [icon] [email / chips] [5-hour] [weekly] [weekly · model] [actions].
 * Rows share the page's --quota-grid so bars line up in columns.
 *
 * Claude and Codex map onto the three cells (see ../columns.ts). Other
 * providers keep their own body, spanning the three cell columns.
 *
 * An account whose weekly window is exhausted is crossed out with a pen
 * stroke, with a stamp saying when it comes back. The account currently
 * receiving the provider's traffic gets a green edge; the activity button
 * expands the requests it served (RoutingDetails).
 *
 * Burn pins ("only burn this account") open from a right-click anywhere on
 * the row or from the flame button, independent of the quota load state.
 */

import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { HoverCard } from '@/components/ui/HoverCard';
import {
  IconActivity,
  IconBuilding,
  IconCloud,
  IconFlame,
  IconRefreshCw,
} from '@/components/ui/icons';
import type { BurnPin } from '@/services/api';
import type { ClaudeQuotaState, CodexQuotaState, ResolvedTheme } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, resolveQuotaErrorMessage, resolveResetMs } from '@/utils/quota';
import { formatDateTimeValue } from '@/utils/format';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { buildQuotaColumns, hasQuotaColumns, isRunningLow } from '../columns';
import { formatBurnRemaining, type BurnChoice } from '../hooks/useBurnPins';
import { bankedResetsFor, supportsBankedResets } from '../bankedResets';
import { isWeeklySpent } from '../pool';
import { isLive, type AccountActivity } from '../routing';
import { formatAgo, formatResetInstant, formatResetsIn } from '../timeCopy';
import { pointUnder } from './anchorPoint';
import { BankedResetsButton } from './BankedResets';
import { BurnMenu } from './BurnMenu';
import { RoutingDetails } from './RoutingDetails';
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
  resolvedTheme: ResolvedTheme;
  /** Requests this account served, from core's recent-request history. */
  activity?: AccountActivity;
  /** This account served the provider's newest request. */
  routedNow: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onBurn: (choice: BurnChoice) => void;
  onStopBurning: () => void;
};

const columnLabelFallback = (t: TFunction) => t('quota_management.col_weekly');

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
    resolvedTheme,
    activity,
    routedNow,
    detailsOpen,
    onToggleDetails,
    onRefresh,
    onReset,
    onBurn,
    onStopBurning,
  } = props;
  const { t, i18n } = useTranslation();
  const now = useNow();
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
  const openMenuUnderButton = (event: MouseEvent<HTMLButtonElement>) =>
    setMenuAt(pointUnder(event.currentTarget, 224));

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
  const banked = supportsBankedResets(entry.type) ? bankedResetsFor(entry.type, quota) : null;
  const canUseBanked =
    quota !== undefined && Boolean(adapter.resetQuota) && Boolean(adapter.canResetQuota?.(quota));
  const providerIcon = getAuthFileIcon(entry.type, resolvedTheme);
  const organizationName =
    quota?.status === 'success' && (entry.type === 'claude' || entry.type === 'codex')
      ? ((quota as ClaudeQuotaState | CodexQuotaState).organizationName ?? null)
      : null;
  const live = isLive(activity, now);

  const columns = buildQuotaColumns(entry.type, quota);
  const columnar = hasQuotaColumns(entry.type);
  const low = isRunningLow(columns);
  const weekly = columns?.weekly ?? null;
  const spent = status === 'success' && isWeeklySpent(weekly);
  const spentWindowLabel = weekly?.labelKey
    ? t(weekly.labelKey, weekly.labelParams)
    : columnLabelFallback(t);

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
  const extraUsage =
    entry.type === 'claude' ? (quota as ClaudeQuotaState | undefined)?.extraUsage : null;
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

  // Codex weekly extras: subscription expiry. Reset credits live in the banked pill.
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
    if (expiry) {
      weeklyExtras = (
        <div>
          {t('codex_quota.expires_label')}{' '}
          <span className={styles.tooltipMono}>{expiry.absolute}</span>
          {expiry.relative && <span className={styles.tooltipMuted}> · {expiry.relative}</span>}
        </div>
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
          <QuotaCell
            cell={columns.weekly}
            columnLabel={columnLabels.weekly}
            extras={weeklyExtras}
          />
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
        spent ? styles.spent : '',
        routedNow && live ? styles.routed : '',
      ].join(' ')}
      style={entranceStyle}
      onContextMenu={openMenuAtPointer}
    >
      <span className={styles.iconWrap} title={typeLabel}>
        {providerIcon ? (
          <img src={providerIcon} alt="" className={styles.providerIcon} />
        ) : (
          <IconCloud size={18} className={styles.cloudIcon} />
        )}
        {live && <span className={styles.liveBadge} aria-hidden="true" />}
      </span>

      <HoverCard content={identityTooltip} className={styles.identity}>
        <span className={styles.email}>{identity}</span>
        <span className={styles.chips}>
          <span
            className={
              plan ? `${styles.chip} ${styles.planChip} ${planTierClass}` : styles.chipMuted
            }
          >
            {plan?.label ?? typeLabel}
          </span>
          {organizationName && (
            <span className={`${styles.chip} ${styles.orgChip}`} title={organizationName}>
              <IconBuilding size={11} aria-hidden="true" />
              <span className={styles.orgName}>{organizationName}</span>
            </span>
          )}
          {burning && (
            <span className={`${styles.chip} ${styles.burnChip}`}>
              <IconFlame size={11} aria-hidden="true" />
              {t('quota_management.burn_chip')}
              {burnRemaining && <span className={styles.chipDetail}>{burnRemaining}</span>}
              {burnModeLabel && <span className={styles.chipDetail}>{burnModeLabel}</span>}
            </span>
          )}
        </span>
        {activity && (
          <span className={live ? styles.activityLive : styles.activityIdle}>
            {live
              ? t('quota_management.routing_live', { ago: formatAgo(activity.lastAtMs, now, t) })
              : t('quota_management.routing_last', { ago: formatAgo(activity.lastAtMs, now, t) })}
          </span>
        )}
      </HoverCard>

      {renderCells()}

      {spent && weekly?.resetAtMs != null && (
        <>
          <svg
            className={styles.penStroke}
            viewBox="0 0 1000 40"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              pathLength={1}
              d="M4 31 C 140 29, 260 23, 430 22 S 700 15, 830 14 S 950 9, 996 8"
            />
            <path pathLength={1} d="M16 36 C 210 31, 400 30, 590 25 S 880 18, 988 15" />
          </svg>
          <div className={styles.spentStamp} role="status">
            <span className={styles.spentTitle}>
              {t('quota_management.spent_title', { window: spentWindowLabel })}
            </span>
            <span className={styles.spentRelative}>{formatResetsIn(weekly.resetAtMs, now, t)}</span>
            <span className={styles.spentExact}>
              {formatResetInstant(weekly.resetAtMs, i18n.resolvedLanguage)}
            </span>
          </div>
        </>
      )}

      <div className={styles.actions}>
        {banked && (
          <BankedResetsButton
            banked={banked}
            accountLabel={identity}
            canUse={canRefresh && !loading && canUseBanked}
            using={resetting}
            onUse={onReset}
          />
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
          data-shot="routing-toggle"
          className={`${styles.iconButton} ${detailsOpen ? styles.iconButtonActive : ''}`}
          onClick={onToggleDetails}
          title={t('quota_management.routing_toggle')}
          aria-label={t('quota_management.routing_toggle')}
          aria-expanded={detailsOpen}
        >
          <IconActivity size={14} />
        </button>
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

      {detailsOpen && (
        <div className={styles.detailsSlot}>
          <RoutingDetails activity={activity} />
        </div>
      )}

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
