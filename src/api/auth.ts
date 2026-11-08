/**
 * Session teardown (T005 / S03).
 *
 * logout() clears every piece of stored session state:
 * - tokens (access + refresh + expiry + scope) via tokenStore.clearTokens()
 * - the PKCE verifier/state session keys via clearLoginSession()
 * - any in-flight silent-refresh promise via resetRefreshFlight()
 * and emits a disconnected auth state so the UI resets to a fresh
 * PKCE login on the next visit.
 */

import { clearTokens } from '../auth/tokenStore';
import { clearLoginSession } from '../auth/spotifyAuth';
import { emitAuthDisconnected } from '../auth/AuthContext';
import { resetRefreshFlight } from './authedFetch';

/**
 * Log out: wipe all stored session state and reset the auth module so the
 * next visit starts a fresh PKCE login (no reuse of stale tokens or
 * in-flight refresh promises).
 */
export function logout(): void {
  clearTokens();
  clearLoginSession();
  resetRefreshFlight();
  emitAuthDisconnected();
}