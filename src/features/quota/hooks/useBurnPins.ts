/**
 * Burn pins for the quota page: one poll loop for the active pins plus the
 * set/clear actions. Pins are keyed by auth_index, which is what the rows
 * carry; a file without an auth_index cannot be pinned.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { burnPinsApi, type BurnPin, type BurnPinRequest } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';

const BURN_PIN_POLL_MS = 5000;

export type BurnChoice =
  | { kind: 'duration'; seconds: number }
  | { kind: 'until'; window: 'five-hour-reset' | 'weekly-reset' };

/** Menu entries in display order; labels resolve through quota_management.burn_*. */
export const BURN_CHOICES: Array<BurnChoice & { labelKey: string }> = [
  { kind: 'duration', seconds: 1800, labelKey: 'burn_30m' },
  { kind: 'duration', seconds: 3600, labelKey: 'burn_1h' },
  { kind: 'duration', seconds: 7200, labelKey: 'burn_2h' },
  { kind: 'duration', seconds: 10800, labelKey: 'burn_3h' },
  { kind: 'until', window: 'five-hour-reset', labelKey: 'burn_until_five_hour' },
  { kind: 'until', window: 'weekly-reset', labelKey: 'burn_until_weekly' },
  { kind: 'duration', seconds: 0, labelKey: 'burn_indefinite' },
];

const authIndexOf = (file: AuthFileItem): string | null => {
  const raw = file.authIndex;
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  return value === '' ? null : value;
};

const errorMessage = (err: unknown, fallback: string): string => {
  if (err && typeof err === 'object') {
    const data = (err as { response?: { data?: { error?: string } } }).response?.data;
    if (data?.error) return data.error;
    if ('message' in err && typeof (err as Error).message === 'string') {
      return (err as Error).message;
    }
  }
  return fallback;
};

export function useBurnPins(enabled: boolean) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [pins, setPins] = useState<BurnPin[]>([]);
  const [busyAuthIndex, setBusyAuthIndex] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setPins(await burnPinsApi.list());
    } catch {
      // A failed poll keeps the last known pins; the next tick retries.
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), BURN_PIN_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  const pinsByAuthIndex = useMemo(() => {
    const map = new Map<string, BurnPin>();
    for (const pin of pins) {
      if (pin.auth_index) map.set(pin.auth_index, pin);
    }
    return map;
  }, [pins]);

  const pinFor = useCallback(
    (file: AuthFileItem): BurnPin | undefined => {
      const index = authIndexOf(file);
      return index ? pinsByAuthIndex.get(index) : undefined;
    },
    [pinsByAuthIndex]
  );

  const burn = useCallback(
    async (file: AuthFileItem, choice: BurnChoice) => {
      const index = authIndexOf(file);
      if (!index) {
        showNotification(t('quota_management.burn_missing_auth_index'), 'error');
        return;
      }
      const body: BurnPinRequest =
        choice.kind === 'until'
          ? { auth_index: index, until: choice.window }
          : { auth_index: index, duration_seconds: choice.seconds };
      setBusyAuthIndex(index);
      try {
        await burnPinsApi.set(body);
        showNotification(
          t('quota_management.burn_started', { name: file.email || file.name }),
          'success'
        );
      } catch (err: unknown) {
        showNotification(errorMessage(err, t('common.unknown_error')), 'error');
      } finally {
        setBusyAuthIndex(null);
        void refresh();
      }
    },
    [refresh, showNotification, t]
  );

  const stopBurning = useCallback(
    async (file: AuthFileItem) => {
      const index = authIndexOf(file);
      if (!index) return;
      setBusyAuthIndex(index);
      try {
        await burnPinsApi.clearByAuthIndex(index);
        showNotification(
          t('quota_management.burn_stopped', { name: file.email || file.name }),
          'info'
        );
      } catch (err: unknown) {
        showNotification(errorMessage(err, t('common.unknown_error')), 'error');
      } finally {
        setBusyAuthIndex(null);
        void refresh();
      }
    },
    [refresh, showNotification, t]
  );

  return { pins, pinFor, burn, stopBurning, busyAuthIndex };
}

/** "2h 05m" style remaining time; null for indefinite or unknown expiry. */
export function formatBurnRemaining(pin: BurnPin, nowMs: number): string | null {
  if (pin.indefinite || !pin.expires_at) return null;
  const end = Date.parse(pin.expires_at);
  if (Number.isNaN(end)) return null;
  const totalMinutes = Math.max(0, Math.round((end - nowMs) / 60_000));
  if (totalMinutes < 1) return '<1m';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}
