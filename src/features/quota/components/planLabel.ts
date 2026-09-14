/**
 * Short plan label for the quota row identity column. Claude and Codex expose
 * a planType on their loaded state; providers without one return null and the
 * row falls back to the provider name.
 */

import type { TFunction } from 'i18next';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';
import {
  normalizePlanType,
  resolvePlanTier,
  PREMIUM_CODEX_PLAN_TYPES,
  type CodexPlanTier,
} from '@/utils/quota';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';

export interface QuotaPlanDisplay {
  label: string;
  /** Codex elite/premium plans keep their tinted styling in the identity column. */
  tier: CodexPlanTier;
}

/** Codex plan display label, moved out of CodexQuotaBody's former plan chip. */
export function codexPlanLabel(planType: string | null | undefined, t: TFunction): string | null {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_prolite');
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
}

export function quotaPlanLabel(
  type: QuotaProviderType,
  quota: QuotaCardState | undefined,
  t: TFunction
): QuotaPlanDisplay | null {
  if (!quota || quota.status !== 'success') return null;
  switch (type) {
    case 'claude': {
      const planType = (quota as ClaudeQuotaState).planType;
      return planType ? { label: t(`claude_quota.${planType}`), tier: 'plain' } : null;
    }
    case 'codex': {
      const planType = (quota as CodexQuotaState).planType;
      const label = codexPlanLabel(planType, t);
      return label ? { label, tier: resolvePlanTier(planType) } : null;
    }
    default:
      return null;
  }
}
