/**
 * Authenticated Spotify Web API fetch wrapper (D003 / R009).
 *
 * - Attaches the Bearer access token from the token store.
 * - On 401, performs a single-flight silent refresh: concurrent 401s share
 *   one in-flight refresh promise, so N parallel API calls trigger exactly
 *   one token exchange.
 * - Retries the original request exactly once with the fresh token.
 * - On refresh failure: wipes stored tokens and emits a disconnected auth
 *   state so the UI shows a Reconnect Spotify action.
 *
 * Logging contract (D003): refresh attempts and failures are logged
 * distinctly from ordinary API errors using the `[auth:refresh]` prefix —
 * API (non-401) errors are surfaced to the caller untouched.
 */

import { refreshAccessToken } from '../auth/spotifyAuth';
import {
  clearTokens,
  loadTokens,
  type StoredTokens,
} from '../auth/tokenStore';
import { emitAuthDisconnected } from '../auth/AuthContext';

export class NotConnectedError extends Error {}

/** Single-flight refresh: all concurrent 401 callers await this promise. */
let refreshInFlight: Promise<StoredTokens> | null = null;

function singleFlightRefresh(refreshToken: string): Promise<StoredTokens> {
  if (!refreshInFlight) {
    console.info('[auth:refresh] access token rejected (401) — attempting silent refresh');
    refreshInFlight = refreshAccessToken(refreshToken)
      .then((tokens) => {
        console.info('[auth:refresh] silent refresh succeeded');
        return tokens;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

async function attachTokenAndFetch(
  url: string,
  tokens: StoredTokens,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  return fetch(url, { ...init, headers });
}

/** Reset the single-flight refresh slot (logout clears session state). */
export function resetRefreshFlight(): void {
  refreshInFlight = null;
}

/**
 * Fetch a Spotify Web API URL with the stored access token. Retries once
 * after a silent refresh on 401. Throws NotConnectedError when no tokens
 * are stored (and re-throws the refresh error after wiping tokens on
 * refresh failure).
 */
export async function authedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  let tokens = loadTokens();
  if (!tokens) {
    emitAuthDisconnected('No stored Spotify session.');
    throw new NotConnectedError('Not connected to Spotify.');
  }

  let response = await attachTokenAndFetch(url, tokens, init);

  if (response.status !== 401) {
    return response;
  }

  try {
    tokens = await singleFlightRefresh(tokens.refreshToken);
  } catch (err) {
    console.warn(
      '[auth:refresh] silent refresh failed — wiping stored tokens and disconnecting',
      err,
    );
    clearTokens();
    emitAuthDisconnected(
      err instanceof Error ? err.message : 'Token refresh failed.',
    );
    throw err;
  }

  // Single retry with the fresh token; a second 401 is returned to the
  // caller as-is (no retry loop).
  response = await attachTokenAndFetch(url, tokens, init);
  if (response.status === 401) {
    console.warn('[auth:refresh] request still 401 after refresh — giving up');
  }
  return response;
}
