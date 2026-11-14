/**
 * App-level tests for logout routing (M006 / S01-T1).
 *
 * handleLogout already tore down the SDK player (disconnectPlayer, D012)
 * before wiping tokens (logout, D016) — but never changed the route, so
 * logging out on /playlist/:id left the unauthed data route mounted and its
 * fetch failing. These tests pin the new contract:
 *
 * 1. Header logout on a playlist route: navigate('/') fires (App returns
 *    to the Home connect view), disconnectPlayer runs before logout, and
 *    the authed chrome resets (Connect label, no playlist content).
 * 2. PremiumGate logout (premiumBlocked path): navigates to '/' too.
 *
 * Rendering uses react-test-renderer (node-pure, per the project's
 * no-jsdom convention); App touches `window`, so a minimal window stub is
 * installed with a seedable location.pathname so parseRoute yields the
 * playlist route. ../routing is partial-mocked (importOriginal) so only
 * navigate is a spy — parseRoute / subscribeRoute stay real. Auth, token,
 * profile and player modules are mocked so no network or SDK loads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';

// Spies and the stubbed window's event listeners, hoisted for the mocks.
const { navigateSpy, windowListeners } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  windowListeners: new Map<string, Set<() => void>>(),
}));

vi.mock('./routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./routing')>();
  return {
    ...actual,
    // Spy wrapper that also emulates the real navigate()'s browser effect
    // (history.pushState + popstate), so App's real subscribeRoute-driven
    // route state actually follows the navigation and the view swaps.
    navigate: (path: string) => {
      navigateSpy(path);
      const w = (globalThis as { window?: { location: { pathname: string } } })
        .window;
      if (w) w.location.pathname = path;
      windowListeners.get('popstate')?.forEach((cb) => cb());
    },
  };
});

const { disconnectPlayerMock } = vi.hoisted(() => ({
  disconnectPlayerMock: vi.fn(),
}));

vi.mock('./playback/useSpotifyPlayer', () => ({
  useSpotifyPlayer: () => ({
    deviceId: null,
    isReady: false,
    isPaused: true,
    currentTrack: null,
    error: null,
    activateElement: () => {},
    togglePlay: () => {},
  }),
  disconnectPlayer: disconnectPlayerMock,
}));

vi.mock('./auth/tokenStore', () => ({
  loadTokens: () => ({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3_600_000,
    scope: 'user-read-private user-read-email',
  }),
  hasUsableAccessToken: () => true,
  clearTokens: () => {},
}));

vi.mock('./api/user', () => ({
  fetchCurrentUser: vi.fn(),
}));

vi.mock('./api/auth', () => ({
  logout: vi.fn(),
}));

// The playlist route renders PlaylistTracks; keep its data fetch inert.
vi.mock('./api/tracks', () => ({
  fetchAllPlaylistTracks: vi.fn(async () => []),
  releaseYear: () => '2024',
}));

import App from './App';
import { logout } from './api/auth';
import { fetchCurrentUser } from './api/user';
// vi.mocked() gives typed access to the mocked logout()'s call order below.

/**
 * Minimal window stub for App's routing/auth browser usage (node env).
 * `pathname` is seedable per test so parseRoute sees the playlist route.
 */
function stubWindow(pathname: string): void {
  const win = globalThis as unknown as { window?: unknown };
  win.window = {
    location: { pathname, assign: () => {} },
    addEventListener: (type: string, cb: () => void) => {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: () => void) => {
      windowListeners.get(type)?.delete(cb);
    },
  };
}

function treeToStringJSON(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

/** Find a button by its flat text children (react-test-renderer idiom). */
function findButtonByText(
  tree: TestRenderer.ReactTestRenderer,
  text: string,
): TestRenderer.ReactTestInstance {
  const button = tree.root
    .findAllByType('button')
    .find((btn) => btn.props.children === text);
  expect(button, `expected a button labelled "${text}"`).toBeDefined();
  return button!;
}

beforeEach(() => {
  navigateSpy.mockReset();
  disconnectPlayerMock.mockReset();
  vi.mocked(logout).mockReset();
  vi.mocked(fetchCurrentUser).mockReset();
  vi.mocked(fetchCurrentUser).mockResolvedValue({
    id: 'user-1',
    display_name: 'Premium Pat',
    product: 'premium',
  });
});

afterEach(() => {
  act(() => {
    /* drain pending updates */
  });
});

describe('App.handleLogout (route returns to connect view)', () => {
  it('Header logout on a playlist route navigates to "/", resetting chrome', async () => {
    // Seed the history/location state so parseRoute yields the playlist route.
    stubWindow('/playlist/pl-1');
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<App />);
    });
    // Authed premium session on the playlist data route.
    expect(treeToStringJSON(tree)).toContain('Log out');
    expect(treeToStringJSON(tree)).toContain('Playlist tracks');

    await act(async () => {
      findButtonByText(tree, 'Log out').props.onClick();
    });

    // The route returns to the Home connect view.
    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    // D012/D016 ordering contract: the SDK device dies before tokens wipe.
    expect(disconnectPlayerMock).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(
      disconnectPlayerMock.mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(logout).mock.invocationCallOrder[0]);
    // Authed state reset: chrome flips to Connect, playlist content is gone.
    const json = treeToStringJSON(tree);
    expect(json).toContain('Connect Spotify');
    expect(json).not.toContain('Log out');
    expect(json).not.toContain('Playlist tracks');
  });

  it('PremiumGate logout (non-premium block) navigates to "/" too', async () => {
    stubWindow('/');
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: 'user-1',
      display_name: 'Free Freddie',
      product: 'free',
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<App />);
    });
    expect(treeToStringJSON(tree)).toContain('Premium required');

    await act(async () => {
      findButtonByText(tree, 'Log out').props.onClick();
    });

    expect(navigateSpy).toHaveBeenCalledWith('/');
    expect(disconnectPlayerMock).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(treeToStringJSON(tree)).not.toContain('Premium required');
  });
});
