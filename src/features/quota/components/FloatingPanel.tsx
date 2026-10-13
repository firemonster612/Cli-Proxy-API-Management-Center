/**
 * Popover opened at a screen point (right-click) or under an anchor button.
 * Shifts to stay inside the viewport; closes on outside click, Escape,
 * scroll, or resize. Portaled to body so row overflow cannot clip it.
 */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './FloatingPanel.module.scss';

export interface FloatingPanelProps {
  at: { x: number; y: number };
  label: string;
  role?: 'menu' | 'dialog';
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

const VIEWPORT_MARGIN = 8;

export function FloatingPanel({
  at,
  label,
  role = 'menu',
  className,
  onClose,
  children,
}: FloatingPanelProps) {
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
    <div
      ref={ref}
      className={[styles.panel, className].filter(Boolean).join(' ')}
      style={position}
      role={role}
      aria-label={label}
    >
      {children}
    </div>,
    document.body
  );
}
