/**
 * Tests for the playlist tracks API (M002 / S01):
 * - first request hits /playlists/{id}/items with limit=100
 * - follows next URLs verbatim until exhaustion
 * - empty playlist resolves to []
 * - non-2xx responses throw FetchPlaylistTracksError with the HTTP status
 * - malformed JSON throws FetchPlaylistTracksError
 * - repeated-offset pagination loop is detected and aborted
 * - AbortSignal stops fetching with AbortError
 * - releaseYear handles release_date precisions, null tracks, and episodes
 *
 * authedFetch is mocked at the module boundary (MEM008: 401->refresh->retry
 * flight logic is not duplicated here — it lives in authedFetch and is
 * covered by its own tests).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAllPlaylistTracks,
  fetchPlaylistTrackPage,
  FetchPlaylistTracksError,
  releaseYear,
  TRACK_PAGE_SIZE,
  type SpotifyPaged,
  type SpotifyTrack,
  type SpotifyTrackItem,
} from './tracks';

const authedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./authedFetch', () => ({
  authedFetch: authedFetchMock,
  NotConnectedError: class extends Error {},
}));

function track(
  id: string,
  album: SpotifyTrack['album'] = { images: [] },
  type: SpotifyTrack['type'] = 'track',
): SpotifyTrack {
  return { id, name: `Track ${id}`, artists: [], album, type };
}

function item(t: SpotifyTrack | null): SpotifyTrackItem {
  return { item: t };
}

function page(
  items: SpotifyTrackItem[],
  next: string | null,
  offset: number,
): SpotifyPaged<SpotifyTrackItem> {
  return { items, next, total: 0, limit: TRACK_PAGE_SIZE, offset };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('tracks api', () => {
  beforeEach(() => {
    authedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests the first page with limit=100 on the tracks endpoint', async () => {
    authedFetchMock.mockResolvedValue(ok(page([], null, 0)));
    await fetchAllPlaylistTracks('pl1');
    expect(authedFetchMock).toHaveBeenCalledTimes(1);
    const url = authedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/v1/playlists/pl1/items');
    expect(url).toContain(`limit=${TRACK_PAGE_SIZE}`);
  });

  it('follows next URLs verbatim and concatenates items in order', async () => {
    authedFetchMock
      .mockResolvedValueOnce(
        ok(
          page(
            [item(track('a')), item(track('b'))],
            'https://api.spotify.com/v1/playlists/pl1/items?offset=100&limit=100',
            0,
          ),
        ),
      )
      .mockResolvedValueOnce(
        ok(
          page(
            [item(track('c'))],
            'https://api.spotify.com/v1/playlists/pl1/items?offset=200&limit=100&market=XY',
            100,
          ),
        ),
      )
      .mockResolvedValueOnce(ok(page([item(track('d'))], null, 200)));
    const all = await fetchAllPlaylistTracks('pl1');
    expect(authedFetchMock).toHaveBeenCalledTimes(3);
    // next URLs are used verbatim, never recomputed
    expect(authedFetchMock.mock.calls[1][0]).toBe(
      'https://api.spotify.com/v1/playlists/pl1/items?offset=100&limit=100',
    );
    expect(authedFetchMock.mock.calls[2][0]).toBe(
      'https://api.spotify.com/v1/playlists/pl1/items?offset=200&limit=100&market=XY',
    );
    expect(all.map((i) => i.item?.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('resolves to an empty list for an empty playlist', async () => {
    authedFetchMock.mockResolvedValue(ok(page([], null, 0)));
    const all = await fetchAllPlaylistTracks('pl1');
    expect(all).toEqual([]);
  });

  it('throws FetchPlaylistTracksError with status on non-2xx (429)', async () => {
    authedFetchMock.mockResolvedValue(
      new Response('{"error":{}}', { status: 429 }),
    );
    await expect(
      fetchAllPlaylistTracks('pl1'),
    ).rejects.toMatchObject({
      name: 'FetchPlaylistTracksError',
      status: 429,
    });
  });

  it('throws FetchPlaylistTracksError with status on non-2xx (500)', async () => {
    authedFetchMock.mockResolvedValue(
      new Response('{"error":{}}', { status: 500 }),
    );
    await expect(
      fetchPlaylistTrackPage(
        'https://api.spotify.com/v1/playlists/pl1/items?limit=100',
      ),
    ).rejects.toMatchObject({
      name: 'FetchPlaylistTracksError',
      status: 500,
    });
  });

  it('throws FetchPlaylistTracksError on malformed JSON', async () => {
    authedFetchMock.mockResolvedValue(
      new Response('<html>not json</html>', { status: 200 }),
    );
    await expect(
      fetchPlaylistTrackPage(
        'https://api.spotify.com/v1/playlists/pl1/items?limit=100',
      ),
    ).rejects.toBeInstanceOf(FetchPlaylistTracksError);
  });

  it('aborts pagination loop when a repeated offset is returned', async () => {
    const loopingPage = () =>
      page(
        [item(track('a'))],
        'https://api.spotify.com/v1/playlists/pl1/items?offset=0&limit=100',
        0,
      );
    // Fresh Response per call — a Response body can only be consumed once.
    authedFetchMock.mockImplementation(async () => ok(loopingPage()));
    await expect(fetchAllPlaylistTracks('pl1')).rejects.toThrow(/repeated offset/);
    expect(authedFetchMock.mock.calls.length).toBeLessThan(5);
  });

  it('stops fetching when the abort signal fires', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAllPlaylistTracks('pl1', controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(authedFetchMock).not.toHaveBeenCalled();
  });

  describe('releaseYear', () => {
    const album = (release_date?: string) => ({ images: [], release_date });

    it('maps day precision 1995-03-14 -> 1995', () => {
      expect(releaseYear(item(track('a', album('1995-03-14'))))).toBe('1995');
    });

    it('maps month precision 1995-03 -> 1995', () => {
      expect(releaseYear(item(track('a', album('1995-03'))))).toBe('1995');
    });

    it('maps year precision 1995 -> 1995', () => {
      expect(releaseYear(item(track('a', album('1995'))))).toBe('1995');
    });

    it('returns the placeholder for a missing release_date', () => {
      expect(releaseYear(item(track('a', album(undefined))))).toBe('—');
    });

    it('returns the placeholder for item:null', () => {
      expect(releaseYear(item(null))).toBe('—');
    });

    it("returns the placeholder for type:'episode'", () => {
      expect(
        releaseYear(item(track('a', album('1995-03-14'), 'episode'))),
      ).toBe('—');
    });
  });
});
