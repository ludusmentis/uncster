/**
 * Start single-track playback on our Connect device (M005 / S03-T1, D011).
 *
 * PUT /v1/me/player/play?device_id={id} with {"uris":[trackUri]} — single
 * track only, no context_uri/offset branch: playback stops when the track
 * ends. The caller must invoke player.activateElement() in its click
 * handler (autoplay unlock) before calling this; this module only moves
 * the queue head.
 *
 * Success is 204 (started) or 202 (accepted; device will catch up) — both
 * are treated as started. Every other outcome, network failure included,
 * surfaces as a PlayTrackError with a human-readable message; a missing
 * device id surfaces as PlayerNotReadyError (UI shows a connecting hint).
 */

import { authedFetch } from '../api/authedFetch';

const SPOTIFY_API = 'https://api.spotify.com/v1';

export class PlayerNotReadyError extends Error {
  constructor() {
    super('Player is not ready yet — try again in a moment.');
    this.name = 'PlayerNotReadyError';
  }
}

export class PlayTrackError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'PlayTrackError';
    this.status = status;
  }
}

/**
 * Play a single track on the given Connect device.
 *
 * @param trackUri Spotify track URI (spotify:track:...). Episodes and other
 *   context types are out of scope (D011) — callers pass item.track.uri.
 * @param deviceId Our Web Playback SDK device id; null/not-ready is a
 *   PlayerNotReadyError so the UI can keep the connecting hint.
 * @param signal Optional AbortSignal forwarded to the request.
 */
export async function playTrack(
  trackUri: string,
  deviceId: string | null,
  signal?: AbortSignal,
): Promise<void> {
  if (!deviceId) {
    throw new PlayerNotReadyError();
  }
  if (!trackUri || !trackUri.startsWith('spotify:track:')) {
    throw new PlayTrackError('Cannot play this item (not a playable track).');
  }

  const url = `${SPOTIFY_API}/me/player/play?device_id=${encodeURIComponent(deviceId)}`;
  let response: Response;
  try {
    response = await authedFetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uris: [trackUri] }),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new PlayTrackError(
      `Could not reach Spotify to start playback. Check your connection and try again. (${
        err instanceof Error ? err.message : String(err)
      })`,
    );
  }

  if (response.status === 204 || response.status === 202) return;

  throw new PlayTrackError(
    response.status === 404
      ? 'Player device disappeared — reconnecting. Try again in a moment.'
      : response.status === 403
        ? 'Spotify Premium is required to play in-browser.'
        : 'Could not start playback. Try again in a moment.',
    response.status,
  );
}
