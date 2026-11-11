/**
 * Unit tests for the Web Playback SDK player lifecycle hook (M005 / S02-T3).
 *
 * Uses a fully mocked Spotify.Player (FakePlayer below) injected via a
 * mocked loadSpotifySdk, and a token provider mock, so the tests exercise
 * useSpotifyPlayer's own wiring only:
 *
 * - listener registration for ready / not_ready / player_state_changed and
 *   the four error events;
 * - state updates from ready (deviceId, isReady) and player_state_changed
 *   (isPaused, currentTrack);
 * - error mapping, notably account_error → kind 'account' (the PremiumGate
 *   routing signal per D014);
 * - connect() returning false → categorized 'initialization' error;
 * - teardown: disconnect() on unmount, on enabled flip, and via the
 *   module-level disconnectPlayer() registry (S01-T3 logout ordering);
 * - StrictMode-style mount→unmount→remount balances connect/disconnect.
 *
 * Rendering uses react-test-renderer (node-pure environment, in line with
 * the project's no-jsdom test convention; hooks with effects need a real
 * renderer, and react-test-renderer is the smallest one). The module-level
 * registry means each test re-imports the hook fresh via vi.resetModules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { UseSpotifyPlayerResult } from './useSpotifyPlayer';

/** Constructor options the SDK contract hands to Spotify.Player. */
interface FakePlayerOptions {
  name: string;
  volume: number;
  getOAuthToken: (cb: (token: string) => void) => void;
}

/** Mocked Spotify.Player: records wiring and emits events on demand. */
class FakePlayer {
  static instances: FakePlayer[] = [];
  /** per-event listener arrays, for wiring assertions */
  readonly listeners: Record<string, Array<(payload: unknown) => void>> = {};
  readonly options: FakePlayerOptions;
  connect = vi.fn(async (): Promise<boolean> => true);
  disconnect = vi.fn();
  activateElement = vi.fn();

  constructor(options: FakePlayerOptions) {
    this.options = options;
    FakePlayer.instances.push(this);
  }

  addListener(event: string, cb: (payload: unknown) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }

  /** Test helper: fire every listener for an event. */
  emit(event: string, payload?: unknown): void {
    (this.listeners[event] ?? []).forEach((cb) => cb(payload));
  }
}

vi.mock('./sdkLoader', () => ({
  // Always resolves instantly with our fake SDK namespace.
  loadSpotifySdk: vi.fn(async () => ({ Player: FakePlayer })),
}));

vi.mock('../api/authedFetch', () => ({
  getToken: vi.fn(async () => 'test-access-token'),
}));

/** Flush the microtask queue so .then chains inside the hook settle. */
const flushMicrotasks = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  get result(): UseSpotifyPlayerResult;
  unmount(): Promise<void>;
  rerender(enabled: boolean): Promise<void>;
  disconnectPlayer(): Promise<void>;
}

/**
 * Render the hook with an `enabled` prop. Each call dynamically imports the
 * (reset) hook module so the module-level playerTeardown registry starts clean.
 */
async function renderHookFresh(enabled: boolean): Promise<Harness> {
  const mod = await import('./useSpotifyPlayer');
  let current: UseSpotifyPlayerResult | undefined;

  const Host = ({ on }: { on: boolean }): null => {
    current = mod.useSpotifyPlayer(on);
    return null;
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Host, { on: enabled }));
  });
  await act(async () => {
    await flushMicrotasks();
  });

  return {
    get result(): UseSpotifyPlayerResult {
      if (!current) throw new Error('hook result not captured');
      return current;
    },
    async unmount(): Promise<void> {
      await act(async () => {
        renderer.unmount();
      });
      await act(async () => {
        await flushMicrotasks();
      });
    },
    async rerender(next: boolean): Promise<void> {
      await act(async () => {
        renderer.update(React.createElement(Host, { on: next }));
      });
      await act(async () => {
        await flushMicrotasks();
      });
    },
    async disconnectPlayer(): Promise<void> {
      mod.disconnectPlayer();
      await act(async () => {
        await flushMicrotasks();
      });
    },
  };
}

