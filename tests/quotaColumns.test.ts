/**
 * Column mapping for the board: which provider window lands in which
 * column, remaining-percent inversion, and the low-usage row cue.
 */

import { describe, expect, test } from 'bun:test';
import { buildQuotaColumns, isRunningLow } from '@/features/quota/columns';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';

const window = (id: string, usedPercent: number | null, resetAtMs: number | null = null) => ({
  id,
  label: id,
  usedPercent,
  resetLabel: '09/14, 22:18',
  resetAtMs,
});

describe('buildQuotaColumns', () => {
  test('claude maps five-hour, seven-day, and the first model-scoped weekly', () => {
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        window('five-hour', 42, 1_000),
        window('seven-day', 71),
        window('seven-day-sonnet', 10),
        window('seven-day-opus', 18),
      ],
    };
    const columns = buildQuotaColumns('claude', quota);
    expect(columns?.fiveHour?.remaining).toBe(58);
    expect(columns?.fiveHour?.resetAtMs).toBe(1_000);
    expect(columns?.weekly?.remaining).toBe(29);
    expect(columns?.weeklyModel?.label).toBe('seven-day-opus');
  });

  test('codex maps five-hour and weekly (monthly as fallback), no model column', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      windows: [window('five-hour', 33), window('monthly', 12), window('code-review-weekly', 5)],
    };
    const columns = buildQuotaColumns('codex', quota);
    expect(columns?.fiveHour?.remaining).toBe(67);
    expect(columns?.weekly?.label).toBe('monthly');
    expect(columns?.weeklyModel).toBeNull();
  });

  test('unknown usage stays null rather than reading as empty', () => {
    const quota: ClaudeQuotaState = { status: 'success', windows: [window('five-hour', null)] };
    expect(buildQuotaColumns('claude', quota)?.fiveHour?.remaining).toBeNull();
  });

  test('returns null before load, on error, and for non-columnar providers', () => {
    expect(buildQuotaColumns('claude', undefined)).toBeNull();
    expect(buildQuotaColumns('claude', { status: 'error', windows: [] })).toBeNull();
    expect(buildQuotaColumns('kimi', { status: 'success' } as never)).toBeNull();
  });
});

describe('isRunningLow', () => {
  test('flags an exhausted decision window, ignores the model column', () => {
    const low = buildQuotaColumns('claude', {
      status: 'success',
      windows: [window('five-hour', 100), window('seven-day', 20)],
    });
    expect(isRunningLow(low)).toBe(true);

    const nearlyOut = buildQuotaColumns('claude', {
      status: 'success',
      windows: [window('five-hour', 95), window('seven-day', 20)],
    });
    expect(isRunningLow(nearlyOut)).toBe(false);

    const modelOnly = buildQuotaColumns('claude', {
      status: 'success',
      windows: [window('five-hour', 20), window('seven-day', 20), window('seven-day-opus', 100)],
    });
    expect(isRunningLow(modelOnly)).toBe(false);
    expect(isRunningLow(null)).toBe(false);
  });
});
