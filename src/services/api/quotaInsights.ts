/**
 * Quota-board data that lives in the CLIProxyAPI fork rather than upstream:
 * recent routed requests and Claude banked resets.
 * Server side: core/internal/api/handlers/management (recent-requests, claude_banked_resets.go).
 */

import { apiClient } from './client';

export interface RecentRequest {
  timeMs: number;
  provider: string;
  authIndex: string;
  model: string;
  failed: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

type RawRecentRequest = {
  timestamp?: string;
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
  const timeMs = Date.parse(raw.timestamp ?? '');
  const authIndex = raw.auth_index === undefined ? '' : String(raw.auth_index);
  if (!Number.isFinite(timeMs) || authIndex === '') return null;
  return {
    timeMs,
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

export interface ClaudeBankedResetGrant {
  id?: string;
  resets_left?: number;
  usable_now?: boolean;
  paused?: boolean;
  [key: string]: unknown;
}

export interface ClaudeBankedResetStatus {
  next_grant_id?: string;
  eligible?: boolean;
  grants?: ClaudeBankedResetGrant[];
  [key: string]: unknown;
}

export const quotaInsightsApi = {
  recentRequests: async (limit = 2000): Promise<RecentRequest[]> => {
    const data = await apiClient.get<{ requests?: RawRecentRequest[] }>('/recent-requests', {
      params: { limit },
    });
    return (data?.requests ?? [])
      .map(normalizeRecentRequest)
      .filter((request): request is RecentRequest => request !== null);
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
