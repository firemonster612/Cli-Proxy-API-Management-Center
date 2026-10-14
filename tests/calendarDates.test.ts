/**
 * Day-before-month calendar formatting and the log timestamp display form.
 */

import { describe, expect, test } from 'bun:test';
import {
  formatCalendarDate,
  formatCalendarDateTime,
  formatNumericDate,
  formatNumericDateTime,
} from '@/utils/time/calendar';
import { formatInstantShort } from '@/utils/quota';
import { formatLogTimestamp } from '@/pages/hooks/logParsing';

// Local-time constructor, so the expectations hold in any time zone.
const AT = new Date(2026, 9, 15, 16, 5, 9).getTime();

describe('formatCalendarDate', () => {
  test('puts the day before a named month', () => {
    expect(formatCalendarDate(AT, 'en-US', { month: 'short' })).toBe('15 Oct');
    expect(formatCalendarDate(AT, 'en-US', { month: 'short', weekday: true })).toBe('Thu, 15 Oct');
    expect(formatCalendarDate(AT, 'ru', { month: 'short' })).toBe('15 окт.');
  });

  test('joins numeric dates with slashes, year last', () => {
    expect(formatCalendarDate(AT, 'en-US', { month: '2-digit', day: '2-digit' })).toBe('15/10');
    expect(formatNumericDate(AT, 'en-US')).toBe('15/10/2026');
    expect(formatNumericDate(AT, 'zh-CN')).toBe('15/10/2026');
  });

  test('falls back to numeric order when a locale has no short month names', () => {
    expect(formatCalendarDate(AT, 'zh-CN', { month: 'short' })).toBe('15/10');
  });
});

describe('formatCalendarDateTime', () => {
  test("keeps the locale's own clock after the date", () => {
    expect(
      formatCalendarDateTime(
        AT,
        'en-US',
        { month: 'short', year: true },
        { hour: 'numeric', minute: '2-digit' }
      )
    ).toBe('15 Oct 2026, 4:05 PM');
    expect(formatNumericDateTime(AT, 'en-US')).toBe('15/10/2026, 4:05:09 PM');
    expect(formatNumericDateTime(AT, 'ru')).toBe('15/10/2026, 16:05:09');
  });
});

describe('formatInstantShort', () => {
  test('starts with the day', () => {
    expect(formatInstantShort(AT).startsWith('15')).toBe(true);
  });
});

describe('formatLogTimestamp', () => {
  test('rewrites the captured date day first without touching the time', () => {
    expect(formatLogTimestamp('2026-10-15 04:12:09.123')).toBe('15/10/2026 04:12:09.123');
    expect(formatLogTimestamp('2026-10-15T04:12:09')).toBe('15/10/2026 04:12:09');
  });

  test('leaves anything else as it was', () => {
    expect(formatLogTimestamp('04:12:09')).toBe('04:12:09');
  });
});
