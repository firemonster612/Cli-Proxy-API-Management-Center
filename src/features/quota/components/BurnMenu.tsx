/**
 * "Only burn this account" popover. Opens at a screen point (right-click) or
 * under an anchor (the flame button); closes on outside click, Escape, or
 * scroll. Portaled to body so row overflow cannot clip it.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconFlame } from '@/components/ui/icons';
import type { BurnPin } from '@/services/api';
import { BURN_CHOICES, type BurnChoice } from '../hooks/useBurnPins';
import styles from './BurnMenu.module.scss';

export interface BurnMenuProps {
  /** Screen point to open at; the menu shifts to stay inside the viewport. */
  at: { x: number; y: number };
  title: string;
  pin?: BurnPin;
  busy: boolean;
  onChoose: (choice: BurnChoice) => void;
  onStop: () => void;
  onClose: () => void;
}

const VIEWPORT_MARGIN = 8;

export function BurnMenu({ at, title, pin, busy, onChoose, onStop, onClose }: BurnMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: at.x, top: at.y });

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(at.x, window.innerWidth - rect.width - VIEWPORT_MARGIN)
    );
    const top = Math.max(
      VIEWPORT_MARGIN,
      Math.min(at.y, window.innerHeight - rect.height - VIEWPORT_MARGIN)
    );
    setPosition({ left, top });
  }, [at.x, at.y]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className={styles.menu} style={position} role="menu" aria-label={title}>
      <div className={styles.title} title={title}>
        {title}
      </div>
      <div className={styles.heading}>
        <IconFlame size={13} aria-hidden="true" />
        {t('quota_management.burn_only_this')}
      </div>
      {BURN_CHOICES.map((choice) => (
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
    </div>,
    document.body
  );
}
