import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { authApi } from '$lib/api/auth';
import { sounds } from '$lib/audio/sounds';
import { session } from '$lib/stores/session';

/**
 * Perform a clean logout:
 * 1. Play the click sound.
 * 2. Call the backend to revoke the refresh token (best-effort).
 * 3. Clear the local session regardless of the backend result.
 * 4. Navigate to /login.
 *
 * The backend call is best-effort because even if it fails (network error,
 * 401, etc.), the user should still be logged out locally.
 */
export async function performLogout(): Promise<void> {
  sounds.play('click');

  try {
    await authApi.logout();
  } catch {
    // Silent — the user is logged out locally regardless.
  } finally {
    session.clear();
    session.markHydrated();
    await goto(resolve('/login'));
  }
}
