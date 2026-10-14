/**
 * Calendar dates are shown day before month everywhere: "15 Oct", "15/10/2026",
 * "Wed, 15 Oct, 4:12 AM".
 *
 * Intl decides output order from the locale, not from the order of the option
 * keys, so the date is assembled from `formatToParts`. The locale still
 * supplies month and weekday names, digits and the clock; only the order of
 * day, month and year is fixed here.
 */

export interface CalendarStyle {
  weekday?: boolean;
  /** Named months join with spaces ("15 Oct"); numeric ones with slashes ("15/10"). */
  month: 'short' | 'numeric' | '2-digit';
  day?: 'numeric' | '2-digit';
  year?: boolean;
}

export type ClockStyle = Pick<Intl.DateTimeFormatOptions, 'hour' | 'minute' | 'second' | 'hour12'>;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, options);
    } catch {
      // An unexpected locale tag throws RangeError; the browser default beats no date.
      formatter = new Intl.DateTimeFormat(undefined, options);
    }
    formatters.set(key, formatter);
  }
  return formatter;
}

/** "15 Oct", "Wed, 15/10", "15/10/2026" in the viewer's time zone. */
export function formatCalendarDate(
  ms: number,
  locale: string | undefined,
  style: CalendarStyle
): string {
  const parts = formatterFor(locale, {
    weekday: style.weekday ? 'short' : undefined,
    day: style.day ?? 'numeric',
    month: style.month,
    year: style.year ? 'numeric' : undefined,
  }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? '';

  const month = part('month');
  // Locales without short month names (zh) hand back digits; those join like numeric ones.
  const separator = /^\d+$/.test(month) ? '/' : ' ';
  const date = [part('day'), month, style.year ? part('year') : null]
    .filter((value) => value !== null)
    .join(separator);
  return style.weekday ? `${part('weekday')}, ${date}` : date;
}

/** The date as above, then the locale's own clock: "Wed, 15 Oct, 4:12 AM". */
export function formatCalendarDateTime(
  ms: number,
  locale: string | undefined,
  style: CalendarStyle,
  clock: ClockStyle
): string {
  const time = formatterFor(locale, clock).format(ms);
  return `${formatCalendarDate(ms, locale, style)}, ${time}`;
}

const NUMERIC_DATE: CalendarStyle = { month: 'numeric', year: true };
const LOCALE_CLOCK: ClockStyle = { hour: 'numeric', minute: '2-digit', second: '2-digit' };

/** Day-first stand-in for `Date#toLocaleDateString`: "15/10/2026". */
export const formatNumericDate = (ms: number, locale?: string): string =>
  formatCalendarDate(ms, locale, NUMERIC_DATE);

/** Day-first stand-in for `Date#toLocaleString`: "15/10/2026, 4:12:09 PM". */
export const formatNumericDateTime = (ms: number, locale?: string): string =>
  formatCalendarDateTime(ms, locale, NUMERIC_DATE, LOCALE_CLOCK);
