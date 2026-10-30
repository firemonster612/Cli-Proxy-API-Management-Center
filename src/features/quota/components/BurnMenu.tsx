/**
 * "Only burn this account" popover. Opens at a screen point (right-click) or
 * under the flame button; FloatingPanel owns placement and dismissal.
 */

import { useTranslation } from 'react-i18next';
import { IconFlame } from '@/components/ui/icons';
import type { BurnPin } from '@/services/api';
import { BURN_CHOICES, type BurnChoice } from '../hooks/useBurnPins';
import { FloatingPanel } from './FloatingPanel';
import styles from './BurnMenu.module.scss';

export interface BurnMenuProps {
  /** Screen point to open at; the menu shifts to stay inside the viewport. */
  at: { x: number; y: number };
  title: string;
  pin?: BurnPin;
  /** The account has no five-hour limit, so "until the five-hour reset" never ends. */
  noFiveHourLimit?: boolean;
  busy: boolean;
  onChoose: (choice: BurnChoice) => void;
  onStop: () => void;
  onClose: () => void;
}

export function BurnMenu({
  at,
  title,
  pin,
  noFiveHourLimit = false,
  busy,
  onChoose,
  onStop,
  onClose,
}: BurnMenuProps) {
  const { t } = useTranslation();
  const choices = noFiveHourLimit
    ? BURN_CHOICES.filter(
        (choice) => !(choice.kind === 'until' && choice.window === 'five-hour-reset')
      )
    : BURN_CHOICES;

  return (
    <FloatingPanel at={at} label={title} onClose={onClose}>
      <div className={styles.title} title={title}>
        {title}
      </div>
      <div className={styles.heading}>
        <IconFlame size={13} aria-hidden="true" />
        {t('quota_management.burn_only_this')}
      </div>
      {choices.map((choice) => (
        <button
          key={choice.labelKey}
          type="button"
          role="menuitem"
          className={styles.item}
          disabled={busy}
          onClick={() => {
            onChoose(choice);
            onClose();
          }}
        >
          {t(`quota_management.${choice.labelKey}`)}
        </button>
      ))}
      {pin && (
        <button
          type="button"
          role="menuitem"
          className={`${styles.item} ${styles.stop}`}
          disabled={busy}
          onClick={() => {
            onStop();
            onClose();
          }}
        >
          {t('quota_management.burn_stop')}
        </button>
      )}
    </FloatingPanel>
  );
}
