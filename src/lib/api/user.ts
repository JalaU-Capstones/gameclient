import { httpClient } from './client';
import type { User } from '$lib/types/api';

export type PublicUser = Pick<User, 'id' | 'name'>;

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
  }
};
