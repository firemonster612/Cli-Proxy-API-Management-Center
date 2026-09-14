/**
 * Map a provider's loaded quota state onto the board's fixed columns:
 * 5-hour, weekly, and a model-specific weekly. Providers without such a
 * shape (antigravity, kimi, xai) return null and keep their own body.
 * React-free so tests/quotaColumns.test.ts can consume it directly.
 */

import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export interface QuotaCellData {
  /** Percent of the window still available; null when the payload had none. */
  remaining: number | null;
  resetAtMs: number | null;
  /** Provider-formatted absolute reset label, shown in the tooltip. */
  resetLabel: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
}

export interface QuotaColumns {
  fiveHour: QuotaCellData | null;
  weekly: QuotaCellData | null;
  weeklyModel: QuotaCellData | null;
}

interface WindowLike {
  id: string;
  label: string;
  labelKey?: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetLabel: string;
  resetAtMs?: number | null;
}

const toCell = (window: WindowLike | undefined): QuotaCellData | null => {
  if (!window) return null;
  const used = window.usedPercent;
  const remaining = used === null ? null : Math.max(0, Math.min(100, 100 - used));
  return {
    remaining,
    resetAtMs: typeof window.resetAtMs === 'number' ? window.resetAtMs : null,
    resetLabel: window.resetLabel,
    label: window.label,
    labelKey: window.labelKey,
    labelParams: window.labelParams,
  };
};

/** Claude's model-scoped weekly windows, in the order the board prefers. */
const CLAUDE_MODEL_WEEKLY_IDS = [
  'seven-day-opus',
  'seven-day-sonnet',
  'seven-day-fable',
  'seven-day-cowork',
  'seven-day-oauth-apps',
];

export function buildQuotaColumns(
  type: QuotaProviderType,
  quota: QuotaCardState | undefined
): QuotaColumns | null {
  if (!quota || quota.status !== 'success') return null;
  switch (type) {
    case 'claude': {
      const windows = (quota as ClaudeQuotaState).windows ?? [];
      const byId = new Map(windows.map((window) => [window.id, window]));
      const modelWindow = CLAUDE_MODEL_WEEKLY_IDS.map((id) => byId.get(id)).find(Boolean);
      return {
        fiveHour: toCell(byId.get('five-hour')),
        weekly: toCell(byId.get('seven-day')),
        weeklyModel: toCell(modelWindow),
      };
    }
    case 'codex': {
      const windows = (quota as CodexQuotaState).windows ?? [];
      const byId = new Map(windows.map((window) => [window.id, window]));
      return {
        fiveHour: toCell(byId.get('five-hour')),
        weekly: toCell(byId.get('weekly') ?? byId.get('monthly')),
        weeklyModel: null,
      };
    }
    default:
      return null;
  }
}

/** Whether the board lays this provider out in columns at all. */
export const hasQuotaColumns = (type: QuotaProviderType): boolean =>
  type === 'claude' || type === 'codex';

export const LOW_REMAINING_PERCENT = 10;
export const WARN_REMAINING_PERCENT = 30;

/** True when a decision-driving window (5-hour or weekly) is under the low line. */
export function isRunningLow(columns: QuotaColumns | null): boolean {
  if (!columns) return false;
  return [columns.fiveHour, columns.weekly].some(
    (cell) => cell?.remaining !== null && cell !== null && cell.remaining < LOW_REMAINING_PERCENT
  );
}
