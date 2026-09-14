/**
 * One board cell:
 *
 *   5-hour limit
 *   58%  ▬▬▬▬▬▬░░░░  2h 10m
 *
 * Both the number and the bar are what's left. The fill is green while
 * plenty remains, yellow once it drops under WARN_REMAINING_PERCENT, and
 * red only when the window is exhausted. Hover/tap shows the absolute reset
 * instant plus any provider extras the caller passes.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HoverCard } from '@/components/ui/HoverCard';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { WARN_REMAINING_PERCENT, type QuotaCellData } from '../columns';
import { formatCompactCountdown } from '../compactCountdown';
import styles from './QuotaCell.module.scss';

export interface QuotaCellProps {
  cell: QuotaCellData | null;
  /** Column name; used for empty cells and as the fallback window label. */
  columnLabel: string;
  /** Extra tooltip lines (Codex expiry, reset credits). */
  extras?: ReactNode;
}

export function QuotaCell({ cell, columnLabel, extras }: QuotaCellProps) {
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
  const countdown =
    cell.resetAtMs !== null ? formatCompactCountdown(cell.resetAtMs, now) : null;
  const resetDisplay = buildResetDisplay(cell.resetLabel, cell.resetAtMs, now, i18n.resolvedLanguage);
  const windowLabel = cell.labelKey ? t(cell.labelKey, cell.labelParams) : cell.label;

  const tooltip = (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{windowLabel || columnLabel}</div>
      {resetDisplay && (
        <div>
          {t('quota_management.cell_resets_at')}{' '}
          <span className={styles.tooltipMono}>{resetDisplay.absolute}</span>
          {resetDisplay.relative && (
            <span className={styles.tooltipMuted}> · {resetDisplay.relative}</span>
          )}
        </div>
      )}
      {extras}
    </div>
  );

  return (
    <HoverCard content={tooltip} className={`${styles.cell} ${tone}`}>
      <span className={styles.label}>{windowLabel || columnLabel}</span>
      <span className={styles.percent}>{remaining === null ? '--' : `${Math.round(remaining)}%`}</span>
      <span className={styles.track} aria-hidden="true">
        <span
          className={styles.fill}
          style={{ width: `${Math.round((remaining ?? 0) * 100) / 100}%` }}
        />
      </span>
      <span className={styles.countdown}>{countdown ?? ''}</span>
    </HoverCard>
  );
}
