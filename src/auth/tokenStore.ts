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

// v2 (D015, M005): pre-M005 sessions under LEGACY_STORAGE_KEY lack the
// Web Playback SDK scopes, so they are unusable for playback and must force
// one clean re-login under the new scope set.
const STORAGE_KEY = 'harlequin.spotify.tokens.v2';
const LEGACY_STORAGE_KEY = 'harlequin.spotify.tokens';

/** Invalidate a pre-M005 (missing playback scopes) stored session. */
export function clearLegacyTokens(): void {
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}

export function saveTokens(tokens: StoredTokens): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
}

export function loadTokens(): StoredTokens | null {
  // Pre-M005 tokens under the legacy key never had the playback scopes —
  // treat them as absent and wipe them so a fresh login is required (D015).
  clearLegacyTokens();
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
  clearLegacyTokens();
}

/** Access token is only usable before it (or its 60s safety margin) expires. */
export function hasUsableAccessToken(tokens: StoredTokens | null): boolean {
  if (!tokens) return false;
  return Date.now() < tokens.expiresAt - 60_000;
}

export function accessTokenExpired(tokens: StoredTokens | null): boolean {
  return tokens !== null && !hasUsableAccessToken(tokens);
}
