/**
 * Tests for the game-setup store (M004 / S03, T2):
 * - save/load round-trip via localStorage (in-memory Map shim; the vitest
 *   env is node-pure, mirroring how src/routing.test.ts shims globals).
 * - default SetupState on missing key, corrupt JSON, and wrong shape.
 * - persistence is keyed per playlist.
 * - pending GameConfig set/take semantics: take clears the slot, second
 *   take returns null, and no URL params are involved (shared-module slot
 *   only, per D010).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  loadSetupState,
  saveSetupState,
  setPendingGameConfig,
  takePendingGameConfig,
} from './setupStore';
import { DEFAULT_SETUP_STATE } from './setupLogic';

/** Minimal localStorage shim backed by a Map. */
class MemoryLocalStorage {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

const storage = new MemoryLocalStorage();

beforeEach(() => {
  storage.clear();
  (globalThis as Record<string, unknown>).localStorage = storage;
  // Reset the pending-config slot between tests.
  takePendingGameConfig();
});

const stateA = {
  players: [
    { id: 'p-1', name: 'Orlo' },
    { id: 'p-2', name: 'Zeta' },
  ],
  songsToWin: 15,
};

describe('loadSetupState / saveSetupState', () => {
  it('round-trips a saved state', () => {
    saveSetupState('pl-1', stateA);
    expect(loadSetupState('pl-1')).toEqual(stateA);
  });

  it('returns the default state for a missing key', () => {
    expect(loadSetupState('pl-unknown')).toEqual(DEFAULT_SETUP_STATE);
  });

  it('returns the default state on corrupt JSON', () => {
    storage.setItem('harlequin.setup.pl-1', '{not json');
    expect(loadSetupState('pl-1')).toEqual(DEFAULT_SETUP_STATE);
  });

  it('returns the default state on a wrong shape (players not an array)', () => {
    storage.setItem(
      'harlequin.setup.pl-1',
      JSON.stringify({ players: 'nope', songsToWin: 5 }),
    );
    expect(loadSetupState('pl-1')).toEqual(DEFAULT_SETUP_STATE);
  });

  it('returns the default state on a wrong shape (songsToWin not an integer)', () => {
    storage.setItem(
      'harlequin.setup.pl-1',
      JSON.stringify({ players: [], songsToWin: 'ten' }),
    );
    expect(loadSetupState('pl-1')).toEqual(DEFAULT_SETUP_STATE);
  });

  it('returns the default state on a wrong shape (player missing id)', () => {
    storage.setItem(
      'harlequin.setup.pl-1',
      JSON.stringify({ players: [{ name: 'Orlo' }], songsToWin: 5 }),
    );
    expect(loadSetupState('pl-1')).toEqual(DEFAULT_SETUP_STATE);
  });

  it('persisted states are keyed per playlist', () => {
    saveSetupState('pl-1', stateA);
    saveSetupState('pl-2', {
      players: [{ id: 'p-3', name: 'Ada' }],
      songsToWin: 3,
    });
    expect(loadSetupState('pl-1')).toEqual(stateA);
    expect(loadSetupState('pl-2')).toEqual({
      players: [{ id: 'p-3', name: 'Ada' }],
      songsToWin: 3,
    });
  });
});

describe('pending GameConfig slot (module-level, no URL params)', () => {
  it('take returns and clears the slot; a second take returns null', () => {
    expect(takePendingGameConfig()).toBeNull();

    const config = {
      playlistId: 'pl-1',
      playlistName: 'Mock Playlist One',
      players: stateA.players,
      songsToWin: 15,
    };
    setPendingGameConfig(config);
    expect(takePendingGameConfig()).toEqual(config);
    expect(takePendingGameConfig()).toBeNull();
  });

  it('a new config overwrites any previous slot value', () => {
    setPendingGameConfig({
      playlistId: 'pl-1',
      playlistName: 'First',
      players: [],
      songsToWin: 10,
    });
    const second = {
      playlistId: 'pl-2',
      playlistName: 'Second',
      players: stateA.players,
      songsToWin: 15,
    };
    setPendingGameConfig(second);
    expect(takePendingGameConfig()).toEqual(second);
  });
});
