/**
 * Quota-board data that lives in the CLIProxyAPI fork rather than upstream:
 * recent routed requests and Claude banked resets.
 * Server side: core/internal/api/handlers/management (recent-requests, claude_banked_resets.go).
 */

import type { ClaudeBankedResetStatus } from '@/types';
import { apiClient } from './client';

export interface RecentRequest {
  startedAtMs: number;
  /** When the record was published; a long stream completes well after it starts. */
  completedAtMs: number;
  provider: string;
  authIndex: string;
  model: string;
  failed: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface RecentRequests {
  /** Mirrors `usage-statistics-enabled`: when false, core records no history. */
  enabled: boolean;
  requests: RecentRequest[];
}

type RawRecentRequest = {
  timestamp?: string;
  completed_at?: string;
  provider?: string;
  auth_index?: string | number;
  model?: string;
  alias?: string;
  failed?: boolean;
  status_code?: number;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
};

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const normalizeRecentRequest = (raw: RawRecentRequest): RecentRequest | null => {
  const startedAtMs = Date.parse(raw.timestamp ?? '');
  const authIndex = raw.auth_index === undefined ? '' : String(raw.auth_index);
  if (!Number.isFinite(startedAtMs) || authIndex === '') return null;
  const completedAtMs = Date.parse(raw.completed_at ?? '');
  return {
    startedAtMs,
    completedAtMs: Number.isFinite(completedAtMs) ? completedAtMs : startedAtMs,
    provider: (raw.provider ?? '').toLowerCase(),
    authIndex,
    model: raw.model || raw.alias || '?',
    failed: raw.failed === true,
    statusCode: finiteOrNull(raw.status_code),
    latencyMs: finiteOrNull(raw.latency_ms),
    inputTokens: finiteOrNull(raw.input_tokens),
    outputTokens: finiteOrNull(raw.output_tokens),
  };
};

export const quotaInsightsApi = {
  recentRequests: async (limit = 500): Promise<RecentRequests> => {
    const data = await apiClient.get<{ enabled?: boolean; requests?: RawRecentRequest[] }>(
      '/recent-requests',
      { params: { limit } }
    );
    return {
      // A core that predates the flag can't say; assume history is on.
      enabled: data?.enabled !== false,
      requests: (data?.requests ?? [])
        .map(normalizeRecentRequest)
        .filter((request): request is RecentRequest => request !== null),
    };
  },
  claudeBankedResets: async (authIndex: string): Promise<ClaudeBankedResetStatus | null> => {
    const data = await apiClient.get<{ banked_resets?: ClaudeBankedResetStatus | null }>(
      '/claude/banked-resets',
      { params: { auth_index: authIndex } }
    );
    return data?.banked_resets ?? null;
  },
  useClaudeBankedReset: (authIndex: string) =>
    apiClient.post<{ status: string; claim?: { result?: string; reason?: string } }>(
      '/claude/banked-resets/use',
      { auth_index: authIndex }
    ),
};