describe('useSpotifyPlayer (S02-T3)', () => {
  beforeEach(() => {
    vi.resetModules();
    FakePlayer.instances = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates the player with the required options and wires every SDK listener', async () => {
    const hook = await renderHookFresh(true);

    expect(FakePlayer.instances).toHaveLength(1);
    const player = FakePlayer.instances[0];
    expect(player.options.name).toBe('Web App Player');
    expect(player.options.volume).toBe(0.5);

    // Full listener wiring: lifecycle + state + all four error events.
    for (const event of [
      'ready',
      'not_ready',
      'player_state_changed',
      'initialization_error',
      'authentication_error',
      'account_error',
      'playback_error',
    ]) {
      expect(player.listeners[event], `missing listener: ${event}`).toHaveLength(1);
    }

    expect(player.connect).toHaveBeenCalledTimes(1);
    // Initial state is neutral before 'ready' fires.
    expect(hook.result).toMatchObject({
      deviceId: null,
      isReady: false,
      isPaused: true,
      currentTrack: null,
      error: null,
    });
  });

  it('supplies the S01 access token via getOAuthToken', async () => {
    await renderHookFresh(true);
    const player = FakePlayer.instances[0];

    let supplied: string | undefined;
    await act(async () => {
      player.options.getOAuthToken((token) => {
        supplied = token;
      });
      await flushMicrotasks();
    });
    expect(supplied).toBe('test-access-token');
  });

  it('exposes deviceId/isReady on ready, and clears readiness on not_ready', async () => {
    const hook = await renderHookFresh(true);
    const player = FakePlayer.instances[0];

    await act(async () => {
      player.emit('ready', { device_id: 'dev-123' });
    });
    expect(hook.result.deviceId).toBe('dev-123');
    expect(hook.result.isReady).toBe(true);

    await act(async () => {
      player.emit('not_ready', { device_id: 'dev-123' });
    });
    expect(hook.result.isReady).toBe(false);
  });

  it('updates isPaused and currentTrack from player_state_changed', async () => {
    const hook = await renderHookFresh(true);
    const player = FakePlayer.instances[0];

    const track = { uri: 'spotify:track:1', name: 'Neon Nights' } as Spotify.WebPlaybackTrack;
    await act(async () => {
      player.emit('player_state_changed', {
        paused: false,
        track_window: { current_track: track },
      });
    });
    expect(hook.result.isPaused).toBe(false);
    expect(hook.result.currentTrack).toBe(track);

    await act(async () => {
      player.emit('player_state_changed', {
        paused: true,
        track_window: { current_track: track },
      });
    });
    expect(hook.result.isPaused).toBe(true);
  });

  it('maps account_error to the Premium-required error kind (D014 PremiumGate signal)', async () => {
    const hook = await renderHookFresh(true);
    const player = FakePlayer.instances[0];

    await act(async () => {
      player.emit('account_error', { message: 'Premium required' });
    });
    expect(hook.result.error).toEqual({
      kind: 'account',
      message: 'Premium required',
    });
  });

  it('maps initialization, authentication, and playback errors to their kinds', async () => {
    const hook = await renderHookFresh(true);
    const player = FakePlayer.instances[0];

    await act(async () => {
      player.emit('initialization_error', { message: 'init boom' });
    });
    expect(hook.result.error?.kind).toBe('initialization');
    expect(hook.result.error?.message).toBe('init boom');

    await act(async () => {
      player.emit('authentication_error', { message: 'auth boom' });
    });
    expect(hook.result.error?.kind).toBe('authentication');

    await act(async () => {
      player.emit('playback_error', { message: 'playback boom' });
    });
    expect(hook.result.error?.kind).toBe('playback');
  });

  it('surfaces a categorized initialization error when connect() returns false', async () => {
    vi.doMock('./sdkLoader', () => ({
      loadSpotifySdk: vi.fn(async () => ({
        Player: class FailingConnect extends FakePlayer {
          connect = vi.fn(async () => false);
        },
      })),
    }));
    vi.resetModules();

    const hook = await renderHookFresh(true);
    expect(hook.result.error?.kind).toBe('initialization');
    expect(hook.result.error?.message).toContain('connect() returned false');
  });

  it('calls disconnect() on unmount teardown', async () => {
    const hook = await renderHookFresh(true);
    const player = FakePlayer.instances[0];
    expect(player.disconnect).not.toHaveBeenCalled();

    await hook.unmount();
    expect(player.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects via the registry (logout ordering, S01-T3) while mounted', async () => {
    const hook = await renderHookFresh(true);
    const player = FakePlayer.instances[0];

    await hook.disconnectPlayer();
    expect(player.disconnect).toHaveBeenCalledTimes(1);

    // Unmount afterwards stays balanced (idempotent cleanup).
    await hook.unmount();
    expect(player.disconnect).toHaveBeenCalledTimes(1);
  });

  it('disconnects when enabled flips to false and resets to the initial state', async () => {
    const hook = await renderHookFresh(true);
    const player = FakePlayer.instances[0];

    await act(async () => {
      player.emit('ready', { device_id: 'dev-1' });
    });
    expect(hook.result.isReady).toBe(true);

    await hook.rerender(false);
    expect(player.disconnect).toHaveBeenCalledTimes(1);
    expect(hook.result).toMatchObject({
      deviceId: null,
      isReady: false,
      isPaused: true,
      currentTrack: null,
      error: null,
    });
  });

  it('never creates a player when disabled, so nothing leaks from authed=false renders', async () => {
    const hook = await renderHookFresh(false);
    expect(FakePlayer.instances).toHaveLength(0);
    expect(hook.result.isReady).toBe(false);
    await hook.unmount();
  });

  it('StrictMode-style unmount-remount connects exactly one live player', async () => {
    const first = await renderHookFresh(true);
    const firstPlayer = FakePlayer.instances[0];
    await first.unmount();
    expect(firstPlayer.disconnect).toHaveBeenCalledTimes(1);

    // Remount: a fresh player is created and connected; the old one stays dead.
    const second = await renderHookFresh(true);
    expect(FakePlayer.instances).toHaveLength(2);
    expect(FakePlayer.instances[1].connect).toHaveBeenCalledTimes(1);
    expect(firstPlayer.disconnect).toHaveBeenCalledTimes(1);

    // The registry now points at the new player only.
    const secondPlayer = FakePlayer.instances[1];
    await second.disconnectPlayer();
    expect(secondPlayer.disconnect).toHaveBeenCalledTimes(1);
    expect(firstPlayer.disconnect).toHaveBeenCalledTimes(1); // still just once
    await second.unmount();
  });
});
