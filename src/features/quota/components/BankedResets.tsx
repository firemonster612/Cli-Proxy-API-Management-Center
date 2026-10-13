/**
 * Banked resets for one account: a labelled ticket pill in the row's actions
 * (deliberately unlike the round refresh button) that opens a panel listing
 * every banked reset with its expiry, soonest first, and a button to spend one.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTicket } from '@/components/ui/icons';
import { useNow } from '@/hooks/useNow';
import { DAY_MS } from '@/utils/time/durations';
import type { BankedResets } from '../bankedResets';
import { formatExpiresIn, formatResetInstant } from '../timeCopy';
import { pointUnder } from './anchorPoint';
import { FloatingPanel } from './FloatingPanel';
import styles from './BankedResets.module.scss';

/** Resets expiring sooner than this are flagged. */
export const EXPIRING_SOON_MS = 2 * DAY_MS;
const PANEL_WIDTH = 320;

export interface BankedResetsButtonProps {
  banked: BankedResets;
  accountLabel: string;
  canUse: boolean;
  using: boolean;
  onUse: () => void;
}

export function BankedResetsButton({
  banked,
  accountLabel,
  canUse,
  using,
  onUse,
}: BankedResetsButtonProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAt(null), []);
  const soonest = banked.items.find((item) => item.expiresAtMs !== null)?.expiresAtMs ?? null;
  const expiringSoon = soonest !== null && soonest - now < EXPIRING_SOON_MS;

  return (
    <>
      <button
        type="button"
        data-shot="banked-resets"
        className={[
          styles.pill,
          banked.available === 0 ? styles.pillEmpty : '',
          expiringSoon ? styles.pillUrgent : '',
        ].join(' ')}
        onClick={(event) => setAt(pointUnder(event.currentTarget, PANEL_WIDTH))}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        title={t('quota_management.banked_title')}
      >
        <IconTicket size={13} aria-hidden="true" />
        <span className={styles.pillCount}>{banked.available}</span>
        <span className={styles.srOnly}>{t('quota_management.banked_title')}</span>
      </button>

      {at && (
        <FloatingPanel
          at={at}
          label={t('quota_management.banked_title')}
          role="dialog"
          onClose={close}
        >
          <div className={styles.panel} data-shot="banked-panel">
            <div className={styles.header}>
              <span className={styles.heading}>
                <IconTicket size={14} aria-hidden="true" />
                {t('quota_management.banked_title')}
              </span>
              <span className={styles.available}>
                {t('quota_management.banked_available', { count: banked.available })}
              </span>
            </div>
            <div className={styles.account}>{accountLabel}</div>

            {banked.items.length === 0 ? (
              <div className={styles.empty}>{t('quota_management.banked_none')}</div>
            ) : (
              <ul className={styles.list}>
                {banked.items.map((item) => {
                  const soon =
                    item.expiresAtMs !== null && item.expiresAtMs - now < EXPIRING_SOON_MS;
                  return (
                    <li key={item.id} className={`${styles.item} ${soon ? styles.itemSoon : ''}`}>
                      <span className={styles.itemCount}>×{item.count}</span>
                      <span className={styles.itemBody}>
                        {item.expiresAtMs === null ? (
                          <span className={styles.itemPrimary}>
                            {t('quota_management.banked_no_expiry')}
                          </span>
                        ) : (
                          <>
                            <span className={styles.itemPrimary}>
                              {formatExpiresIn(item.expiresAtMs, now, t)}
                            </span>
                            <span className={styles.itemSecondary}>
                              {formatResetInstant(item.expiresAtMs, i18n.resolvedLanguage)}
                            </span>
                          </>
                        )}
                        {!item.usableNow && (
                          <span className={styles.itemSecondary}>
                            {t('quota_management.banked_not_usable')}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              type="button"
              className={styles.useButton}
              disabled={!canUse || using || banked.available === 0}
              onClick={() => {
                close();
                onUse();
              }}
            >
              {using ? t('quota_management.banked_using') : t('quota_management.banked_use')}
            </button>
            <div className={styles.hint}>{t('quota_management.banked_use_hint')}</div>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
