/**
 * Game-setup persistence + handoff (M004 / S03, T2 — D010 / MEM038).
 *
 * - SetupState is persisted per playlist under `harlequin.setup.<playlistId>`
 *   in localStorage (try/catch wrapped like src/auth/tokenStore.ts so
 *   privacy-mode / blocked storage degrades instead of crashing).
 * - The GameConfig handoff to the game view is a module-level single slot
 *   (NOT URL params, per D010): set on Start Game, taken (and cleared) on
 *   the game view's mount.
 */

import {
  DEFAULT_SETUP_STATE,
  GameConfig,
  SetupState,
} from './setupLogic';

function storageKey(playlistId: string): string {
  return `harlequin.setup.${playlistId}`;
}

/** Load setup state for a playlist; defaults on missing or corrupt data. */
export function loadSetupState(playlistId: string): SetupState {
  try {
    const raw = localStorage.getItem(storageKey(playlistId));
    if (!raw) return DEFAULT_SETUP_STATE;
    const parsed = JSON.parse(raw) as Partial<SetupState>;
    if (
      Array.isArray(parsed.players) &&
      parsed.players.every(
        (p) =>
          p !== null &&
          typeof p === 'object' &&
          typeof (p as PlayerLike).id === 'string' &&
          typeof (p as PlayerLike).name === 'string',
      ) &&
      typeof parsed.songsToWin === 'number' &&
      Number.isInteger(parsed.songsToWin)
    ) {
      return {
        players: parsed.players,
        songsToWin: parsed.songsToWin,
      };
    }
    return DEFAULT_SETUP_STATE;
  } catch {
    return DEFAULT_SETUP_STATE;
  }
}

interface PlayerLike {
  id: string;
  name: string;
}

/** Persist setup state for a playlist; storage failures are swallowed. */
export function saveSetupState(playlistId: string, state: SetupState): void {
  try {
    localStorage.setItem(storageKey(playlistId), JSON.stringify(state));
  } catch {
    // Privacy mode / quota: state stays in-memory only for this session.
  }
}

let pendingGameConfig: GameConfig | null = null;

/** Set the single pending config consumed by the game view on start. */
export function setPendingGameConfig(config: GameConfig): void {
  pendingGameConfig = config;
}

/** Return and clear the pending config; null when none is pending. */
export function takePendingGameConfig(): GameConfig | null {
  const config = pendingGameConfig;
  pendingGameConfig = null;
  return config;
}
