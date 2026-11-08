/**
 * Playlist tracks API (M002 / S01).
 *
 * Fetches a playlist's tracks via authedFetch, following Spotify's
 * cursor-style `next` pagination URLs until the playlist is exhausted.
 * Uses GET /v1/playlists/{id}/items — the replacement for the
 * /v1/playlists/{id}/tracks endpoint deprecated by Spotify's February
 * 2026 dev-mode changes (the old path now returns 403 for dev-mode apps).
 * Page size 100 (Spotify's documented maximum for this endpoint) keeps
 * request count minimal for large playlists.
 *
 * Failure contract: any non-2xx response or malformed body throws
 * FetchPlaylistTracksError with the HTTP status, which the UI renders as a
 * retryable error state. Network-layer failures (connection loss, timeout)
 * surface as fetch rejections and propagate to the caller unchanged.
 */

import { authedFetch } from './authedFetch';

export const TRACK_PAGE_SIZE = 100;

export interface SpotifyImage {
  url: string;
  height: number | null;
  width: number | null;
}

export interface SpotifyTrack {
  id: string;
  name: string;
  artists: { id: string; name: string }[];
  album: {
    images: SpotifyImage[];
    release_date?: string;
    release_date_precision?: 'day' | 'month' | 'year';
  };
  type: 'track' | 'episode';
}

/**
 * One playlist item from GET /v1/playlists/{id}/items. The track/episode
 * payload lives under `item` (the deprecated /tracks endpoint named it
 * `track`); it is null for unavailable or local items.
 */
export interface SpotifyTrackItem {
  item: SpotifyTrack | null;
}

export interface SpotifyPaged<T> {
  items: T[];
  next: string | null;
  total: number;
  limit: number;
  offset: number;
}

export class FetchPlaylistTracksError extends Error {
  readonly status: number;

  constructor(status: number, message?: string) {
    super(message ?? `Failed to load playlist tracks (HTTP ${status}).`);
    this.name = 'FetchPlaylistTracksError';
    this.status = status;
  }
}

/** Placeholder shown when no release year can be derived. */
export const RELEASE_YEAR_PLACEHOLDER = '—';

/**
 * Fetch one page of a playlist's tracks. The initial URL uses limit=100;
 * subsequent pages use the `next` URL returned by Spotify verbatim.
 */
export async function fetchPlaylistTrackPage(
  url: string,
): Promise<SpotifyPaged<SpotifyTrackItem>> {
  const response = await authedFetch(url);
  if (!response.ok) {
    throw new FetchPlaylistTracksError(
      response.status,
      `Failed to load playlist tracks (HTTP ${response.status}).`,
    );
  }
  try {
    return (await response.json()) as SpotifyPaged<SpotifyTrackItem>;
  } catch {
    throw new FetchPlaylistTracksError(
      response.status,
      'Playlist tracks response was not valid JSON.',
    );
  }
}

/**
 * Fetch all tracks of a playlist by following `next` page URLs until
 * Spotify reports none remain. Bounded by an offset guard so a malformed
 * `next` loop cannot spin forever.
 */
export async function fetchAllPlaylistTracks(
  playlistId: string,
  signal?: AbortSignal,
): Promise<SpotifyTrackItem[]> {
  const items: SpotifyTrackItem[] = [];
  const seenOffsets = new Set<string>();
  let url: string =
    `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=${TRACK_PAGE_SIZE}`;

  while (url) {
    if (signal?.aborted) {
      throw new DOMException('Aborted.', 'AbortError');
    }
    const page = await fetchPlaylistTrackPage(url);
    const offsetKey = String(page.offset ?? 0);
    if (seenOffsets.has(offsetKey) && page.items.length > 0) {
      throw new FetchPlaylistTracksError(
        0,
        'Playlist tracks pagination returned a repeated offset — aborting to avoid a loop.',
      );
    }
    seenOffsets.add(offsetKey);
    items.push(...page.items);
    url = page.next ?? '';
  }

  return items;
}

/**
 * Derive the release year from a track's album release_date. Returns a
 * placeholder for null tracks, episodes, or missing dates. The first
 * '-'-separated segment covers day/month/year precisions without branching.
 */
export function releaseYear(item: SpotifyTrackItem): string {
  const track = item.item;
  if (!track || track.type !== 'track') {
    return RELEASE_YEAR_PLACEHOLDER;
  }
  const releaseDate = track.album?.release_date;
  if (!releaseDate) {
    return RELEASE_YEAR_PLACEHOLDER;
  }
  return releaseDate.split('-')[0];
}
