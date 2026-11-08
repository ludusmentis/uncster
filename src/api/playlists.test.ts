/**
 * Tests for the playlist library API (R008 / S03):
 * - follows next-page URLs until the library is exhausted (limit=50)
 * - empty library resolves to []
 * - non-2xx response throws FetchPlaylistsError with the HTTP status
 * - malformed JSON throws FetchPlaylistsError
 * - repeated-offset pagination loop is detected and aborted
 * - AbortSignal stops fetching with AbortError
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAllPlaylists,
  fetchPlaylistPage,
  FetchPlaylistsError,
  PLAYLIST_PAGE_SIZE,
  type SpotifyImage,
  type SpotifyPaged,
  type SpotifyPlaylist,
} from './playlists';

const authedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./authedFetch', () => ({
  authedFetch: authedFetchMock,
  NotConnectedError: class extends Error {},
}));

function playlist(id: string, images: SpotifyImage[] = []): SpotifyPlaylist {
  return { id, name: `Playlist ${id}`, images };
}

function page(
  items: SpotifyPlaylist[],
  next: string | null,
  offset: number,
): SpotifyPaged<SpotifyPlaylist> {
  return { items, next, total: 0, limit: PLAYLIST_PAGE_SIZE, offset };
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('playlists api', () => {
  beforeEach(() => {
    authedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests the first page with limit=50', async () => {
    authedFetchMock.mockResolvedValue(ok(page([], null, 0)));
    await fetchAllPlaylists();
    expect(authedFetchMock).toHaveBeenCalledTimes(1);
    const url = authedFetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/v1/me/playlists');
    expect(url).toContain(`limit=${PLAYLIST_PAGE_SIZE}`);
  });

  it('follows next URLs until the library is exhausted', async () => {
    authedFetchMock
      .mockResolvedValueOnce(
        ok(page([playlist('a'), playlist('b')], 'https://api.spotify.com/v1/me/playlists?offset=50&limit=50', 0)),
      )
      .mockResolvedValueOnce(
        ok(page([playlist('c')], null, 50)),
      );
    const all = await fetchAllPlaylists();
    expect(authedFetchMock).toHaveBeenCalledTimes(2);
    expect(authedFetchMock.mock.calls[1][0]).toContain('offset=50');
    expect(all.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('resolves to an empty list for an empty library', async () => {
    authedFetchMock.mockResolvedValue(ok(page([], null, 0)));
    const all = await fetchAllPlaylists();
    expect(all).toEqual([]);
  });

  it('throws FetchPlaylistsError with the status on a non-2xx response', async () => {
    authedFetchMock.mockResolvedValue(
      new Response('{"error":{}}', { status: 429 }),
    );
    await expect(fetchPlaylistPage('https://api.spotify.com/v1/me/playlists')).rejects.toMatchObject({
      name: 'FetchPlaylistsError',
      status: 429,
    });
  });

  it('throws FetchPlaylistsError on malformed JSON', async () => {
    authedFetchMock.mockResolvedValue(
      new Response('<html>not json</html>', { status: 200 }),
    );
    await expect(fetchPlaylistPage('https://api.spotify.com/v1/me/playlists')).rejects.toBeInstanceOf(FetchPlaylistsError);
  });

  it('propagates network-layer rejections unchanged', async () => {
    authedFetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(fetchAllPlaylists()).rejects.toThrow('Failed to fetch');
  });

  it('aborts pagination loop when a repeated offset is returned', async () => {
    const loopingPage = () =>
      page(
        [playlist('a')],
        'https://api.spotify.com/v1/me/playlists?offset=0&limit=50',
        0,
      );
    // Fresh Response per call — a Response body can only be consumed once.
    authedFetchMock.mockImplementation(async () => ok(loopingPage()));
    await expect(fetchAllPlaylists()).rejects.toThrow(/repeated offset/);
    expect(authedFetchMock.mock.calls.length).toBeLessThan(5);
  });

  it('stops fetching when the abort signal fires', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fetchAllPlaylists(controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(authedFetchMock).not.toHaveBeenCalled();
  });
});
