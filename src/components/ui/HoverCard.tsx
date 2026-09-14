/**
 * Small popover that opens under its anchor on hover, keyboard focus, or tap,
 * portaled to body so table cells cannot clip it. Content is the caller's;
 * this only owns open/close and placement.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './HoverCard.module.scss';

export interface HoverCardProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
}

const VIEWPORT_MARGIN = 8;
const GAP = 6;

export function HoverCard({ content, children, className }: HoverCardProps) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinnedByTap, setPinnedByTap] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});

  const close = useCallback(() => {
    setOpen(false);
    setPinnedByTap(false);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current?.getBoundingClientRect();
    const card = cardRef.current?.getBoundingClientRect();
    if (!anchor || !card) return;
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(anchor.left, window.innerWidth - card.width - VIEWPORT_MARGIN)
    );
    const below = anchor.bottom + GAP;
    const top =
      below + card.height + VIEWPORT_MARGIN > window.innerHeight
        ? Math.max(VIEWPORT_MARGIN, anchor.top - GAP - card.height)
        : below;
    setPosition({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, close]);

  return (
    <>
      <span
        ref={anchorRef}
        className={className}
        tabIndex={0}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          if (!pinnedByTap) setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinnedByTap) setOpen(false);
        }}
        onClick={() => {
          if (open && pinnedByTap) {
            close();
          } else {
            setOpen(true);
            setPinnedByTap(true);
          }
        }}
      >
        {children}
      </span>
      {open &&
        createPortal(
          <div ref={cardRef} className={styles.card} style={position} role="tooltip">
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
