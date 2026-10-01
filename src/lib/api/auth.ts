import { httpClient } from './client';
import type { LoginPayload, User } from '$lib/types/api';

export const authApi = {
  login: (payload: LoginPayload) => httpClient.post<unknown>('/api/v2/auth/login', payload),
  me: () => httpClient.get<User>('/api/v2/auth/me'),
  logout: () => httpClient.post<void>('/api/v2/auth/logout')
};
