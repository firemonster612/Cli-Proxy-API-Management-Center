/**
 * Identity-column plan labels: the mapping that moved out of the provider
 * bodies' plan chips must stay pinned here now that no body renders it.
 */

import { beforeAll, describe, expect, test } from 'bun:test';
import i18n from '@/i18n';
import { codexPlanLabel, quotaPlanLabel } from '@/features/quota/components/planLabel';
import type { ClaudeQuotaState, CodexQuotaState } from '@/types';

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

const t = (key: string) => i18n.t(key);

describe('codexPlanLabel', () => {
  test('maps known plan types through i18n', () => {
    expect(codexPlanLabel('pro', t as never)).toBe(i18n.t('codex_quota.plan_pro'));
    expect(codexPlanLabel('prolite', t as never)).toBe(i18n.t('codex_quota.plan_prolite'));
    expect(codexPlanLabel('plus', t as never)).toBe(i18n.t('codex_quota.plan_plus'));
    expect(codexPlanLabel('team', t as never)).toBe(i18n.t('codex_quota.plan_team'));
    expect(codexPlanLabel('free', t as never)).toBe(i18n.t('codex_quota.plan_free'));
  });

  test('falls back to the raw plan type for unknown plans and null for none', () => {
    expect(codexPlanLabel('Enterprise-X', t as never)).toBe('Enterprise-X');
    expect(codexPlanLabel(null, t as never)).toBeNull();
    expect(codexPlanLabel('', t as never)).toBeNull();
  });
});

describe('quotaPlanLabel', () => {
  test('claude plan resolves through its i18n key with plain tier', () => {
    const quota: ClaudeQuotaState = { status: 'success', windows: [], planType: 'plan_max20' };
    const display = quotaPlanLabel('claude', quota, t as never);
    expect(display).toEqual({ label: i18n.t('claude_quota.plan_max20'), tier: 'plain' });
  });

  test('codex pro carries the elite tier and prolite the premium tier', () => {
    const pro: CodexQuotaState = { status: 'success', windows: [], planType: 'pro' };
    expect(quotaPlanLabel('codex', pro, t as never)?.tier).toBe('elite');
    const prolite: CodexQuotaState = { status: 'success', windows: [], planType: 'prolite' };
    expect(quotaPlanLabel('codex', prolite, t as never)?.tier).toBe('premium');
  });

  test('returns null before load, on error, and for providers without plans', () => {
    expect(quotaPlanLabel('claude', undefined, t as never)).toBeNull();
    expect(
      quotaPlanLabel('claude', { status: 'error', windows: [] } as ClaudeQuotaState, t as never)
    ).toBeNull();
    expect(quotaPlanLabel('kimi', { status: 'success' } as never, t as never)).toBeNull();
  });
});
