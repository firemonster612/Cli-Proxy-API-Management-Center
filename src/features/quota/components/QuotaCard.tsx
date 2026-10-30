/**
 * Board row: [icon] [email / chips] [5-hour] [weekly] [weekly · model] [actions].
 * Rows share the page's --quota-grid so bars line up in columns.
 *
 * Claude and Codex map onto the three cells (see ../columns.ts). Other
 * providers keep their own body, spanning the three cell columns.
 *
 * An account whose weekly window is exhausted is crossed out with a pen
 * stroke, with a stamp saying when it comes back. The account currently
 * receiving the provider's traffic gets a green marker; with nothing live, the
 * account routed to last is marked instead, and core's pick for the next new
 * request gets a quiet marker of its own. Every row carries an activity strip
 * for the last hour; the activity button expands what is running and the
 * requests it served (RoutingDetails).
 *
 * Burn pins ("only burn this account") open from a right-click anywhere on
 * the row or from the flame button, independent of the quota load state.
 */

import { useCallback, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HoverCard } from '@/components/ui/HoverCard';
import {
  IconActivity,
  IconBuilding,
  IconCloud,
  IconFlame,
  IconRefreshCw,
} from '@/components/ui/icons';
import type { BurnPin, InFlightAttempt, RoutingExclusion } from '@/services/api';
import type { ClaudeQuotaState, CodexQuotaState, ResolvedTheme } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, resolveQuotaErrorMessage, resolveResetMs } from '@/utils/quota';
import { formatDateTimeValue } from '@/utils/format';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import {
  accountLabel,
  isQuotaRefreshDisabled,
  quotaOrganizationName,
  type QuotaFileEntry,
} from '../logic';
import { buildQuotaColumns, hasQuotaColumns, isRunningLow } from '../columns';
import { formatBurnRemaining, type BurnChoice } from '../hooks/useBurnPins';
import { bankedResetsFor, supportsBankedResets } from '../bankedResets';
import { isWeeklySpent } from '../pool';
import { activityBuckets, isLive, type AccountActivity, type RequestLookup } from '../routing';
import { formatAgo, formatResetInstant, formatResetsIn } from '../timeCopy';
import { ActivityStrip } from './ActivityStrip';
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

const NO_ACTIVITY = activityBuckets([], 0);

/** Why core skips this account for new requests of the preview's model. */
export interface RowExclusion extends RoutingExclusion {
  model: string;
}

