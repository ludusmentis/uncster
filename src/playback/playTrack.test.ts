/**
 * Tests for playTrack (M005 / S03-T1):
 * - 204 and 202 are both success; PUT hits /me/player/play?device_id= with {"uris":[trackUri]}
 * - null / missing deviceId → PlayerNotReadyError (no request made)
 * - non-track URIs (empty, episode, album) rejected before any request
 * - non-2xx statuses surface clean PlayTrackError with status (404/403/500)
 * - network failure surfaces PlayTrackError, not a raw TypeError
 * - AbortSignal aborts the request and re-throws AbortError
 *
 * authedFetch is mocked at the module boundary (MEM008: the 401->refresh
 * ->retry flight logic lives in authedFetch and is covered by its own
 * tests).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlayTrackError,
  PlayerNotReadyError,
  playTrack,
} from './playTrack';

const authedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('../api/authedFetch', () => ({
  authedFetch: authedFetchMock,
  NotConnectedError: class extends Error {},
}));

const URI = 'spotify:track:abc123';
const DEVICE = 'device-id-1';

function statusResponse(status: number): Response {
  return new Response(null, { status });
}

describe('playTrack', () => {
  beforeEach(() => {
    authedFetchMock.mockReset();
  });

  it.each([204, 202])('resolves on status %i', async (status) => {
    authedFetchMock.mockResolvedValue(statusResponse(status));
    await expect(playTrack(URI, DEVICE)).resolves.toBeUndefined();
  });

  it('PUTs /me/player/play?device_id= with a single-track uris payload', async () => {
    authedFetchMock.mockResolvedValue(statusResponse(204));
    await playTrack(URI, DEVICE);
    expect(authedFetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = authedFetchMock.mock.calls[0];
    expect(url).toBe(
      `https://api.spotify.com/v1/me/player/play?device_id=${DEVICE}`,
    );
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ uris: [URI] });
  });

  it('encodes the device_id into the query string', async () => {
    authedFetchMock.mockResolvedValue(statusResponse(204));
    await playTrack(URI, 'dev id/with+special&chars');
    expect(authedFetchMock.mock.calls[0][0]).toBe(
      'https://api.spotify.com/v1/me/player/play?device_id=' +
        encodeURIComponent('dev id/with+special&chars'),
    );
  });

  it('throws PlayerNotReadyError (and makes no request) when deviceId is null', async () => {
    await expect(playTrack(URI, null)).rejects.toBeInstanceOf(
      PlayerNotReadyError,
    );
    expect(authedFetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-track URIs before any request', async () => {
    for (const bad of [
      '',
      'spotify:episode:xyz',
      'spotify:album:xyz',
      'https://open.spotify.com/track/abc',
    ]) {
      await expect(playTrack(bad, DEVICE)).rejects.toBeInstanceOf(
        PlayTrackError,
      );
    }
    expect(authedFetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [404, 'Player device disappeared'],
    [403, 'Spotify Premium is required'],
    [500, 'Could not start playback'],
  ])(
    'surfaces a clean PlayTrackError on status %i',
    async (status, fragment) => {
      authedFetchMock.mockResolvedValue(statusResponse(status));
      const err = await playTrack(URI, DEVICE).catch((e) => e);
      expect(err).toBeInstanceOf(PlayTrackError);
      expect(err.message).toContain(fragment);
      expect(err.status).toBe(status);
    },
  );

  it('wraps network failures in PlayTrackError with null status', async () => {
    authedFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await playTrack(URI, DEVICE).catch((e) => e);
    expect(err).toBeInstanceOf(PlayTrackError);
    expect(err.status).toBeNull();
    expect(err.message).toContain('Could not reach Spotify');
  });

  it('re-throws AbortError untouched and forwards the signal', async () => {
    const controller = new AbortController();
    const abortErr = new DOMException('Aborted', 'AbortError');
    controller.abort(abortErr);
    authedFetchMock.mockImplementation((_url, init) =>
      init.signal === controller.signal
        ? Promise.reject(abortErr)
        : Promise.resolve(statusResponse(204)),
    );
    await expect(playTrack(URI, DEVICE, controller.signal)).rejects.toSatisfy(
      (e: unknown) => e instanceof Error && e.name === 'AbortError',
    );
  });
});
