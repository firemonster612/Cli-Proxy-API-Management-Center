/**
 * One board cell: `72%  ▬▬▬▬▬░░░  2h 10m`. Percent is what's left; the bar
 * fills as the window is consumed and only takes colour when it's telling
 * you to act (amber under 30% left, red under 10%). Hover/tap shows the
 * absolute reset instant plus any provider extras the caller passes.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HoverCard } from '@/components/ui/HoverCard';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { LOW_REMAINING_PERCENT, WARN_REMAINING_PERCENT, type QuotaCellData } from '../columns';
import { formatCompactCountdown } from '../compactCountdown';
import styles from './QuotaCell.module.scss';

export interface QuotaCellProps {
  cell: QuotaCellData | null;
  /** Column name, rendered only on phone width where the header is gone. */
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
        <span className={styles.mobileLabel}>{columnLabel}</span>
        <span className={styles.dash} aria-hidden="true">
          —
        </span>
      </div>
    );
  }

  const remaining = cell.remaining;
  const used = remaining === null ? 0 : 100 - remaining;
  const tone =
    remaining === null
      ? ''
      : remaining < LOW_REMAINING_PERCENT
        ? styles.low
        : remaining < WARN_REMAINING_PERCENT
          ? styles.warn
          : '';
  const countdown =
    cell.resetAtMs !== null ? formatCompactCountdown(cell.resetAtMs, now) : null;
  const resetDisplay = buildResetDisplay(cell.resetLabel, cell.resetAtMs, now, i18n.resolvedLanguage);
  const windowLabel = cell.labelKey ? t(cell.labelKey, cell.labelParams) : cell.label;

  const tooltip = (
    <div className={styles.tooltip}>
      <div className={styles.tooltipTitle}>{windowLabel}</div>
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
      <span className={styles.mobileLabel}>{columnLabel}</span>
      <span className={styles.percent}>{remaining === null ? '--' : `${Math.round(remaining)}%`}</span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ width: `${Math.round(used * 100) / 100}%` }} />
      </span>
      <span className={styles.countdown}>{countdown ?? ''}</span>
    </HoverCard>
  );
}
