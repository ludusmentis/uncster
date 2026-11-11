/**
 * Web Playback SDK lifecycle hook (M005 / S02-T2).
 *
 * Loads the SDK via the idempotent loader, instantiates a single
 * Spotify.Player ("Web App Player", volume 0.5, tokens via the S01
 * getOAuthToken provider), connects it, and wires every required event
 * listener. Exposes deviceId / isReady / isPaused / currentTrack / error
 * plus activateElement() for autoplay unlock.
 *
 * StrictMode safety (React 18 dev double-invokes effects): connect and
 * disconnect are balanced in the effect body/cleanup, and a cancellation
 * flag guards stale async state writes between load and teardown, so the
 * mount-unmount-remount cycle never leaks a second Connect device or a
 * zombie ready state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSpotifySdk } from './sdkLoader';
import { getToken } from '../api/authedFetch';

/** Categorised SDK error surfaced to the UI (account_error → PremiumGate, D014). */
export interface PlayerError {
  kind: 'initialization' | 'authentication' | 'account' | 'playback' | 'load';
  message: string;
}

export interface PlayerState {
  deviceId: string | null;
  isReady: boolean;
  isPaused: boolean;
  currentTrack: Spotify.WebPlaybackTrack | null;
  error: PlayerError | null;
}

export interface UseSpotifyPlayerResult extends PlayerState {
  /** Bind to a user click to satisfy autoplay policies. No-op until ready. */
  activateElement: () => void;
  /** Toggle pause/resume on the SDK device. No-op until ready. */
  togglePlay: () => void;
}

/**
 * App-level teardown registry (S01-T3 ordering contract): App calls this
 * immediately before logout() so the SDK device dies before tokens are
 * wiped. Null when no live player exists.
 */
let playerTeardown: (() => void) | null = null;

/** Disconnect the live SDK player, if any (call before logout()). */
export function disconnectPlayer(): void {
  playerTeardown?.();
  playerTeardown = null;
}

const INITIAL_STATE: PlayerState = {
  deviceId: null,
  isReady: false,
  isPaused: true,
  currentTrack: null,
  error: null,
};

export function useSpotifyPlayer(enabled: boolean): UseSpotifyPlayerResult {
  const [state, setState] = useState<PlayerState>(INITIAL_STATE);
  const playerRef = useRef<Spotify.Player | null>(null);

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL_STATE);
      return;
    }

    let cancelled = false;

    const handleError = (kind: PlayerError['kind'], message: string) => {
      console.error(`[player:${kind}]`, message);
      if (!cancelled) setState((s) => ({ ...s, error: { kind, message } }));
    };

    loadSpotifySdk()
      .then((Spotify) => {
        if (cancelled) return;

        const player = new Spotify.Player({
          name: 'Web App Player',
          volume: 0.5,
          getOAuthToken: (cb) => {
            getToken()
              .then(cb)
              .catch((err: unknown) => {
                // getToken already wiped tokens / emitted disconnected on
                // refresh failure; the SDK will surface authentication_error.
                console.warn('[player:token] failed to supply access token', err);
              });
          },
        });
        playerRef.current = player;

        player.addListener('ready', ({ device_id }) => {
          console.info('[player] ready — device_id:', device_id);
          if (!cancelled) {
            setState((s) => ({ ...s, deviceId: device_id, isReady: true }));
          }
        });

        player.addListener('not_ready', () => {
          console.warn('[player] not_ready — device lost');
          if (!cancelled) {
            setState((s) => ({ ...s, isReady: false }));
          }
        });

        player.addListener('player_state_changed', (playerState) => {
          if (cancelled) return;
          setState((s) => ({
            ...s,
            isPaused: playerState.paused,
            currentTrack: playerState.track_window.current_track,
          }));
        });

        player.addListener('initialization_error', ({ message }) =>
          handleError('initialization', message));
        player.addListener('authentication_error', ({ message }) =>
          handleError('authentication', message));
        player.addListener('account_error', ({ message }) =>
          handleError('account', message));
        player.addListener('playback_error', ({ message }) =>
          handleError('playback', message));

        return player.connect().then((ok) => {
          if (!ok) {
            handleError('initialization', 'Spotify.Player.connect() returned false');
          }
        });
      })
      .catch((err: unknown) => {
        handleError('load', err instanceof Error ? err.message : String(err));
      });

    // Balanced teardown, exposed via registry so App can call disconnectPlayer()
    // before logout() (S01-T3 ordering), and self-invoke via the same
    // registry on unmount / authed flip so cleanup stays idempotent.
    const teardown = () => {
      playerRef.current?.disconnect();
      playerRef.current = null;
    };
    playerTeardown = teardown;

    return () => {
      cancelled = true;
      if (playerTeardown === teardown) playerTeardown = null;
      teardown();
    };
  }, [enabled]);

  const activateElement = useCallback(() => {
    playerRef.current?.activateElement();
  }, []);

  const togglePlay = useCallback(() => {
    playerRef.current?.togglePlay().catch((err: unknown) => {
      console.error('[player:toggle] togglePlay failed', err);
    });
  }, []);

  return { ...state, activateElement, togglePlay };
}
