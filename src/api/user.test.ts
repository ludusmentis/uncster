/**
 * Tests for the current-user profile API (T005 / S03):
 * - fetches GET /v1/me via authedFetch
 * - resolves display_name (and falls back to id when display_name is null)
 * - non-2xx response throws FetchUserError with the HTTP status
 * - malformed JSON throws FetchUserError
 * - missing required fields throws FetchUserError
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCurrentUser, FetchUserError } from './user';

const authedFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./authedFetch', () => ({
  authedFetch: authedFetchMock,
  NotConnectedError: class extends Error {},
}));

const ME_URL = 'https://api.spotify.com/v1/me';

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('user api', () => {
  beforeEach(() => {
    authedFetchMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches GET /v1/me and resolves the display name', async () => {
    authedFetchMock.mockResolvedValue(
      ok({ id: 'user-1', display_name: 'Orca Listener' }),
    );
    const user = await fetchCurrentUser();
    expect(authedFetchMock).toHaveBeenCalledWith(ME_URL);
    expect(user).toEqual({ id: 'user-1', display_name: 'Orca Listener' });
  });

  it('resolves with display_name: null (caller falls back to id)', async () => {
    authedFetchMock.mockResolvedValue(ok({ id: 'user-1', display_name: null }));
    const user = await fetchCurrentUser();
    expect(user.display_name).toBeNull();
    expect(user.id).toBe('user-1');
  });

  it('throws FetchUserError with the status on a non-2xx response', async () => {
    authedFetchMock.mockResolvedValue(new Response('{"error":{}}', { status: 500 }));
    await expect(fetchCurrentUser()).rejects.toMatchObject({
      name: 'FetchUserError',
      status: 500,
    });
  });

  it('throws FetchUserError on malformed JSON', async () => {
    authedFetchMock.mockResolvedValue(
      new Response('<html>not json</html>', { status: 200 }),
    );
    await expect(fetchCurrentUser()).rejects.toBeInstanceOf(FetchUserError);
  });

  it('throws FetchUserError when the response is missing required fields', async () => {
    authedFetchMock.mockResolvedValue(ok({ display_name: 'No Id' }));
    await expect(fetchCurrentUser()).rejects.toBeInstanceOf(FetchUserError);
  });
});