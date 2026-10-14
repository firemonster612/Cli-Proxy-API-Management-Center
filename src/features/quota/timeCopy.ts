/**
 * Long-form time copy for places with room to spell it out:
 *
 *   Resets in 1 day, 7 hours
 *   Wed, 15 Oct, 4:12 AM
 *
 * The compact "1d 7h" countdown stays in the bar cells (compactCountdown.ts).
 * Pure; `nowMs` and the translator are passed in.
 */

import type { TFunction } from 'i18next';
import { formatCalendarDateTime, type ClockStyle } from '@/utils/time/calendar';
import { formatCompactCountdown } from './compactCountdown';
import { DAY_MS, HOUR_MS, MINUTE_MS } from '@/utils/time/durations';

/** The two largest units: "1 day, 7 hours", "3 hours, 5 minutes", "12 minutes". */
export function formatLongDuration(ms: number, t: TFunction): string {
  const total = Math.max(0, ms);
  const days = Math.floor(total / DAY_MS);
  const hours = Math.floor((total % DAY_MS) / HOUR_MS);
  const minutes = Math.max(
    days === 0 && hours === 0 ? 1 : 0,
    Math.floor((total % HOUR_MS) / MINUTE_MS)
  );
  const day = t('quota_management.unit_day', { count: days });
  const hour = t('quota_management.unit_hour', { count: hours });
  const minute = t('quota_management.unit_minute', { count: minutes });
  if (days > 0) return hours > 0 ? `${day}, ${hour}` : day;
  if (hours > 0) return minutes > 0 ? `${hour}, ${minute}` : hour;
  return minute;
}

export const formatResetsIn = (targetMs: number, nowMs: number, t: TFunction): string =>
  t('quota_management.resets_in', { duration: formatLongDuration(targetMs - nowMs, t) });

export const formatExpiresIn = (targetMs: number, nowMs: number, t: TFunction): string =>
  t('quota_management.expires_in', { duration: formatLongDuration(targetMs - nowMs, t) });

// Exact instants keep English names and the 12-hour clock by request, with the
// day before the month; the relative copy around them is what gets localized.
const INSTANT_LOCALE = 'en-US';
const INSTANT_CLOCK: ClockStyle = { hour: 'numeric', minute: '2-digit', hour12: true };

/** "Wed, 15 Oct, 4:12 AM" in the viewer's time zone. */
export const formatResetInstant = (atMs: number): string =>
  formatCalendarDateTime(atMs, INSTANT_LOCALE, { weekday: true, month: 'short' }, INSTANT_CLOCK);

/**
 * "Wed, 15/10, 4:12 AM": the same instant, compact enough for a bar cell.
 * A no-break space keeps "4:12 AM" whole when the cell wraps (engines differ
 * on whether Intl emits a breakable space there).
 */
export const formatResetInstantShort = (atMs: number): string =>
  formatCalendarDateTime(
    atMs,
    INSTANT_LOCALE,
    { weekday: true, month: 'numeric' },
    INSTANT_CLOCK
  ).replace(/\s(AM|PM)$/, '\u00a0$1');

/** "just now" / "4m ago" / "2h ago" / "3d ago": minute resolution, matching useNow. */
export function formatAgo(atMs: number, nowMs: number, t: TFunction): string {
  const minutes = Math.floor((nowMs - atMs) / MINUTE_MS);
  if (minutes < 1) return t('quota_management.ago_now');
  if (minutes < 60) return t('quota_management.ago_minutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('quota_management.ago_hours', { count: hours });
  return t('quota_management.ago_days', { count: Math.floor(hours / 24) });
}

/** How long an attempt has run: "42s" under a minute, then "3m", "1h 05m". */
export const formatRunningFor = (ms: number): string =>
  ms < MINUTE_MS ? `${Math.max(0, Math.floor(ms / 1000))}s` : formatCompactCountdown(ms, 0);

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** "4:12:09 PM" for request rows. */
export function formatClock(atMs: number, locale?: string): string {
  const key = locale ?? '';
  let formatter = clockFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
    clockFormatters.set(key, formatter);
  }
  return formatter.format(atMs);
}
