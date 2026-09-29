import type { HealthResponse } from '$lib/types/api';
import { httpClient } from './client';

export const healthApi = {
  check(): Promise<HealthResponse> {
    return httpClient.get<HealthResponse>('/health');
  }
};