/** Where this account stands in routing, resolved by the page. */
export interface RowRouting {
  /** Requests this account served, from core's recent-request history. */
  activity?: AccountActivity;
  /** Attempts running on this account now. */
  inFlight: InFlightAttempt[];
  /** Core left attempts out of its in-flight list, so the count is a lower bound. */
  inFlightTruncated: boolean;
  /** Server clock of the in-flight snapshot. */
  observedAtMs: number;
  /** Core's history cap cut the hour short, so counts here are lower bounds even with no entry. */
  historyPartial: boolean;
  /** The provider's traffic is going here now, or went here last. */
  route: 'live' | 'last' | null;
  /** Core would send a new request here. */
  nextPick: boolean;
  exclusion?: RowExclusion;
}

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
  routing: RowRouting;
  lookup: RequestLookup;
  /** False when core's usage statistics are off, so no routing data exists. */
  historyEnabled: boolean;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onRefresh: () => void;
  onReset: () => void;
  onBurn: (choice: BurnChoice) => void;
  onStopBurning: () => void;
};

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
    routing,
    lookup,
    historyEnabled,
    detailsOpen,
    onToggleDetails,
    onRefresh,
    onReset,
    onBurn,
    onStopBurning,
  } = props;
  const { t, i18n } = useTranslation();
  const { activity, inFlight, exclusion } = routing;
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;
  const status = quota?.status ?? 'idle';
  const columns = buildQuotaColumns(entry.type, quota);
  const weekly = columns?.weekly ?? null;
  const spent = status === 'success' && isWeeklySpent(weekly);
  const burning = Boolean(pin);
  // Only rows with a countdown or a recency label need the minute tick.
  const now = useNow(burning || spent || activity !== undefined);

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
  const organizationName = quotaOrganizationName(entry.type, quota);
  const live = isLive(activity, now);
  const routedNow = routing.route === 'live';
  const routedLast = routing.route === 'last';

  const columnar = hasQuotaColumns(entry.type);
  const low = isRunningLow(columns);
  const spentWindowLabel = weekly?.labelKey
    ? t(weekly.labelKey, weekly.labelParams)
    : t('quota_management.col_weekly');

  const burnRemaining = pin ? formatBurnRemaining(pin, now) : null;
  const burnModeLabel =
    pin?.mode === 'five-hour-reset'
      ? t('quota_management.burn_chip_until_five_hour')
      : pin?.mode === 'weekly-reset'
        ? t('quota_management.burn_chip_until_weekly')
        : pin?.indefinite
          ? t('quota_management.burn_chip_indefinite')
          : null;
  const identity = accountLabel(file);

  // Identity tooltip: filename always; Claude extra-usage spend when enabled;
  // why routing skips the account, when it does.
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
      {exclusion && (
        <div>
          {t('quota_management.routing_excluded', {
            model: exclusion.model,
            reason: t(`quota_management.routing_excluded_reason_${exclusion.reason}`, {
              defaultValue: exclusion.reason,
            }),
          })}
          {exclusion.retryAtMs !== null &&
            ` · ${t('quota_management.routing_excluded_until', {
              time: formatResetInstant(exclusion.retryAtMs),
            })}`}
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
          <QuotaCell cell={columns.fiveHour} columnLabel={columnLabels.fiveHour} dimmed={spent} />
          <QuotaCell
            cell={columns.weekly}
            columnLabel={columnLabels.weekly}
            extras={weeklyExtras}
            dimmed={spent}
          />
          <QuotaCell
            cell={columns.weeklyModel}
            columnLabel={columnLabels.weeklyModel}
            dimmed={spent}
          />
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
        routedNow ? styles.routed : '',
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
        {(live || routedNow) && <span className={styles.liveBadge} aria-hidden="true" />}
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
          {routedLast && (
            <span className={`${styles.chip} ${styles.routeChip}`}>
              {t('quota_management.routing_chip_last')}
            </span>
          )}
          {routing.nextPick && (
            <span className={`${styles.chip} ${styles.nextPickChip}`}>
              {t('quota_management.routing_chip_next')}
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
        <ActivityStrip
          buckets={historyEnabled ? (activity?.buckets ?? NO_ACTIVITY) : null}
          partial={activity?.partial ?? routing.historyPartial}
          running={{ count: inFlight.length, truncated: routing.inFlightTruncated }}
        />
      </HoverCard>

      {renderCells()}

      {spent && (
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
            {weekly?.resetAtMs != null && (
              <>
                <span className={styles.spentRelative}>
                  {formatResetsIn(weekly.resetAtMs, now, t)}
                </span>
                <span className={styles.spentExact}>{formatResetInstant(weekly.resetAtMs)}</span>
              </>
            )}
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
            className={styles.actionButton}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting)}
            title={t('auth_files.quota_refresh_hint')}
            aria-label={t('auth_files.quota_refresh_single')}
          >
            <IconRefreshCw size={14} className={loading ? styles.spinning : undefined} />
            <span className={styles.actionLabel}>{t('auth_files.quota_refresh_single')}</span>
          </button>
        )}
        <button
          type="button"
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
          <RoutingDetails
            activity={activity}
            inFlight={inFlight}
            observedAtMs={routing.observedAtMs}
            lookup={lookup}
            historyEnabled={historyEnabled}
            historyPartial={routing.historyPartial}
          />
        </div>
      )}

      {menuAt && (
        <BurnMenu
          at={menuAt}
          title={identity}
          pin={pin}
          noFiveHourLimit={columns?.fiveHour?.noLimit}
          busy={burnBusy}
          onChoose={onBurn}
          onStop={onStopBurning}
          onClose={closeMenu}
        />
      )}
    </article>
  );
}
