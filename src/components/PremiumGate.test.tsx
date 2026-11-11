/**
 * Component tests for the Premium gate (M005 / S02-T4, D014).
 *
 * Both gates are covered:
 *
 * 1. Product check — App fetches GET /v1/me (mocked) and renders the
 *    blocking PremiumGate screen when `product !== 'premium'`; a premium
 *    account sees the normal app (hero tagline, no gate).
 * 2. account_error backstop — AccountErrorWatcher (inside PlayerProvider)
 *    flips App to the gate when the SDK player categorises an error as
 *    kind 'account', and ignores other error kinds.
 *
 * Also: the gate's Log out button is wired to onLogout, so the blocking
 * screen is escapable.
 *
 * App-level rendering uses react-test-renderer (node-pure environment, per
 * the project's no-jsdom convention). App touches `window` (routing/auth), so
 * a minimal window stub is installed in beforeEach. Auth/token, profile,
 * playlists and player modules are mocked so no network or SDK script loads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { renderToString } from 'react-dom/server';

// Controllable mocked player state (see vi.mock below).
const mockPlayer = vi.hoisted(() => ({
  state: {
    deviceId: null as string | null,
    isReady: false,
    isPaused: true,
    currentTrack: null as unknown,
    error: null as { kind: string; message: string } | null,
  },
  activateElement: () => {},
}));

vi.mock('../playback/useSpotifyPlayer', () => ({
  useSpotifyPlayer: () => ({ ...mockPlayer.state, activateElement: mockPlayer.activateElement }),
  disconnectPlayer: () => {},
}));

vi.mock('../auth/tokenStore', () => ({
  loadTokens: () => ({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 3_600_000,
    scope: 'user-read-private user-read-email',
  }),
  hasUsableAccessToken: () => true,
  clearTokens: () => {},
}));

vi.mock('../api/user', () => ({
  fetchCurrentUser: vi.fn(),
}));

vi.mock('../api/playlists', () => ({
  fetchAllPlaylists: vi.fn(async () => []),
}));

vi.mock('../api/auth', () => ({
  logout: () => {},
}));

import App from '../App';
import { AccountErrorWatcher, PremiumGate } from './PremiumGate';
import { PlayerProvider } from '../playback/PlayerProvider';
import { fetchCurrentUser } from '../api/user';

const noop = (): void => {};

/** Minimal window stub for App's routing/auth browser usage (node env). */
function stubWindow(): void {
  const win = globalThis as unknown as { window?: unknown };
  if (!win.window) {
    win.window = {
      location: { pathname: '/', assign: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
}

function treeToStringJSON(tree: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  stubWindow();
  mockPlayer.state.error = null;
  vi.mocked(fetchCurrentUser).mockReset();
});

afterEach(() => {
  act(() => {
    /* drain pending updates */
  });
});

describe('PremiumGate (blocking screen)', () => {
  it('renders the blocking Premium message with a Log out button', () => {
    const html = renderToString(<PremiumGate onLogout={noop} />);
    expect(html).toContain('Premium required');
    expect(html).toContain('Uncster only works with Spotify Premium accounts');
    expect(html).toContain('Log out');
  });

  it('wires the Log out button to onLogout', () => {
    const onLogout = vi.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<PremiumGate onLogout={onLogout} />);
    });
    const button = tree.root.findByProps({ onClick: onLogout });
    act(() => {
      button.props.onClick();
    });
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});

describe('App product gate (GET /v1/me `product`)', () => {
  it('blocks the whole app for a non-premium account', async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: 'user-1',
      display_name: 'Free Freddie',
      product: 'free',
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<App />);
    });
    const json = treeToStringJSON(tree);
    expect(json).toContain('Premium required');
    expect(json).toContain(
      'Uncster only works with Spotify Premium accounts',
    );
    // No further access: the normal app content is gone.
    expect(json).not.toContain('Your playlists called.');
  });

  it('shows the normal app for a premium account', async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: 'user-1',
      display_name: 'Premium Pat',
      product: 'premium',
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<App />);
    });
    const json = treeToStringJSON(tree);
    expect(json).not.toContain('Premium required');
    expect(json).toContain('Your playlists called.');
  });

  it('releases the gate on logout from the blocking screen', async () => {
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
      const logoutButton = tree.root
        .findAllByType('button')
        .find((btn) => btn.props.children === 'Log out');
      logoutButton!.props.onClick();
    });
    // Logout resets premiumBlocked; the connect entry screen shows instead.
    expect(treeToStringJSON(tree)).not.toContain('Premium required');
  });
});

describe('account_error backstop (AccountErrorWatcher)', () => {
  it('flips App to the gate when the SDK reports account_error', async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: 'user-1',
      display_name: 'Premium Pat',
      product: 'premium',
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<App />);
    });
    expect(treeToStringJSON(tree)).not.toContain('Premium required');

    // Mid-session downgrade: the SDK emits account_error (kind 'account').
    mockPlayer.state.error = {
      kind: 'account',
      message: 'Premium required to use playback.',
    };
    await act(async () => {
      tree.update(<App />);
    });
    expect(treeToStringJSON(tree)).toContain('Premium required');
  });

  it('reports account errors via onAccountError and ignores other kinds', async () => {
    const onAccountError = vi.fn();

    mockPlayer.state.error = {
      kind: 'playback',
      message: 'transient playback failure',
    };
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <PlayerProvider authed={true}>
          <AccountErrorWatcher onAccountError={onAccountError} />
        </PlayerProvider>,
      );
    });
    expect(onAccountError).not.toHaveBeenCalled();

    mockPlayer.state.error = {
      kind: 'account',
      message: 'Premium required to use playback.',
    };
    await act(async () => {
      tree.update(
        <PlayerProvider authed={true}>
          <AccountErrorWatcher onAccountError={onAccountError} />
        </PlayerProvider>,
      );
    });
    expect(onAccountError).toHaveBeenCalledTimes(1);
    expect(onAccountError).toHaveBeenCalledWith(
      'Premium required to use playback.',
    );
  });
});