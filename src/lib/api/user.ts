import { httpClient } from './client';
import type { PublicUser, UpdateUserPayload } from '$lib/types/api';

export const usersApi = {
  getById: (id: string): Promise<PublicUser> =>
    httpClient.get<PublicUser>(`/api/v2/users/${encodeURIComponent(id)}`),

  getNames: async (ids: string[]): Promise<Record<string, string>> => {
    const uniqueIds = [...new Set(ids)];
    const results = await Promise.allSettled(uniqueIds.map((id) => usersApi.getById(id)));
    const names: Record<string, string> = {};
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') names[uniqueIds[index]] = result.value.name;
    });
    return names;
  },

  update: (id: string, payload: UpdateUserPayload): Promise<void> =>
    httpClient.put<void>(`/api/v2/users/${encodeURIComponent(id)}`, payload),

  delete: (id: string): Promise<void> =>
    httpClient.delete<void>(`/api/v2/users/${encodeURIComponent(id)}`)
};
