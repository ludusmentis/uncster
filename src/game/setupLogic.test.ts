/**
 * Contract tests for the pure setup logic (S03-T1) — node-pure vitest.
 */

import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  DEFAULT_SETUP_STATE,
  DEFAULT_SONGS_TO_WIN,
  isShortPlaylist,
  MAX_SONGS_TO_WIN,
  MIN_SONGS_TO_WIN,
  removePlayer,
  setSongsToWin,
  validateStart,
  type SetupState,
} from './setupLogic';

function stateWith(names: string[], songsToWin = 10): SetupState {
  return {
    players: names.map((name, i) => ({ id: `p-${i}`, name })),
    songsToWin,
  };
}

describe('addPlayer', () => {
  it('trims the name on add', () => {
    const { state, error } = addPlayer(DEFAULT_SETUP_STATE, '  Orlo  ');
    expect(error).toBeNull();
    expect(state.players).toHaveLength(1);
    expect(state.players[0].name).toBe('Orlo');
  });

  it('rejects empty and whitespace-only names with a user-facing error', () => {
    for (const name of ['', '   ']) {
      const { state, error } = addPlayer(DEFAULT_SETUP_STATE, name);
      expect(error).toBe('Enter a player name.');
      expect(state.players).toHaveLength(0);
    }
  });

  it('rejects duplicate names case-insensitively and leaves state untouched', () => {
    const base = stateWith(['Orlo']);
    const { state, error } = addPlayer(base, '  orlo ');
    expect(error).toBe('"orlo" is already in the game.');
    expect(state).toBe(base);
    expect(state.players).toHaveLength(1);
  });

  it('assigns a unique id to each added player', () => {
    let s = DEFAULT_SETUP_STATE;
    const a = addPlayer(s, 'A');
    const b = addPlayer(a.state, 'B');
    if (a.error || b.error) throw new Error('unexpected add failure');
    s = b.state;
    expect(s.players).toHaveLength(2);
    expect(s.players[0].id).not.toBe(s.players[1].id);
    expect(s.players.map((p) => p.name)).toEqual(['A', 'B']);
  });
});

describe('removePlayer', () => {
  it('removes by id and preserves order of the rest', () => {
    const base = stateWith(['Orlo', 'Zeta', 'Mira']);
    const next = removePlayer(base, 'p-1');
    expect(next.players.map((p) => p.name)).toEqual(['Orlo', 'Mira']);
  });

  it('is a no-op for an unknown id and returns a new state object', () => {
    const base = stateWith(['Orlo']);
    const next = removePlayer(base, 'nope');
    expect(next.players).toHaveLength(1);
    expect(next).not.toBe(base);
  });
});

describe('setSongsToWin', () => {
  it('accepts the boundary values 1 and 15', () => {
    for (const value of [1, 15]) {
      const { state, reason } = setSongsToWin(DEFAULT_SETUP_STATE, value);
      expect(reason).toBeNull();
      expect(state.songsToWin).toBe(value);
    }
  });

  it('rejects 0 and 16 with reasons', () => {
    expect(setSongsToWin(DEFAULT_SETUP_STATE, 0).reason).toBe(
      `Songs to win must be at least ${MIN_SONGS_TO_WIN}.`,
    );
    expect(setSongsToWin(DEFAULT_SETUP_STATE, 16).reason).toBe(
      `Songs to win can be at most ${MAX_SONGS_TO_WIN}.`,
    );
    // Rejected values must not change the state.
    expect(setSongsToWin(DEFAULT_SETUP_STATE, 0).state.songsToWin).toBe(10);
  });

  it('rejects non-integers (fractional, NaN, Infinity) without changing state', () => {
    for (const value of [2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { state, reason } = setSongsToWin(DEFAULT_SETUP_STATE, value);
      expect(reason).toBe('Songs to win must be a whole number.');
      expect(state.songsToWin).toBe(10);
    }
  });
});

describe('defaults', () => {
  it('has no players and songsToWin 10', () => {
    expect(DEFAULT_SETUP_STATE.players).toEqual([]);
    expect(DEFAULT_SONGS_TO_WIN).toBe(10);
    expect(DEFAULT_SETUP_STATE.songsToWin).toBe(10);
  });
});

describe('isShortPlaylist', () => {
  it('warns when tracks cannot cover players x quota (2 x 15 > 10)', () => {
    expect(isShortPlaylist(stateWith(['Orlo', 'Zeta'], 15), 10)).toBe(true);
  });

  it('does not warn at exactly the required count (2 x 5 = 10)', () => {
    expect(isShortPlaylist(stateWith(['Orlo', 'Zeta'], 5), 10)).toBe(false);
  });

  it('does not warn with no players regardless of tracks', () => {
    expect(isShortPlaylist(DEFAULT_SETUP_STATE, 0)).toBe(false);
  });
});

describe('validateStart', () => {
  it('blocks start with zero players', () => {
    const reason = validateStart(DEFAULT_SETUP_STATE, 100);
    expect(reason).toBe('Add at least one player to start.');
  });

  it('blocks start with an invalid songsToWin even when players exist', () => {
    const bad = { players: stateWith(['Orlo']).players, songsToWin: 0 };
    const reason = validateStart(bad, 100);
    expect(typeof reason).toBe('string');
    expect(reason).not.toBeNull();
  });

  it('allows start with at least one player and a valid win condition', () => {
    expect(validateStart(stateWith(['Orlo'], 10), 100)).toBeNull();
  });

  it('does NOT block on a short playlist (warning is non-blocking)', () => {
    // 2 players x 15 songs = 30 needed, only 10 available.
    expect(validateStart(stateWith(['Orlo', 'Zeta'], 15), 10)).toBeNull();
  });
});
