import { httpClient } from './client';
import type { CreateUserPayload, LoginPayload, LoginResponse, User } from '$lib/types/api';

export const authApi = {
  login: (payload: LoginPayload): Promise<LoginResponse> =>
    httpClient.post<LoginResponse>('/api/v2/auth/login', payload),

  register: (payload: CreateUserPayload): Promise<LoginResponse> =>
    httpClient.post<LoginResponse>('/api/v2/auth/register', payload),

  me: (): Promise<User> => httpClient.get<User>('/api/v2/auth/me'),

  logout: (): Promise<void> => httpClient.post<void>('/api/v2/auth/logout'),

  refresh: (): Promise<{ access_token: string; token_type: string }> =>
    httpClient.post<{ access_token: string; token_type: string }>('/api/v2/auth/refresh')
};
