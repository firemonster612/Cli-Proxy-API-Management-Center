/**
 * Quota-board data that lives in the CLIProxyAPI fork rather than upstream:
 * recent routed requests, in-flight attempts, the routing preview and Claude
 * banked resets.
 * Server side: core/internal/api/handlers/management (recent-requests,
 * in-flight-requests, routing/preview, claude_banked_resets.go).
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
  /** Logging request id; a retry that moved accounts shares it. Null when core didn't record one. */
  requestId: string | null;
  /** "Key #N" for a configured client key, "Key ?" otherwise. */
  clientKeyLabel: string | null;
  /** First hex digits of the client key's hash, never the key itself. */
  clientKeyFingerprint: string | null;
  userAgent: string | null;
  clientIp: string | null;
}

/** Core keeps at most this many recent requests overall (usagehistory.MaxTotal) and serves up to all of them. */
export const RECENT_REQUESTS_MAX = 2000;
/** Core keeps at most this many recent requests per account (usagehistory.MaxPerAuth). */
export const RECENT_REQUESTS_MAX_PER_ACCOUNT = 200;

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
  request_id?: string;
  client_key_label?: string;
  client_key_fingerprint?: string;
  user_agent?: string;
  client_ip?: string;
};

/** One upstream attempt that has been dispatched and hasn't finished. */
export interface InFlightAttempt {
  attemptId: string;
  requestId: string | null;
  provider: string;
  authIndex: string;
  model: string;
  kind: string;
  startedAtMs: number;
}

export interface InFlightRequests {
  /** Server clock at the snapshot; durations are measured against it, not the browser's. */
  observedAtMs: number;
  attempts: InFlightAttempt[];
  /** Core caps the list; true when attempts were left out. */
  truncated: boolean;
}

type RawInFlightAttempt = {
  attempt_id?: string;
  request_id?: string;
  provider?: string;
  auth_index?: string | number;
  model?: string;
  requested_model?: string;
  kind?: string;
  started_at?: string;
};

export interface RoutingExclusion {
  authIndex: string;
  reason: string;
  retryAtMs: number | null;
}

/** Where core would send a new request without a session, right now. */
export interface RoutingPreview {
  provider: string;
  model: string;
  /** False when routing here can't be predicted (Home dispatch, plugin scheduler, other strategies). */
  supported: boolean;
  strategy: string;
  sessionAffinityEnabled: boolean;
  chosenAuthIndex: string | null;
  reason: string;
  excluded: RoutingExclusion[];
}

type RawRoutingPreview = {
  provider?: string;
  model?: string;
  supported?: boolean;
  strategy?: string;
  session_affinity_enabled?: boolean;
  chosen_auth_index?: string | null;
  reason?: string;
  excluded?: { auth_index?: string | number; reason?: string; retry_at?: string }[];
};

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const msOrNull = (value: string | undefined): number | null => {
  const ms = Date.parse(value ?? '');
  return Number.isFinite(ms) ? ms : null;
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
    requestId: textOrNull(raw.request_id),
    clientKeyLabel: textOrNull(raw.client_key_label),
    clientKeyFingerprint: textOrNull(raw.client_key_fingerprint),
    userAgent: textOrNull(raw.user_agent),
    clientIp: textOrNull(raw.client_ip),
  };
};

const normalizeInFlightAttempt = (raw: RawInFlightAttempt): InFlightAttempt | null => {
  const startedAtMs = msOrNull(raw.started_at);
  const authIndex = raw.auth_index === undefined ? '' : String(raw.auth_index);
  if (startedAtMs === null || authIndex === '') return null;
  return {
    attemptId: raw.attempt_id ?? `${authIndex}-${startedAtMs}`,
    requestId: textOrNull(raw.request_id),
    provider: (raw.provider ?? '').toLowerCase(),
    authIndex,
    model: raw.model || raw.requested_model || '?',
    kind: raw.kind ?? '',
    startedAtMs,
  };
};

export const quotaInsightsApi = {
  recentRequests: async (limit = RECENT_REQUESTS_MAX): Promise<RecentRequests> => {
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
  inFlightRequests: async (): Promise<InFlightRequests> => {
    const data = await apiClient.get<{
      observed_at?: string;
      truncated?: boolean;
      requests?: RawInFlightAttempt[];
    }>('/in-flight-requests');
    return {
      observedAtMs: msOrNull(data?.observed_at) ?? Date.now(),
      truncated: data?.truncated === true,
      attempts: (data?.requests ?? [])
        .map(normalizeInFlightAttempt)
        .filter((attempt): attempt is InFlightAttempt => attempt !== null),
    };
  },
  /** Model omitted on purpose: core picks a representative and reports which. */
  routingPreview: async (provider: string): Promise<RoutingPreview> => {
    const data = await apiClient.get<RawRoutingPreview>('/routing/preview', {
      params: { provider },
    });
    return {
      provider: data?.provider ?? provider,
      model: data?.model ?? '',
      supported: data?.supported === true,
      strategy: data?.strategy ?? '',
      sessionAffinityEnabled: data?.session_affinity_enabled === true,
      chosenAuthIndex: textOrNull(data?.chosen_auth_index),
      reason: data?.reason ?? '',
      excluded: (data?.excluded ?? [])
        .filter((entry) => entry.auth_index !== undefined)
        .map((entry) => ({
          authIndex: String(entry.auth_index),
          reason: entry.reason ?? '',
          retryAtMs: msOrNull(entry.retry_at),
        })),
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
