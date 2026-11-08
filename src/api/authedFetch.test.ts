/**
 * Tests for authedFetch (D003 / R009):
 * - 401 → single-flight silent refresh → one retry with the fresh token
 * - concurrent 401s share one refresh (exactly one token exchange)
 * - refresh failure → tokens wiped + disconnected auth state emitted
 * - no stored tokens → NotConnectedError
 * - non-401 API errors are surfaced untouched (no refresh attempted)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// spotifyAuth.ts captures import.meta.env.VITE_SPOTIFY_CLIENT_ID at module
// load, so the id must exist before that module is imported. vi.hoisted runs
// before imports; a beforeEach vi.stubEnv alone is too late when the ambient
// shell does not export the var (e.g. sanitized test environments), which
// made the refresh tests fail outside the dev shell.
vi.hoisted(() => {
  // Cast only for typing: `process` exists at runtime in vitest's node env.
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
    .process.env;
  env.VITE_SPOTIFY_CLIENT_ID ??= 'test-client-id';
});
import { authedFetch, NotConnectedError } from './authedFetch';
import { loadTokens, saveTokens, clearTokens, type StoredTokens } from '../auth/tokenStore';
import { getAuthState, subscribeAuth, type AuthState } from '../auth/AuthContext';
import { RefreshTokenError } from '../auth/spotifyAuth';

const API_URL = 'https://api.spotify.com/v1/me';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';

function storedTokens(accessToken = 'stale-token'): StoredTokens {
  return {
    accessToken,
    refreshToken: 'refresh-1',
    expiresAt: Date.now() - 1000,
    scope: 'playlist-read-private',
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('authedFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let authEvents: AuthState[];

  beforeEach(() => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'test-client-id');
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
      clear: () => void storage.clear(),
    });
    saveTokens(storedTokens());
    authEvents = [];
    subscribeAuth((s) => authEvents.push({ ...s }));
  });

  afterEach(() => {
    clearTokens();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('attaches the Bearer token and returns non-401 responses without refreshing', async () => {
    fetchMock = vi.fn(async (_url: RequestInfo | URL) =>
      jsonResponse(200, { id: 'user-1' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch(API_URL);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers as HeadersInit);
    expect(headers.get('Authorization')).toBe('Bearer stale-token');
    expect(fetchMock.mock.calls[0][0]).toBe(API_URL);
    // No token-endpoint call was made.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('api/token'))).toBe(
      false,
    );
  });

  it('on 401 refreshes once, retries the original request, and saves the fresh token', async () => {
    fetchMock = vi
      .fn()
      // API call with stale token: 401
      .mockImplementationOnce(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        expect(h.get('Authorization')).toBe('Bearer stale-token');
        return jsonResponse(401, { error: 'invalid token' });
      })
      // Token refresh
      .mockImplementationOnce(async (_url: RequestInfo | URL) => {
        expect(String(_url)).toBe(TOKEN_URL);
        return jsonResponse(200, {
          access_token: 'fresh-token',
          expires_in: 3600,
          scope: 'playlist-read-private',
        });
      })
      // Retry with fresh token: 200
      .mockImplementationOnce(async (url: RequestInfo | URL, init?: RequestInit) => {
        const h = new Headers(init?.headers);
        expect(h.get('Authorization')).toBe('Bearer fresh-token');
        expect(String(url)).toBe(API_URL);
        return jsonResponse(200, { id: 'user-1' });
      });
    vi.stubGlobal('fetch', fetchMock);

    const res = await authedFetch(API_URL);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Refresh token response omitted refresh_token → old one kept.
    const stored = loadTokens();
    expect(stored?.accessToken).toBe('fresh-token');
    expect(stored?.refreshToken).toBe('refresh-1');
    expect(stored?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('concurrent 401s share a single refresh (single-flight): one token exchange total', async () => {
    fetchMock = vi.fn().mockImplementation(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const authHeader = new Headers(init?.headers).get('Authorization');
        if (String(url) === TOKEN_URL) {
          // Token exchange in flight; other 401 callers must await it.
          await new Promise((r) => setTimeout(r, 20));
          return jsonResponse(200, { access_token: 'shared-fresh', expires_in: 3600 });
        }
        return authHeader === 'Bearer stale-token'
          ? jsonResponse(401, {})
          : jsonResponse(200, { ok: true });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const results = await Promise.all([
      authedFetch(API_URL),
      authedFetch('https://api.spotify.com/v1/me/playlists'),
      authedFetch('https://api.spotify.com/v1/search?q=x'),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    // 3 API calls + 1 refresh + 3 retries = 7 fetches, exactly 1 token POST.
    const tokenCalls = fetchMock.mock.calls.filter(
      (c) => String(c[0]) === TOKEN_URL,
    );
    expect(tokenCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('on refresh failure wipes tokens, emits disconnected state, and throws', async () => {
    fetchMock = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) {
        return jsonResponse(400, { error: 'invalid_grant' });
      }
      return jsonResponse(401, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(authedFetch(API_URL)).rejects.toBeInstanceOf(RefreshTokenError);
    expect(loadTokens()).toBeNull();
    const last = authEvents[authEvents.length - 1];
    expect(last.status).toBe('disconnected');
    expect(last.reason).toContain('invalid_grant');
    expect(getAuthState().status).toBe('disconnected');
  });

  it('throws NotConnectedError and emits disconnected when no tokens are stored', async () => {
    clearTokens();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(authedFetch(API_URL)).rejects.toBeInstanceOf(NotConnectedError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(authEvents[authEvents.length - 1].status).toBe('disconnected');
  });

  it('still-401 after refresh is returned to the caller without a retry loop', async () => {
    fetchMock = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) {
        return jsonResponse(200, { access_token: 'fresh-but-rejected', expires_in: 3600 });
      }
      return jsonResponse(401, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    const res = await authedFetch(API_URL);
    expect(res.status).toBe(401);
    // 1 API + 1 refresh + 1 retry = 3, then stops (no loop).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('network failure during refresh is wrapped as RefreshTokenError and wipes tokens', async () => {
    fetchMock = vi.fn().mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url) === TOKEN_URL) {
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse(401, {});
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    await expect(authedFetch(API_URL)).rejects.toBeInstanceOf(RefreshTokenError);
    expect(loadTokens()).toBeNull();
    expect(getAuthState().status).toBe('disconnected');
  });
});
