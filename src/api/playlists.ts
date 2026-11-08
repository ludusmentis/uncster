/**
 * Playlist library API (R008 / S03).
 *
 * Fetches the current user's playlists (private included) via authedFetch,
 * following Spotify's cursor-style `next` pagination URLs until the library
 * is exhausted. Page size 50 (Spotify's documented maximum) keeps request
 * count minimal for large libraries.
 *
 * Failure contract (slice observability goal): any non-2xx response or
 * malformed body throws FetchPlaylistsError with the HTTP status, which the
 * Home page renders as a retryable error state. Network-layer failures
 * (connection loss, timeout) surface as fetch rejections and propagate to the
 * caller unchanged.
 */

import { authedFetch } from './authedFetch';

export const PLAYLIST_PAGE_SIZE = 50;

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  images: SpotifyImage[];
}

export interface SpotifyPaged<T> {
  items: T[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
}

export class FetchPlaylistsError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Failed to load playlists (HTTP ${status}).`);
    this.name = 'FetchPlaylistsError';
    this.status = status;
  }
}

/**
 * Fetch one page of the user's playlists. The initial URL uses limit=50;
 * subsequent pages use the `next` URL returned by Spotify verbatim.
 */
export async function fetchPlaylistPage(
  url: string,
): Promise<SpotifyPaged<SpotifyPlaylist>> {
  const response = await authedFetch(url);
  if (!response.ok) {
    throw new FetchPlaylistsError(
      response.status,
      `Failed to load playlists (HTTP ${response.status}).`,
    );
  }
  try {
    return (await response.json()) as SpotifyPaged<SpotifyPlaylist>;
  } catch {
    throw new FetchPlaylistsError(
      response.status,
      'Playlists response was not valid JSON.',
    );
  }
}

/**
 * Fetch the user's entire playlist library by following `next` page URLs
 * until Spotify reports none remain. Bounded by an offset guard so a
 * malformed `next` loop cannot spin forever.
 */
export async function fetchAllPlaylists(
  signal?: AbortSignal,
): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = [];
  const seenOffsets = new Set<string>();
  let url: string =
    `https://api.spotify.com/v1/me/playlists?limit=${PLAYLIST_PAGE_SIZE}`;

  while (url) {
    if (signal?.aborted) {
      throw new DOMException('Aborted.', 'AbortError');
    }
    const page = await fetchPlaylistPage(url);
    const offsetKey = String(page.offset ?? 0);
    if (seenOffsets.has(offsetKey) && page.items.length > 0) {
      throw new FetchPlaylistsError(
        0,
        'Playlists pagination returned a repeated offset — aborting to avoid a loop.',
      );
    }
    seenOffsets.add(offsetKey);
    playlists.push(...page.items);
    url = page.next ?? '';
  }

  return playlists;
}
