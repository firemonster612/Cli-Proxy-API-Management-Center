/**
 * Banked resets: earned weekly-limit resets an account can spend later.
 * Codex calls them rate-limit reset credits (one per credit, each with an
 * expiry). Claude exposes grants with a `resets_left` count; its payload has
 * no confirmed expiry field, so expiry is read only when one is present.
 *
 * Pure; React-free so tests can consume it directly.
 */

import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export interface BankedReset {
  id: string;
  count: number;
  grantedAtMs: number | null;
  expiresAtMs: number | null;
  usableNow: boolean;
}

export interface BankedResets {
  /** Resets spendable right now. */
  available: number;
  /** Soonest expiry first; undated items last. */
  items: BankedReset[];
}

const toMs = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const byExpiry = (a: BankedReset, b: BankedReset) =>
  (a.expiresAtMs ?? Number.POSITIVE_INFINITY) - (b.expiresAtMs ?? Number.POSITIVE_INFINITY);

export const supportsBankedResets = (type: QuotaProviderType): boolean =>
  type === 'claude' || type === 'codex';

export function bankedResetsFor(
  type: QuotaProviderType,
  quota: QuotaCardState | undefined
): BankedResets | null {
  if (!quota || quota.status !== 'success') return null;

  if (type === 'codex') {
    const codex = quota as CodexQuotaState;
    const items = (codex.rateLimitResetCredits ?? []).map((credit) => ({
      id: credit.id,
      count: 1,
      grantedAtMs: toMs(credit.grantedAt),
      expiresAtMs: toMs(credit.expiresAt),
      usableNow: true,
    }));
    const available = codex.rateLimitResetCreditsAvailableCount ?? items.length;
    return { available, items: items.sort(byExpiry) };
  }

  if (type === 'claude') {
    const status = (quota as ClaudeQuotaState).bankedResets;
    if (!status) return null;
    const items = (status.grants ?? [])
      .map((grant, index) => ({
        id: typeof grant.id === 'string' ? grant.id : `grant-${index}`,
        count: typeof grant.resets_left === 'number' ? grant.resets_left : 0,
        grantedAtMs: toMs(grant.granted_at ?? grant.created_at),
        expiresAtMs: toMs(grant.expires_at ?? grant.expiry ?? grant.expires),
        usableNow: grant.usable_now === true && grant.paused !== true,
      }))
      .filter((item) => item.count > 0);
    const available = items.reduce((sum, item) => sum + (item.usableNow ? item.count : 0), 0);
    return { available, items: items.sort(byExpiry) };
  }

  return null;
}
