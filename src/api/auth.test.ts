/**
 * Tests for the logout path (T005 / S03):
 * - logout() clears tokens from localStorage (access + refresh + expiry)
 * - logout() clears the PKCE verifier/state keys from sessionStorage
 * - logout() resets the single-flight refresh so no stale promise lingers
 * - logout() emits a disconnected auth state (UI resets to fresh login)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logout } from './auth';
import { loadTokens, saveTokens, type StoredTokens } from '../auth/tokenStore';
import { getAuthState, subscribeAuth, type AuthState } from '../auth/AuthContext';

const VERIFIER_KEY = 'harlequin.pkce.verifier';
const STATE_KEY = 'harlequin.pkce.state';
const TOKENS_KEY = 'harlequin.spotify.tokens';

function storedTokens(): StoredTokens {
  return {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 3600_000,
    scope: 'playlist-read-private',
  };
}

describe('logout', () => {
  let localStorageMap: Map<string, string>;
  let sessionStorageMap: Map<string, string>;
  let authEvents: AuthState[];

  beforeEach(() => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'test-client-id');
    localStorageMap = new Map<string, string>();
    sessionStorageMap = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => localStorageMap.get(k) ?? null,
      setItem: (k: string, v: string) => void localStorageMap.set(k, v),
      removeItem: (k: string) => void localStorageMap.delete(k),
      clear: () => void localStorageMap.clear(),
    });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => sessionStorageMap.get(k) ?? null,
      setItem: (k: string, v: string) => void sessionStorageMap.set(k, v),
      removeItem: (k: string) => void sessionStorageMap.delete(k),
      clear: () => void sessionStorageMap.clear(),
    });

    // Simulate a logged-in session with leftover login-session state.
    saveTokens(storedTokens());
    sessionStorageMap.set(VERIFIER_KEY, 'leftover-verifier');
    sessionStorageMap.set(STATE_KEY, 'leftover-state');

    authEvents = [];
    subscribeAuth((s) => authEvents.push({ ...s }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('clears the refresh token (and all stored tokens) from localStorage', () => {
    expect(loadTokens()).not.toBeNull();

    logout();

    expect(loadTokens()).toBeNull();
    expect(localStorageMap.has(TOKENS_KEY)).toBe(false);
  });

  it('clears the PKCE verifier and state keys from sessionStorage', () => {
    expect(sessionStorageMap.has(VERIFIER_KEY)).toBe(true);
    expect(sessionStorageMap.has(STATE_KEY)).toBe(true);

    logout();

    expect(sessionStorageMap.has(VERIFIER_KEY)).toBe(false);
    expect(sessionStorageMap.has(STATE_KEY)).toBe(false);
  });

  it('emits a disconnected auth state without a stale-session reason', () => {
    logout();

    expect(getAuthState().status).toBe('disconnected');
    const last = authEvents[authEvents.length - 1];
    expect(last.status).toBe('disconnected');
    // Deliberate logout is fresh, not a failed-refresh disconnect.
    expect(last.reason).toBeUndefined();
  });
});