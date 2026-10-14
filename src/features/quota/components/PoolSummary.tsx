/**
 * Pool overview above the board, one card per provider:
 *
 *   Claude · 3 accounts                    ● Routing to alex.chen@example.com
 *                                     Next pick: alex@northwind.dev (closest to reset)
 *   62% of weekly pool left · 5-hour 48%
 *   [account segments, width = plan weight, fill = weekly left]
 *   Next reset Wed, 15 Oct, 4:12 AM · in 1 day, 7 hours · +17% of pool
 *   [7-day step forecast from now: the pool if nothing else is used]
 *   On pace
 *   3 banked resets · next expires in 19 hours
 *
 * With nothing live, the routing line names the last account routed to
 * instead. "Next pick" is core's routing preview for a new request.
 */

import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { HoverCard } from '@/components/ui/HoverCard';
import { IconTicket } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import type { RoutingPreview } from '@/services/api';
import type { ResolvedTheme } from '@/types';
import { getAuthFileIcon, getTypeLabel } from '@/features/authFiles/constants';
import { formatCalendarDate } from '@/utils/time/calendar';
import { DAY_MS } from '@/utils/time/durations';
import type { BankedResets } from '../bankedResets';
import type {
  PoolAccount,
  PoolPace,
  PoolResetStep,
  PoolSummary as PoolSummaryData,
} from '../pool';
import { isLive, type AccountActivity } from '../routing';
import { formatAgo, formatLongDuration, formatResetInstant, formatResetsIn } from '../timeCopy';
import styles from './PoolSummary.module.scss';

export interface PoolCardData {
  summary: PoolSummaryData;
  /** The account that served the provider's newest request, live or not. */
  route: AccountActivity | undefined;
  /** Label for the routed account (email), resolved by the page. */
  routeLabel: string | null;
  /** Core's pick for a new request; absent when it can't say. */
  preview: RoutingPreview | undefined;
  /** Label for the previewed account, resolved by the page. */
  previewLabel: string | null;
  banked: BankedResets[];
}

const pct = (value: number) => `${Math.round(value)}%`;
const PREVIEW_REASONS = new Set([
  'pinned',
  'closest-to-reset',
  'probe',
  'round-robin-fallback',
  'only-available',
]);

/** "alex@northwind.dev · Northwind Labs" for Team/Enterprise accounts, the email alone otherwise. */
const accountWithOrg = (account: PoolAccount) =>
  account.organizationName ? `${account.label} · ${account.organizationName}` : account.label;

function StepTooltip({ step }: { step: PoolResetStep }) {
  const { t } = useTranslation();
  return (
    <div className={styles.tooltip}>
      <strong>{formatResetInstant(step.atMs)}</strong>
      <div className={styles.restore}>
        {t('quota_management.pool_restores', { percent: pct(step.restoresPercent) })}
      </div>
      {step.accounts.map((account) => (
        <div key={account.key} className={styles.muted}>
          {accountWithOrg(account)}
        </div>
      ))}
    </div>
  );
}
const FORECAST_HORIZON_MS = 7 * DAY_MS;
const GRID_PERCENTS = [100, 50, 0];

