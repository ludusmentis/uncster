/**
 * Persisted game-state store (M007 / S01, T04).
 *
 * Mirrors setupStore.ts conventions:
 * - localStorage access is try/catch wrapped so privacy-mode / blocked
 *   storage degrades instead of crashing.
 * - A full self-contained snapshot (GameConfig + deck + per-player lists
 *   + current player + hidden song + phase + winners) is stored per
 *   playlist under `harlequin.game.<playlistId>`.
 * - The snapshot envelope carries a version; a D015-style version bump
 *   (changing GAME_SNAPSHOT_VERSION) makes all older stored snapshots
 *   fail version validation and be discarded as stale.
 * - A fixed pointer key `harlequin.game.active` holds the playlistId of
 *   the active game so the bare /game route can find the active game
 *   after a reload.
 *
 * No React imports; pure functions + localStorage only.
 */

import type { GameConfig } from './setupLogic';
import type { TurnPhase, TurnState } from './turnEngine';

/** Snapshot envelope version. Bump on any format change (D015-style). */
export const GAME_SNAPSHOT_VERSION = 1;

const KEY_PREFIX = 'harlequin.game.';
const ACTIVE_POINTER_KEY = 'harlequin.game.active';

/** A persisted, self-contained game snapshot. */
export interface GameSnapshot {
  version: number;
  config: GameConfig;
  state: TurnState;
}

function gameKey(playlistId: string): string {
  return `${KEY_PREFIX}${playlistId}`;
}

const TURN_PHASES: readonly TurnPhase[] = [
  'start-card',
  'draw-hidden',
  'awaiting-drop',
  'reveal-success',
  'reveal-fail',
  'game-over',
];

/** A structural validity check for a song entry (deck or player list). */
function isSongLike(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Record<string, unknown>;
  if (typeof s.name !== 'string') return false;
  if (s.releaseYear === undefined) return true;
  return typeof s.releaseYear === 'string';
}

/** Validate the deep shape of a candidate snapshot; null on mismatch. */
function validateSnapshot(value: unknown): GameSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== GAME_SNAPSHOT_VERSION) return null;
  const config = v.config;
  if (typeof config !== 'object' || config === null) return null;
  const c = config as Record<string, unknown>;
  if (
    typeof c.playlistId !== 'string' ||
    typeof c.playlistName !== 'string' ||
    !Array.isArray(c.players) ||
    !c.players.every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>).id === 'string' &&
        typeof (p as Record<string, unknown>).name === 'string',
    ) ||
    typeof c.songsToWin !== 'number'
  ) {
    return null;
  }
  const s = v.state as Record<string, unknown>;
  if (typeof s !== 'object' || s === null) return null;
  if (
    !Array.isArray(s.players) ||
    !s.players.every(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as Record<string, unknown>).id === 'string' &&
        typeof (p as Record<string, unknown>).name === 'string' &&
        Array.isArray((p as { songs?: unknown }).songs) &&
        ((p as { songs: unknown[] }).songs.every(isSongLike)),
    ) ||
    !Array.isArray(s.deck) ||
    s.deck.length === 0 ||
    !s.deck.every(isSongLike) ||
    typeof s.currentIndex !== 'number' ||
    !Number.isInteger(s.currentIndex) ||
    s.currentIndex < 0 ||
    s.currentIndex >= (s.players as unknown[]).length ||
    typeof s.phase !== 'string' ||
    !TURN_PHASES.includes(s.phase as TurnPhase) ||
    !Array.isArray(s.winners) ||
    !s.winners.every((w) => typeof w === 'string') ||
    typeof s.songsToWin !== 'number' ||
    typeof s.finished !== 'boolean'
  ) {
    return null;
  }
  const hidden = s.hiddenSong;
  if (hidden !== null && !isSongLike(hidden)) return null;
  return value as unknown as GameSnapshot;
}

/** Serialize a snapshot to its persisted JSON form. */
export function serializeGameSnapshot(snapshot: GameSnapshot): string {
  return JSON.stringify({ ...snapshot, version: GAME_SNAPSHOT_VERSION });
}

