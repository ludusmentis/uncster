/**
 * Tests for the persisted game-state store (M007 / S01, T04):
 * - serialize/parse round-trip.
 * - corrupt JSON and wrong-shape fallback (snapshot discarded).
 * - version mismatch (future/older version key) discards the stale game.
 * - per-playlist keying and active-game pointer set/read/clear.
 * - resumeGame reconstruction of a mid-turn state from a snapshot.
 *
 * The vitest env is node-pure; localStorage is an in-memory Map shim
 * (mirrors setupStore.test.ts).
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  GAME_SNAPSHOT_VERSION,
  clearGameState,
  getActivePlaylistId,
  loadActiveGameState,
  loadGameState,
  parseGameSnapshot,
  resumeGame,
  saveGameState,
  serializeGameSnapshot,
  type GameSnapshot,
} from './gameStateStore';
import { createTurnState, startTurn, drawHidden, drop, resolveTurn } from './turnEngine';
import type { TurnSong } from './turnEngine';
import type { GameConfig } from './setupLogic';

class MemoryLocalStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

const storage = new MemoryLocalStorage();

const CONFIG: GameConfig = {
  playlistId: 'pl-1',
  playlistName: 'Road Trip',
  players: [
    { id: 'p1', name: 'Ada' },
    { id: 'p2', name: 'Grace' },
  ],
  songsToWin: 3,
};

const TRACKS = [
  { name: 'Song A', uri: 'uri:a', releaseYear: '1998' },
  { name: 'Song B', uri: 'uri:b', releaseYear: '2005' },
  { name: 'Song C', uri: 'uri:c', releaseYear: '1992' },
  { name: 'Song D', uri: 'uri:d', releaseYear: '2011' },
  { name: 'Song E', uri: 'uri:e', releaseYear: '1979' },
];

beforeEach(() => {
  storage.clear();
  (globalThis as Record<string, unknown>).localStorage = storage;
});

describe('serialize/parse round-trip', () => {
  it('round-trips a full snapshot', () => {
    const snapshot: GameSnapshot = {
      version: GAME_SNAPSHOT_VERSION,
      config: CONFIG,
      state: createTurnState(
        CONFIG.players.map((p) => ({ ...p, songs: [] })),
        TRACKS,
        3,
      ),
    };
    const raw = serializeGameSnapshot(snapshot);
    const parsed = parseGameSnapshot(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.config).toEqual(CONFIG);
    expect(parsed!.state.deck).toEqual(TRACKS);
    expect(parsed!.state.phase).toBe('start-card');
  });

  it('rejects corrupt JSON', () => {
    expect(parseGameSnapshot('{not json')).toBeNull();
  });
});

describe('version and shape fallback', () => {
  it('discards a snapshot whose version does not match', () => {
    const stale = JSON.stringify({ version: 999, config: CONFIG, state: null });
    storage.setItem('harlequin.game.pl-1', stale);
    storage.setItem('harlequin.game.active', 'pl-1');
    expect(loadGameState('pl-1')).toBeNull();
    // The stale game and its dangling pointer are removed.
    expect(storage.getItem('harlequin.game.pl-1')).toBeNull();
    expect(getActivePlaylistId()).toBeNull();
  });

  it('discards a wrong-shape snapshot (empty deck)', () => {
    const malformed = JSON.stringify({
      version: GAME_SNAPSHOT_VERSION,
      config: CONFIG,
      state: { players: [], deck: [], currentIndex: 0, phase: 'start-card', winners: [], songsToWin: 3, finished: false, hiddenSong: null },
    });
    storage.setItem('harlequin.game.pl-1', malformed);
    expect(loadGameState('pl-1')).toBeNull();
  });

  it('returns null when nothing is stored', () => {
    expect(loadGameState('missing')).toBeNull();
    expect(loadActiveGameState()).toBeNull();
  });
});

describe('per-playlist persistence and active pointer', () => {
  it('saves under the per-playlist key and sets the pointer', () => {
    const state = createTurnState(
      CONFIG.players.map((p) => ({ ...p, songs: [] })),
      TRACKS,
      3,
    );
    saveGameState('pl-1', CONFIG, state);
    expect(storage.getItem('harlequin.game.pl-1')).not.toBeNull();
    expect(getActivePlaylistId()).toBe('pl-1');
    expect(loadActiveGameState()?.config).toEqual(CONFIG);
  });

  it('keying is per playlist: a second playlist does not overwrite the first', () => {
    const state = createTurnState(
      CONFIG.players.map((p) => ({ ...p, songs: [] })),
      TRACKS,
      3,
    );
    saveGameState('pl-1', CONFIG, state);
    const config2 = { ...CONFIG, playlistId: 'pl-2' };
    saveGameState('pl-2', config2, state);
    expect(loadGameState('pl-1')?.config.playlistId).toBe('pl-1');
    expect(loadGameState('pl-2')?.config.playlistId).toBe('pl-2');
    // Last save wins the pointer.
    expect(getActivePlaylistId()).toBe('pl-2');
  });

  it('clearGameState removes the game and the pointer when it pointed at it', () => {
    saveGameState('pl-1', CONFIG, createTurnState(
      CONFIG.players.map((p) => ({ ...p, songs: [] })), TRACKS, 3));
    clearGameState('pl-1');
    expect(loadGameState('pl-1')).toBeNull();
    expect(getActivePlaylistId()).toBeNull();
  });

  it('clearGameState keeps the pointer when it points at another playlist', () => {
    saveGameState('pl-1', CONFIG, createTurnState(
      CONFIG.players.map((p) => ({ ...p, songs: [] })), TRACKS, 3));
    saveGameState('pl-2', { ...CONFIG, playlistId: 'pl-2' }, createTurnState(
      CONFIG.players.map((p) => ({ ...p, songs: [] })), TRACKS, 3));
    clearGameState('pl-1');
    expect(getActivePlaylistId()).toBe('pl-2');
  });
});

describe('resumeGame reconstruction', () => {
  it('rebuilds a mid-turn state whose history continues identically from the snapshot', () => {
    // Play: Ada start card, draw hidden, drop correct, resolve.
    let state = createTurnState(
      CONFIG.players.map((p) => ({ ...p, songs: [] })),
      TRACKS,
      3,
    );
    state = startTurn(state);
    state = drawHidden(state);
    // Persist exactly mid-turn: awaiting-drop with a hidden song held.
    saveGameState('pl-1', CONFIG, state);
    const reloaded = loadGameState('pl-1');
    expect(reloaded).not.toBeNull();
    const resumed = resumeGame(reloaded!);
    expect(resumed).not.toBeNull();
    expect(resumed!.phase).toBe('awaiting-drop');
    expect(resumed!.hiddenSong).toEqual(state.hiddenSong);
    // Deep-copied: mutating the resumed state must not affect the snapshot.
    const before = loadGameState('pl-1');
    const after = resumeGame(loadGameState('pl-1')!);
    expect(after!.players).toEqual(before!.state.players);
    after!.players[0].songs.push({ name: 'X', uri: 'uri:x' });
    expect(loadGameState('pl-1')!.state.players[0].songs).toEqual(before!.state.players[0].songs);
    // The resumed state is engine-usable: resolve the pending drop.
    const next = drop(resumed!, state.players[0].songs.length);
    expect(['reveal-success', 'reveal-fail']).toContain(next.phase);
    expect(resolveTurn(next).currentIndex).toBeGreaterThan(state.currentIndex - 1);
  });

  it('returns null on a structurally invalid state', () => {
    expect(resumeGame({ version: GAME_SNAPSHOT_VERSION, config: CONFIG, state: { ...createTurnState(CONFIG.players.map((p) => ({ ...p, songs: [] })), TRACKS, 3), currentIndex: 7 } })).toBeNull();
  });
});

// S02-T1: snapshot round-trip preserves artist/coverUrl on deck songs.
// JSON.stringify carries the extra fields, and validation must never
// tighten against them — pin it here.
describe('snapshot enrichment round-trip (S02-T1)', () => {
  it('preserves artist and coverUrl on songs through save/load', () => {
    const enriched: TurnSong[] = [
      { name: 'Song A', uri: 'uri:a', releaseYear: '1998', artist: 'Alpha', coverUrl: 'https://i/a' },
      ...TRACKS.slice(1),
    ];
    const state = createTurnState(
      CONFIG.players.map((p) => ({ ...p, songs: [] })),
      enriched,
      3,
    );
    saveGameState('pl-1', CONFIG, state);
    const loaded = loadGameState('pl-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.state.deck).toEqual(enriched);
    expect(loaded!.state.deck[0].artist).toBe('Alpha');
    expect(loaded!.state.deck[0].coverUrl).toBe('https://i/a');
  });
});
