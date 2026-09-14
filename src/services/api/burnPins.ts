/**
 * Burn pins: route all of a provider's traffic to one credential until a
 * fixed duration elapses or the credential's usage window resets.
 * Server side lives in the CLIProxyAPI fork (internal/api/handlers/management/burn_pin.go).
 */

import { apiClient } from './client';

export type BurnWindow = 'five-hour-reset' | 'weekly-reset';

export interface BurnPin {
  provider: string;
  auth_id: string;
  name: string;
  auth_index?: string;
  indefinite: boolean;
  expires_at?: string;
  remaining_seconds?: number;
  mode?: BurnWindow;
}

export type BurnPinRequest =
  | { auth_index: string; duration_seconds: number }
  | { auth_index: string; until: BurnWindow };

export const burnPinsApi = {
  list: async (): Promise<BurnPin[]> => {
    const data = await apiClient.get<{ pins?: BurnPin[] }>('/burn-pins');
    return data?.pins ?? [];
  },
  set: (body: BurnPinRequest) =>
    apiClient.post<{ status: string; pin: BurnPin }>('/burn-pins', body),
  clearByAuthIndex: (authIndex: string) =>
    apiClient.delete<{ status: string }>('/burn-pins', { params: { auth_index: authIndex } }),
  clearByProvider: (provider: string) =>
    apiClient.delete<{ status: string }>('/burn-pins', { params: { provider } }),
};
