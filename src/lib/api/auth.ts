import { httpClient } from './client';
import type { LoginPayload, LoginResponse, User } from '$lib/types/api';

export const authApi = {
  login: (payload: LoginPayload): Promise<LoginResponse> =>
    httpClient.post<LoginResponse>('/api/v2/auth/login', payload),

  me: (): Promise<User> => httpClient.get<User>('/api/v2/auth/me'),

  logout: (): Promise<void> => httpClient.post<void>('/api/v2/auth/logout')
};
