/**
 * Spotify Authorization Code + PKCE flow (per decision D002).
 *
 * Login: build the /authorize URL with S256 challenge + random state,
 * stash verifier/state in sessionStorage, redirect the browser.
 * Callback: verify state, POST the code + verifier to /api/token.
 */

import {
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
} from './pkce';
import { saveTokens, type StoredTokens } from './tokenStore';

const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';
const SCOPES = ['playlist-read-private'];

const VERIFIER_KEY = 'harlequin.pkce.verifier';
const STATE_KEY = 'harlequin.pkce.state';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined;

export class AuthError extends Error {}

export async function beginLogin(): Promise<void> {
  if (!CLIENT_ID) {
    throw new AuthError(
      'Missing VITE_SPOTIFY_CLIENT_ID — set it in the environment before connecting.',
    );
  }

  const verifier = await generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateState();

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });

  window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`);
}

/**
 * Remove any leftover PKCE verifier/state session keys. Used by logout()
 * (api/auth.ts) so a fresh login never reuses stale login-session state.
 */
export function clearLoginSession(): void {
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

export class StateMismatchError extends AuthError {}

export class CodeExchangeError extends AuthError {}

export class RefreshTokenError extends AuthError {}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
};

async function postTokenRequest(
  body: URLSearchParams,
): Promise<Response> {
  return fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
}

/**
 * Exchange the authorization code for tokens. Throws StateMismatchError if
 * the returned state does not match the one we sent, CodeExchangeError on
 * any token-endpoint failure (network, non-2xx, malformed body).
 */
export async function completeLogin(
  code: string,
  state: string,
): Promise<StoredTokens> {
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);

  // Single-use: clear regardless of outcome.
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);

  if (!expectedState || expectedState !== state) {
    throw new StateMismatchError(
      'OAuth state mismatch — possible CSRF or stale login attempt. Please start the login again.',
    );
  }
  if (!verifier || !CLIENT_ID) {
    throw new CodeExchangeError(
      'Login session missing — please start the login again.',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  });

  let response: Response;
  try {
    response = await postTokenRequest(body);
  } catch (err) {
    throw new CodeExchangeError(
      `Could not reach Spotify token endpoint: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      if (errBody.error_description || errBody.error) {
        detail = `${errBody.error ?? ''} ${errBody.error_description ?? ''}`.trim();
      }
    } catch {
      // non-JSON error body; keep the HTTP status detail
    }
    throw new CodeExchangeError(`Spotify token exchange failed: ${detail}`);
  }

  let tokenJson: {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  try {
    tokenJson = (await response.json()) as typeof tokenJson;
  } catch {
    throw new CodeExchangeError(
      'Spotify token endpoint returned a malformed (non-JSON) response.',
    );
  }

  if (
    typeof tokenJson.access_token !== 'string' ||
    typeof tokenJson.refresh_token !== 'string'
  ) {
    throw new CodeExchangeError(
      'Spotify token response missing access_token/refresh_token.',
    );
  }

  const expiresIn =
    typeof tokenJson.expires_in === 'number' ? tokenJson.expires_in : 3600;

  const tokens: StoredTokens = {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: typeof tokenJson.scope === 'string' ? tokenJson.scope : SCOPES.join(' '),
  };
  saveTokens(tokens);
  return tokens;
}

/**
 * Exchange a refresh token for a new access token (silent refresh, D003).
 * Throws RefreshTokenError on network failure, non-2xx (e.g. revoked
 * refresh token → HTTP 400 invalid_grant), or a malformed response body.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<StoredTokens> {
  if (!CLIENT_ID) {
    throw new RefreshTokenError(
      'Missing VITE_SPOTIFY_CLIENT_ID — cannot refresh the session.',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  });

  let response: Response;
  try {
    response = await postTokenRequest(body);
  } catch (err) {
    throw new RefreshTokenError(
      `Could not reach Spotify token endpoint: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as {
        error?: string;
        error_description?: string;
      };
      if (errBody.error_description || errBody.error) {
        detail = `${errBody.error ?? ''} ${errBody.error_description ?? ''}`.trim();
      }
    } catch {
      // non-JSON error body; keep the HTTP status detail
    }
    throw new RefreshTokenError(`Spotify token refresh failed: ${detail}`);
  }

  let tokenJson: TokenResponse;
  try {
    tokenJson = (await response.json()) as TokenResponse;
  } catch {
    throw new RefreshTokenError(
      'Spotify token endpoint returned a malformed (non-JSON) response.',
    );
  }

  if (typeof tokenJson.access_token !== 'string') {
    throw new RefreshTokenError(
      'Spotify token response missing access_token.',
    );
  }

  // Spotify does not always return a new refresh token; keep the old one.
  const tokens: StoredTokens = {
    accessToken: tokenJson.access_token,
    refreshToken:
      typeof tokenJson.refresh_token === 'string'
        ? tokenJson.refresh_token
        : refreshToken,
    expiresAt: Date.now() + tokenJson.expires_in * 1000,
    scope: typeof tokenJson.scope === 'string' ? tokenJson.scope : SCOPES.join(' '),
  };
  saveTokens(tokens);
  return tokens;
}
