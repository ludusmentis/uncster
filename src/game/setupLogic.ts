/**
 * Pure game-setup logic (M004 / S03, T1 — D010 / MEM038).
 *
 * Node-pure behavioral contract for the setup surface: player roster,
 * win condition, short-playlist warning math, and start validation.
 * No React, no fetch, no localStorage — the UI (T5) and store (T2)
 * consume this tested API.
 */

export interface Player {
  id: string;
  name: string;
}

export interface SetupState {
  players: Player[];
  songsToWin: number;
}

export interface GameConfig {
  playlistId: string;
  playlistName: string;
  players: Player[];
  songsToWin: number;
}

export const DEFAULT_SONGS_TO_WIN = 10;
export const MIN_SONGS_TO_WIN = 1;
export const MAX_SONGS_TO_WIN = 15;

export const DEFAULT_SETUP_STATE: SetupState = {
  players: [],
  songsToWin: DEFAULT_SONGS_TO_WIN,
};

export interface AddPlayerResult {
  state: SetupState;
  /** User-facing reason the player was not added, or null on success. */
  error: string | null;
}

/** Add a player by name. Trims; rejects empty and case-insensitive duplicates. */
export function addPlayer(state: SetupState, name: string): AddPlayerResult {
  const trimmed = name.trim();
  if (trimmed === '') {
    return { state, error: 'Enter a player name.' };
  }
  const duplicate = state.players.some(
    (p) => p.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (duplicate) {
    return { state, error: `"${trimmed}" is already in the game.` };
  }
  return {
    state: {
      ...state,
      players: [...state.players, { id: crypto.randomUUID(), name: trimmed }],
    },
    error: null,
  };
}

/** Remove a player by id (no-op if the id is unknown). */
export function removePlayer(state: SetupState, id: string): SetupState {
  return { ...state, players: state.players.filter((p) => p.id !== id) };
}

export interface SetSongsToWinResult {
  state: SetupState;
  /** Explanation for invalid input, or null when accepted. */
  reason: string | null;
}

/**
 * Set the win condition. Accepts integers 1–15; rejects anything else
 * with a user-facing reason. (Boundaries are rules, not clamps: silently
 * changing 0→1 would hide a typo from the player.)
 */
export function setSongsToWin(
  state: SetupState,
  value: number,
): SetSongsToWinResult {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { state, reason: 'Songs to win must be a whole number.' };
  }
  if (value < MIN_SONGS_TO_WIN) {
    return {
      state,
      reason: `Songs to win must be at least ${MIN_SONGS_TO_WIN}.`,
    };
  }
  if (value > MAX_SONGS_TO_WIN) {
    return { state, reason: `Songs to win can be at most ${MAX_SONGS_TO_WIN}.` };
  }
  return { state: { ...state, songsToWin: value }, reason: null };
}

/** True when the playlist cannot cover every player winning the full quota. */
export function isShortPlaylist(
  state: SetupState,
  totalTracks: number,
): boolean {
  return totalTracks < state.players.length * state.songsToWin;
}

/**
 * Blocking reason the game cannot start (no players, or an invalid win
 * condition), or null when start is allowed. The short-playlist warning
 * is deliberately NOT blocking (D010: advisory banner only).
 */
export function validateStart(
  state: SetupState,
  _totalTracks: number,
): string | null {
  if (state.players.length < 1) {
    return 'Add at least one player to start.';
  }
  if (
    !Number.isInteger(state.songsToWin) ||
    state.songsToWin < MIN_SONGS_TO_WIN ||
    state.songsToWin > MAX_SONGS_TO_WIN
  ) {
    return 'Choose a valid number of songs to win (1–15).';
  }
  return null;
}
