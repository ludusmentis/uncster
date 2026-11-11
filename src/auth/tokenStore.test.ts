/**
 * Tests for the on-demand token provider (M005-S01-T2) and its interplay
 * with the token store:
 * - getToken returns a stored usable token without any network call
 * - getToken refreshes an expired token via the shared single-flight
 * - concurrent getToken calls share exactly one refresh
 * - getToken shares the refresh flight with authedFetch 401 callers
 * - no stored session → NotConnectedError + disconnected auth state
 * - refresh failure → tokens wiped + disconnected state + error rethrown
 * - resetRefreshFlight clears the slot so a later getToken refreshes again
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
    .process.env;
  env.VITE_SPOTIFY_CLIENT_ID ??= 'test-client-id';
});
import { authedFetch, getToken, NotConnectedError, resetRefreshFlight } from '../api/authedFetch';
import { clearTokens, loadTokens, saveTokens, type StoredTokens } from './tokenStore';
import { getAuthState, subscribeAuth, type AuthState } from './AuthContext';
import { RefreshTokenError } from './spotifyAuth';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1/me';

function expiredTokens(accessToken = 'stale-token'): StoredTokens {
  return {
    accessToken,
    refreshToken: 'refresh-1',
    expiresAt: Date.now() - 1000,
    scope: 'streaming',
  };
}

function usableTokens(accessToken = 'live-token'): StoredTokens {
  return {
    accessToken,
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3600_000,
    scope: 'streaming',
  };
}

function tokenResponse(accessToken: string): Response {
  return new Response(
    JSON.stringify({ access_token: accessToken, token_type: 'Bearer', expires_in: 3600 }),
    { status: 200 },
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('tokenStore / getToken provider', () => {
  let authEvents: AuthState[];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'test-client-id');
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    });
    resetRefreshFlight();
    authEvents = [];
    subscribeAuth((s) => authEvents.push({ ...s }));
  });

  afterEach(() => {
    clearTokens();
    resetRefreshFlight();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('returns the stored access token when still usable, without network calls', async () => {
    saveTokens(usableTokens('live-token'));
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getToken()).resolves.toBe('live-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently refreshes an expired token and returns the fresh access token', async () => {
    saveTokens(expiredTokens('stale-token'));
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) return tokenResponse('fresh-token');
      throw new Error('unexpected fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getToken()).resolves.toBe('fresh-token');
    // Refresh persisted the new tokens with the old refresh token kept.
    expect(loadTokens()?.accessToken).toBe('fresh-token');
    expect(loadTokens()?.refreshToken).toBe('refresh-1');
  });

  it('coalesces concurrent getToken calls into a single refresh', async () => {
    saveTokens(expiredTokens());
    let releaseRefresh: (r: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => (releaseRefresh = resolve));
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) return gate;
      throw new Error('unexpected fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const calls = [getToken(), getToken(), getToken()];
    releaseRefresh(tokenResponse('fresh-token'));
    const results = await Promise.all(calls);
    expect(results).toEqual(['fresh-token', 'fresh-token', 'fresh-token']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh between getToken and a concurrent authedFetch 401', async () => {
    saveTokens(expiredTokens());
    let releaseRefresh: (r: Response) => void = () => {};
    const gate = new Promise<Response>((resolve) => (releaseRefresh = resolve));
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) return gate;
      return jsonResponse(401, { error: 'token expired' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokenCall = getToken();
    const fetchCall = authedFetch(API_URL);
    releaseRefresh(tokenResponse('fresh-token'));
    // authedFetch retries once with the fresh token and gets 401 again — fine,
    // the assertion here is the shared flight: exactly one token POST.
    const [token, response] = await Promise.all([tokenCall, fetchCall]);
    expect(token).toBe('fresh-token');
    expect(response.status).toBe(401);
    const tokenPosts = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === TOKEN_URL,
    );
    expect(tokenPosts).toHaveLength(1);
  });

  it('throws NotConnectedError and emits disconnected when no tokens are stored', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(getToken()).rejects.toBeInstanceOf(NotConnectedError);
    expect(getAuthState().status).toBe('disconnected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('wipes tokens and disconnects when the refresh fails', async () => {
    saveTokens(expiredTokens());
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) return jsonResponse(400, { error: 'invalid_grant' });
      throw new Error('unexpected fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getToken()).rejects.toBeInstanceOf(RefreshTokenError);
    expect(loadTokens()).toBeNull();
    expect(getAuthState().status).toBe('disconnected');
  });

  it('resetRefreshFlight clears the slot so the next getToken refreshes again', async () => {
    saveTokens(expiredTokens('stale-1'));
    let refreshCount = 0;
    fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) {
        refreshCount += 1;
        return tokenResponse(`fresh-${refreshCount}`);
      }
      throw new Error('unexpected fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    // After a completed refresh, the flight slot is already released — this
    // guard targets the logout path where a flight may be manually reset.
    await expect(getToken()).resolves.toBe('fresh-1');
    resetRefreshFlight();
    // Manually expire the stored token again (refreshAccessToken extends expiry).
    saveTokens(expiredTokens('stale-2'));
    await expect(getToken()).resolves.toBe('fresh-2');
    expect(refreshCount).toBe(2);
  });
});
