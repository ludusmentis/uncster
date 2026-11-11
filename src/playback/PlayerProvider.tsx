/**
 * Player context provider (M005 / S02-T2, D012).
 *
 * App-level singleton: mount once in App.tsx keyed on `authed` so the
 * Connect device persists across route changes. Descendants read player
 * state via usePlayer().
 *
 * Logout ordering (S01-T3 contract): call disconnectPlayer() BEFORE
 * logout() so the SDK device is torn down before tokens are wiped — a
 * lingering SDK token callback then sees no tokens and cannot resurrect
 * a ghost session.
 */

import {
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import {
  useSpotifyPlayer,
  type UseSpotifyPlayerResult,
} from './useSpotifyPlayer';

const PlayerContext = createContext<UseSpotifyPlayerResult | null>(null);

export function usePlayer(): UseSpotifyPlayerResult {
  const ctx = useContext(PlayerContext);
  if (!ctx) {
    throw new Error('usePlayer requires <PlayerProvider> in the tree.');
  }
  return ctx;
}

/**
 * Mount only while authed; the hook's effect teardown disconnects the SDK
 * device when authed flips false (logout or silent-refresh wipe), which
 * also remounts this provider for the next login.
 */
export function PlayerProvider({
  authed,
  children,
}: {
  authed: boolean;
  children: ReactNode;
}): JSX.Element {
  const player = useSpotifyPlayer(authed);
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
}
