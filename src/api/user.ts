/**
 * Current-user profile API (T005 / S03).
 *
 * Fetches GET /v1/me via authedFetch to surface the Spotify display name
 * in the home header. Mirrors the playlists failure contract: non-2xx or
 * a malformed body throws FetchUserError with the HTTP status so the
 * caller can render a retryable error state.
 */

import { authedFetch } from './authedFetch';

export interface SpotifyUser {
  id: string;
  /** May be null per Spotify's docs (rare in practice). */
  display_name: string | null;
}

export class FetchUserError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Failed to load your Spotify profile (HTTP ${status}).`);
    this.name = 'FetchUserError';
    this.status = status;
  }
}

const ME_URL = 'https://api.spotify.com/v1/me';

/**
 * Fetch the current user's profile. Throws FetchUserError on non-2xx or a
 * malformed body; network-layer failures propagate unchanged.
 */
export async function fetchCurrentUser(): Promise<SpotifyUser> {
  const response = await authedFetch(ME_URL);
  if (!response.ok) {
    throw new FetchUserError(
      response.status,
      `Failed to load your Spotify profile (HTTP ${response.status}).`,
    );
  }
  try {
    const user = (await response.json()) as SpotifyUser;
    if (typeof user?.id !== 'string') {
      throw new FetchUserError(
        response.status,
        'Spotify profile response was missing required fields.',
      );
    }
    return user;
  } catch (err) {
    if (err instanceof FetchUserError) throw err;
    throw new FetchUserError(
      response.status,
      'Spotify profile response was not valid JSON.',
    );
  }
}