/** Parse and validate a raw snapshot; null on corrupt data or version mismatch. */
export function parseGameSnapshot(raw: string): GameSnapshot | null {
  try {
    return validateSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist a full game snapshot for a playlist and point the active-game pointer at it. */
export function saveGameState(playlistId: string, config: GameConfig, state: TurnState): void {
  try {
    const snapshot: GameSnapshot = { version: GAME_SNAPSHOT_VERSION, config, state };
    localStorage.setItem(gameKey(playlistId), serializeGameSnapshot(snapshot));
    localStorage.setItem(ACTIVE_POINTER_KEY, playlistId);
  } catch {
    // Privacy mode / quota: state stays in-memory only for this session.
  }
}

/** Load the snapshot for a playlist; null on missing, corrupt, or version-mismatched data (stale snapshots are discarded). */
export function loadGameState(playlistId: string): GameSnapshot | null {
  try {
    const raw = localStorage.getItem(gameKey(playlistId));
    if (!raw) return null;
    const snapshot = parseGameSnapshot(raw);
    if (!snapshot) {
      // Discard the stale/corrupt game so a fresh one can be started.
      localStorage.removeItem(gameKey(playlistId));
      if (localStorage.getItem(ACTIVE_POINTER_KEY) === playlistId) {
        localStorage.removeItem(ACTIVE_POINTER_KEY);
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}

/** The playlistId of the active game, or null. */
export function getActivePlaylistId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_POINTER_KEY);
  } catch {
    return null;
  }
}

/** Load the active game's snapshot (via the pointer), or null.
 * A pointer whose snapshot cannot be loaded (missing raw data, or a stale/
 * corrupt snapshot already discarded by loadGameState) is itself discarded so
 * it cannot dangle. */
export function loadActiveGameState(): GameSnapshot | null {
  const playlistId = getActivePlaylistId();
  if (!playlistId) return null;
  const snapshot = loadGameState(playlistId);
  if (!snapshot) {
    try {
      localStorage.removeItem(ACTIVE_POINTER_KEY);
    } catch {
      // Storage unavailable — nothing to clear.
    }
  }
  return snapshot;
}

/**
 * Rebuild a mid-turn TurnState from a persisted snapshot: structural
 * copies of deck, player lists, hidden song, and bookkeeping fields so
 * the turn engine can resume exactly where the game left off.
 * Returns null when the snapshot's state is structurally invalid.
 */
export function resumeGame(snapshot: GameSnapshot): TurnState | null {
  const { state } = snapshot;
  if (
    !Array.isArray(state.players) ||
    state.players.length === 0 ||
    state.players.some((p) => !Array.isArray(p.songs)) ||
    !Array.isArray(state.deck) ||
    state.deck.length === 0 ||
    typeof state.currentIndex !== 'number' ||
    state.currentIndex < 0 ||
    state.currentIndex >= state.players.length ||
    !TURN_PHASES.includes(state.phase) ||
    typeof state.songsToWin !== 'number' ||
    !Array.isArray(state.winners)
  ) {
    return null;
  }
  return {
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      songs: p.songs.map((s) => ({ ...s })),
    })),
    deck: state.deck.map((s) => ({ ...s })),
    currentIndex: state.currentIndex,
    phase: state.phase,
    hiddenSong: state.hiddenSong ? { ...state.hiddenSong } : null,
    winners: [...state.winners],
    songsToWin: state.songsToWin,
    finished: state.finished,
  };
}

/** Clear a playlist's persisted game (and its pointer if it was active). */
export function clearGameState(playlistId: string): void {
  try {
    localStorage.removeItem(gameKey(playlistId));
    if (localStorage.getItem(ACTIVE_POINTER_KEY) === playlistId) {
      localStorage.removeItem(ACTIVE_POINTER_KEY);
    }
  } catch {
    // Storage unavailable — nothing to clear.
  }
}
