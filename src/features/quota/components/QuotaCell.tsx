/**
 * One board cell:
 *
 *   5-hour limit          58%
 *   ▬▬▬▬▬▬▬▬▬▬░░░░░░░░
 *   2h 10m · Mon, 10/13, 10:00 PM
 *
 * Both the number and the bar are what's left. The fill is green while
 * plenty remains, yellow once it drops under WARN_REMAINING_PERCENT; an
 * exhausted window turns its countdown red. A dimmed cell (spent account)
 * drops to gray. Hover/tap repeats the reset instant with its long relative
 * form plus any provider extras the caller passes.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HoverCard } from '@/components/ui/HoverCard';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { WARN_REMAINING_PERCENT, type QuotaCellData } from '../columns';
import { formatCompactCountdown } from '../compactCountdown';
import { formatResetInstant, formatResetInstantShort } from '../timeCopy';
import styles from './QuotaCell.module.scss';

export interface QuotaCellProps {
  cell: QuotaCellData | null;
  /** Column name; used for empty cells and as the fallback window label. */
  columnLabel: string;
  /** Extra tooltip lines (Codex expiry, reset credits). */
  extras?: ReactNode;
  /** Gray out the whole cell (the account's weekly limit is spent). */
  dimmed?: boolean;
}

export function QuotaCell({ cell, columnLabel, extras, dimmed = false }: QuotaCellProps) {
  const { t, i18n } = useTranslation();
  const now = useNow(Boolean(cell?.resetAtMs));

  if (!cell) {
    return (
      <div className={`${styles.cell} ${styles.cellEmpty}`}>
        <span className={styles.label}>{columnLabel}</span>
        <span className={styles.dash} aria-hidden="true">
          —
        </span>
      </div>
    );
  }

  const remaining = cell.remaining;
  const tone =
    remaining === null
      ? ''
      : remaining <= 0
        ? styles.empty
        : remaining < WARN_REMAINING_PERCENT
          ? styles.warn
          : styles.ok;
  const countdown = cell.resetAtMs !== null ? formatCompactCountdown(cell.resetAtMs, now) : null;
  const resetDisplay = buildResetDisplay(
    cell.resetLabel,
    cell.resetAtMs,
    now,
    i18n.resolvedLanguage
  );
  // Exact instants are American (see timeCopy); the provider's own label is
  // only the fallback when there is no timestamp.
  const exact = cell.resetAtMs !== null ? formatResetInstantShort(cell.resetAtMs) : null;
  const exactLong = cell.resetAtMs !== null ? formatResetInstant(cell.resetAtMs) : null;
  const windowLabel = cell.labelKey ? t(cell.labelKey, cell.labelParams) : cell.label;

  const tooltip = (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{windowLabel || columnLabel}</div>
      {resetDisplay && (
        <div>
          {t('quota_management.cell_resets_at')}{' '}
          <span className={styles.tooltipMono}>{exactLong ?? resetDisplay.absolute}</span>
          {resetDisplay.relative && (
            <span className={styles.tooltipMuted}> · {resetDisplay.relative}</span>
          )}
        </div>
      )}
      {extras}
    </div>
  );

  return (
    <HoverCard content={tooltip} className={`${styles.cell} ${dimmed ? styles.dimmed : tone}`}>
      <span className={styles.label}>{windowLabel || columnLabel}</span>
      <span className={styles.percent}>
        {remaining === null ? '--' : `${Math.round(remaining)}%`}
      </span>
      <span className={styles.track} aria-hidden="true">
        <span
          className={styles.fill}
          style={{ width: `${Math.round((remaining ?? 0) * 100) / 100}%` }}
        />
      </span>
      <span className={styles.countdown}>
        {countdown && <span className={styles.countdownValue}>{countdown}</span>}
        {resetDisplay && (
          <span className={styles.exact}>
            {countdown ? ' · ' : ''}
            {exact ?? resetDisplay.absolute}
          </span>
        )}
      </span>
    </HoverCard>
  );
}
