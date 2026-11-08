/**
 * Token persistence. Tokens live in localStorage under a single key so the
 * home view can show the authenticated state across reloads.
 * Storage: localStorage (chosen for cross-tab visibility; Spotify tokens are
 * long-lived and SPA has no server session to attach them to).
 */

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  scope: string;
}

const STORAGE_KEY = 'harlequin.spotify.tokens';

export function saveTokens(tokens: StoredTokens): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function loadTokens(): StoredTokens | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    if (
      typeof parsed.accessToken === 'string' &&
      typeof parsed.refreshToken === 'string' &&
      typeof parsed.expiresAt === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/** Access token is only usable before it (or its 60s safety margin) expires. */
export function hasUsableAccessToken(tokens: StoredTokens | null): boolean {
  if (!tokens) return false;
  return Date.now() < tokens.expiresAt - 60_000;
}

export function accessTokenExpired(tokens: StoredTokens | null): boolean {
  return tokens !== null && !hasUsableAccessToken(tokens);
}