function Forecast({
  summary,
  now,
  locale,
}: {
  summary: PoolSummaryData;
  now: number;
  locale?: string;
}) {
  // useId's punctuation isn't safe inside url(#…).
  const gradientId = `pool-fill-${useId().replace(/[^\w-]/g, '')}`;
  const end = now + FORECAST_HORIZON_MS;
  const x = (ms: number) => ((ms - now) / FORECAST_HORIZON_MS) * 100;
  const y = (percent: number) => 100 - Math.max(0, Math.min(100, percent));
  const steps = summary.resets.filter((step) => step.atMs <= end);

  let path = `M 0 ${y(summary.remainingPercent)}`;
  steps.forEach((step, index) => {
    const before = index === 0 ? summary.remainingPercent : steps[index - 1].percent;
    path += ` L ${x(step.atMs)} ${y(before)} L ${x(step.atMs)} ${y(step.percent)}`;
  });
  const last = steps[steps.length - 1]?.percent ?? summary.remainingPercent;
  path += ` L 100 ${y(last)}`;
  const area = `${path} L 100 100 L 0 100 Z`;

  const dayTicks: number[] = [];
  const firstMidnight = new Date(now);
  firstMidnight.setHours(24, 0, 0, 0);
  for (let ms = firstMidnight.getTime(); ms < end; ms += DAY_MS) dayTicks.push(ms);
  // "now" in the reader's language without another translation key.
  const nowLabel = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');

  return (
    <div className={styles.forecast}>
      <div className={styles.axis} aria-hidden="true">
        {GRID_PERCENTS.map((percent) => (
          <span key={percent} style={{ top: `${y(percent)}%` }}>
            {percent}%
          </span>
        ))}
      </div>
      <div className={styles.plot}>
        <svg
          className={styles.forecastSvg}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.gradientTop} />
              <stop offset="1" className={styles.gradientBottom} />
            </linearGradient>
          </defs>
          {GRID_PERCENTS.map((percent) => (
            <line
              key={percent}
              x1={0}
              x2={100}
              y1={y(percent)}
              y2={y(percent)}
              className={styles.gridLine}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={path} className={styles.forecastLine} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className={styles.nowMarker} aria-hidden="true">
          {nowLabel}
        </span>
        {steps.map((step) => (
          <span
            key={step.atMs}
            className={styles.stepAnchor}
            style={{ left: `${x(step.atMs)}%`, top: `${y(step.percent)}%` }}
          >
            <HoverCard className={styles.stepLabel} content={<StepTooltip step={step} />}>
              +{pct(step.restoresPercent)}
            </HoverCard>
          </span>
        ))}
        <div className={styles.dayLabels} aria-hidden="true">
          {dayTicks.map((ms) => (
            <span key={ms} style={{ left: `${x(ms)}%` }}>
              {formatCalendarDate(ms, locale, { month: 'short' })}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function NextPick({ preview, label }: { preview: RoutingPreview; label: string | null }) {
  const { t } = useTranslation();
  const hint = (
    <div className={styles.tooltip}>
      <strong>{preview.model}</strong>
      <div>{t('quota_management.pool_next_pick_hint')}</div>
      {preview.sessionAffinityEnabled && (
        <div className={styles.muted}>{t('quota_management.pool_next_pick_affinity')}</div>
      )}
    </div>
  );
  return (
    <HoverCard className={styles.nextPick} content={hint}>
      <span className={styles.nextPickMark} aria-hidden="true" />
      {t('quota_management.pool_next_pick')}{' '}
      {preview.chosenAuthIndex ? (
        <>
          <strong>{label ?? preview.chosenAuthIndex}</strong>
          {PREVIEW_REASONS.has(preview.reason) && (
            <span className={styles.muted}>
              {' '}
              ({t(`quota_management.pool_next_pick_reason_${preview.reason.replace(/-/g, '_')}`)})
            </span>
          )}
        </>
      ) : (
        <span className={styles.partial}>{t('quota_management.pool_next_pick_none')}</span>
      )}
    </HoverCard>
  );
}

function PaceLine({ pace }: { pace: PoolPace }) {
  const { t } = useTranslation();
  const hint = t('quota_management.pool_pace_hint', {
    used: pct(pace.actual * 100),
    elapsed: pct(pace.expected * 100),
  });
  if (pace.status !== 'ahead') {
    return (
      <div className={styles.pace} title={hint}>
        {pace.status === 'on'
          ? t('quota_management.pool_pace_on')
          : t('quota_management.pool_pace_under')}
      </div>
    );
  }
  return (
    <div className={styles.pace} title={hint}>
      <span className={styles.paceAhead}>{t('quota_management.pool_pace_ahead')}</span>
      {pace.runsOutAtMs !== null &&
        ` · ${t('quota_management.pool_pace_runs_out', { time: formatResetInstant(pace.runsOutAtMs) })}`}
    </div>
  );
}

function PoolCard({
  data,
  historyEnabled,
  resolvedTheme,
}: {
  data: PoolCardData;
  historyEnabled: boolean;
  resolvedTheme: ResolvedTheme;
}) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { summary, route, routeLabel, preview, previewLabel, banked } = data;
  const live = isLive(route, now);
  const icon = getAuthFileIcon(summary.provider, resolvedTheme);
  const next = summary.resets[0];
  // Accounts on monthly windows only: there is no weekly capacity to total.
  const hasWeekly = summary.accounts.length > 0;
  const bankedTotal = banked.reduce((sum, entry) => sum + entry.available, 0);
  const nextExpiry = banked
    .flatMap((entry) => entry.items)
    .map((item) => item.expiresAtMs)
    .filter((ms): ms is number => ms !== null && ms > now)
    .sort((a, b) => a - b)[0];

  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <span className={styles.title}>
          {icon && <img src={icon} alt="" className={styles.icon} />}
          {getTypeLabel(t, summary.provider)}
          <span className={styles.muted}>
            {t('quota_management.pool_accounts', {
              count: summary.accounts.length + summary.notLoadedCount + summary.monthlyCount,
            })}
          </span>
        </span>
        <div className={styles.routing}>
          {route && routeLabel ? (
            <span className={styles.route}>
              <span className={live ? styles.liveDot : styles.lastDot} />
              {live
                ? t('quota_management.pool_routing_to')
                : t('quota_management.pool_last_routed_to')}{' '}
              <strong>{routeLabel}</strong>
              <span className={styles.muted}>
                {route.requests[0]?.model ?? ''} · {formatAgo(route.lastAtMs, now, t)}
              </span>
            </span>
          ) : (
            <span className={styles.routeIdle}>
              {historyEnabled
                ? t('quota_management.pool_routing_idle')
                : t('quota_management.routing_history_disabled')}
            </span>
          )}
          {preview && <NextPick preview={preview} label={previewLabel} />}
        </div>
      </header>

      <div className={styles.headline}>
        {hasWeekly ? (
          <>
            <span className={styles.bigNumber}>{pct(summary.remainingPercent)}</span>
            <span className={styles.headlineText}>{t('quota_management.pool_weekly_left')}</span>
          </>
        ) : (
          <span className={styles.headlineText}>{t('quota_management.pool_no_weekly')}</span>
        )}
        {summary.fiveHourRemainingPercent !== null && (
          <span className={styles.muted}>
            ·{' '}
            {t('quota_management.pool_five_hour', {
              percent: pct(summary.fiveHourRemainingPercent),
            })}
          </span>
        )}
        {summary.notLoadedCount > 0 && (
          <span className={styles.partial}>
            · {t('quota_management.pool_not_loaded', { count: summary.notLoadedCount })}
          </span>
        )}
        {summary.monthlyCount > 0 && (
          <span className={styles.muted}>
            · {t('quota_management.pool_monthly_excluded', { count: summary.monthlyCount })}
          </span>
        )}
      </div>

      {hasWeekly && (
        <>
          <div
            className={styles.segments}
            style={{
              gridTemplateColumns: summary.accounts
                .map((account) => `${account.weight}fr`)
                .join(' '),
            }}
          >
            {summary.accounts.map((account) => (
              <HoverCard
                key={account.key}
                className={[
                  styles.segment,
                  account.remaining <= 0 ? styles.segmentSpent : '',
                  live && route?.authIndex === account.authIndex ? styles.segmentLive : '',
                ].join(' ')}
                content={
                  <div className={styles.tooltip}>
                    <strong>{account.label}</strong>
                    <div>
                      {t('quota_management.pool_segment_left', { percent: pct(account.remaining) })}
                    </div>
                    <div className={styles.muted}>
                      {t('quota_management.pool_segment_weight', {
                        weight: account.weight,
                        share: pct((account.weight / summary.totalWeight) * 100),
                      })}
                    </div>
                  </div>
                }
              >
                <span className={styles.segmentFill} style={{ width: `${account.remaining}%` }} />
              </HoverCard>
            ))}
          </div>

          {hasWeekly && (
            <div className={styles.nextReset}>
              {next ? (
                <>
                  <span className={styles.muted}>{t('quota_management.pool_next_reset')}</span>{' '}
                  <strong>{formatResetInstant(next.atMs)}</strong>
                  <span className={styles.muted}> · {formatResetsIn(next.atMs, now, t)} · </span>
                  <span className={styles.restore}>
                    {t('quota_management.pool_restores', { percent: pct(next.restoresPercent) })}
                  </span>
                  <span className={styles.muted}>
                    {' '}
                    ({next.accounts.map(accountWithOrg).join(', ')})
                  </span>
                </>
              ) : (
                <span className={styles.muted}>
                  {summary.remainingPercent >= 100
                    ? t('quota_management.pool_all_full')
                    : t('quota_management.pool_no_reset_known')}
                </span>
              )}
            </div>
          )}

          <Forecast summary={summary} now={now} locale={i18n.resolvedLanguage} />
          {summary.pace && <PaceLine pace={summary.pace} />}
        </>
      )}

      {bankedTotal > 0 && (
        <div className={styles.banked}>
          <IconTicket size={13} aria-hidden="true" />
          {t('quota_management.pool_banked', { count: bankedTotal })}
          {nextExpiry !== undefined && (
            <span className={styles.muted}>
              {' '}
              ·{' '}
              {t('quota_management.pool_banked_next_expiry', {
                duration: formatLongDuration(nextExpiry - now, t),
              })}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

export function PoolSummary({
  cards,
  historyEnabled,
  resolvedTheme,
}: {
  cards: PoolCardData[];
  /** False when core's usage statistics are off, so no routing data exists. */
  historyEnabled: boolean;
  resolvedTheme: ResolvedTheme;
}) {
  const { t } = useTranslation();
  if (cards.length === 0) return null;
  return (
    <div className={styles.pool}>
      {cards.map((card) => (
        <PoolCard
          key={card.summary.provider}
          data={card}
          historyEnabled={historyEnabled}
          resolvedTheme={resolvedTheme}
        />
      ))}
      <p className={styles.footnote}>{t('quota_management.pool_estimate_note')}</p>
    </div>
  );
}
