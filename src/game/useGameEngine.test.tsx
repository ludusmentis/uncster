/**
 * Tests for the turn controller hook (M007 / S02, T01).
 *
 * - Drives the real S01 turn engine via the hook through
 *   react-test-renderer (no jsdom dependency needed).
 * - localStorage is an in-memory Map shim (gameStateStore.test.ts
 *   pattern) — the hook persists snapshots to the S01 store.
 * - Asserts: StrictMode take-once of the pending GameConfig, auto
 *   advance to awaiting-drop with the start card dealt, opaque hidden
 *   handle (zero metadata pre-drop), correct/wrong drop outcomes,
 *   Continue rotation with winner removal, persistence, and mid-game
 *   resume from a snapshot.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import type { ReactTestInstance } from 'react-test-renderer';
import type { MutableRefObject } from 'react';
import { useGameEngine, type GameEngineView } from './useGameEngine';
import type { GameConfig } from './setupLogic';
import type { TurnSong } from './turnEngine';
import { createTurnState, startTurn, drawHidden } from './turnEngine';
import { saveGameState } from './gameStateStore';
import { setPendingGameConfig } from './setupStore';

class MemoryLocalStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

function song(name: string, year: number): TurnSong {
  return { name, uri: `spotify:track:${name}`, releaseYear: String(year) };
}

const config = (players: string[], songsToWin = 3): GameConfig => ({
  playlistId: 'pl-game',
  playlistName: 'Game Playlist',
  players: players.map((name, i) => ({ id: `p-${i}`, name })),
  songsToWin,
});

// A-1970, B-1990, C-1980, D-2000 — first draw is A (start card), then B.
const DECK: TurnSong[] = [song('A', 1970), song('B', 1990), song('C', 1980), song('D', 2000)];

interface ProbeProps {
  deck: TurnSong[];
  cfg?: GameConfig | null;
  latest: MutableRefObject<GameEngineView | null>;
}

function Probe({ deck, cfg, latest }: ProbeProps): JSX.Element | null {
  const view = useGameEngine(deck, cfg);
  latest.current = view;
  return null;
}

function renderProbe(props: ProbeProps): { root: ReactTestInstance; update: (cfg: GameConfig | null | undefined) => void } {
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => {
    renderer = TestRenderer.create(<Probe {...props} />);
  });
  return {
    root: renderer.root,
    update: (cfg) => {
      act(() => {
        renderer.update(<Probe deck={props.deck} cfg={cfg} latest={props.latest} />);
      });
    },
  };
}

beforeEach(() => {
  (globalThis as { localStorage: Storage }).localStorage = new MemoryLocalStorage() as unknown as Storage;
});

describe('useGameEngine', () => {
  it('podium: multiple winners in win order with names and full song lists; game-over yields all players', () => {
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: config(['P1', 'P2'], 2), latest });
    // Mid-game: no winners yet — podium lists both players, unranked.
    expect(latest.current!.podium.map((e) => e.name)).toEqual(['P1', 'P2']);
    // P1: start card A-1970; drop B-1990 at index 1 → win (rank 1).
    latest.current!.place(1);
    expect(latest.current!.podium.map((e) => e.id)).toEqual(['p-0', 'p-1']);
    expect(latest.current!.podium[0]).toMatchObject({ id: 'p-0', name: 'P1', rank: 1 });
    expect(latest.current!.podium[0].songs.map((s) => s.name)).toEqual(['A', 'B']);
    expect(latest.current!.podium[0].songs[1].releaseYear).toBe('1990');
    latest.current!.continueTurn();
    // P2: start card C-1980 (deck cycles); drop D-2000 at index 1 → win (rank 2).
    latest.current!.place(1);
    latest.current!.continueTurn();
    const over = latest.current!;
    expect(over.phase).toBe('game-over');
    // Game-over: every player on the podium, in win order, with full lists.
    expect(over.podium).toHaveLength(2);
    expect(over.podium.map((e) => e.id)).toEqual(['p-0', 'p-1']);
    expect(over.podium.map((e) => e.rank)).toEqual([1, 2]);
    expect(over.podium.map((e) => e.name)).toEqual(['P1', 'P2']);
    expect(over.podium[0].songs.map((s) => s.name)).toEqual(['A', 'B']);
    expect(over.podium[1].songs.map((s) => s.name)).toEqual(['C', 'D']);
  });

  it('returns status no-config with null config and no hidden song', () => {
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: null, latest });
    expect(latest.current!.status).toBe('no-config');
    expect(latest.current!.currentPlayer).toBeNull();
    expect(latest.current!.hidden).toBeNull();
  });

  it('drains the pending GameConfig module slot exactly once (take-once, StrictMode replay safe)', () => {
    setPendingGameConfig(config(['Solo']));
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    // First mount consumes the slot.
    const probe = renderProbe({ deck: DECK, cfg: undefined, latest });
    expect(latest.current!.status).toBe('playing');
    // Remount (simulating StrictMode double-mount) does not lose the config.
    probe.update(undefined);
    expect(latest.current!.status).toBe('playing');
    // A fresh mount WITHOUT cfg re-uses the cached take (module slot drained).
    const second: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: undefined, latest: second });
    expect(second.current!.status).toBe('playing');
  });

  it('auto-advances: start card dealt and hidden song drawn, handle leaks zero metadata', () => {
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: config(['Solo']), latest });
    const view = latest.current!;
    expect(view.status).toBe('playing');
    expect(view.phase).toBe('awaiting-drop');
    expect(view.currentPlayer!.name).toBe('Solo');
    expect(view.list).toHaveLength(1); // start card A-1970
    expect(view.list[0].name).toBe('A');
    expect(view.hidden).not.toBeNull();
    // Opaque handle: only an id; the hidden song's metadata never leaks.
    const leakedKeys = Object.keys(view.hidden!).filter(
      (k) => !['id'].includes(k),
    );
    expect(leakedKeys).toEqual([]);
    expect(typeof view.hidden!.id).toBe('string');
    expect(JSON.stringify(view.hidden!)).not.toContain('B');
  });

  it('correct drop: success outcome reveals metadata; wrong drop: fail outcome with correct position', () => {
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: config(['Solo']), latest });
    const view = latest.current!;

    // WRONG: drop B-1990 before A-1970 (index 0).
    view.place(0);
    const failView = latest.current!;
    expect(failView.phase).toBe('reveal-fail');
    expect(failView.outcome!.correct).toBe(false);
    expect(failView.outcome!.correctPosition).toBe(1); // after A-1970
    expect(failView.outcome!.song!.name).toBe('B');
    expect(failView.list).toHaveLength(1); // song lost — not added

    failView.continueTurn();
    let next = latest.current!;
    // Single player: rotation returns to the same player; next turn's
    // start card already exists, so a new hidden song is drawn (C-1980).
    expect(next.phase).toBe('awaiting-drop');
    expect(next.list).toHaveLength(1);
    expect(next.hidden).not.toBeNull();

    // CORRECT: drop C-1980 after A-1970 (index 1).
    next.place(1);
    const successView = latest.current!;
    expect(successView.phase).toBe('reveal-success');
    expect(successView.outcome!.correct).toBe(true);
    expect(successView.outcome!.song!.name).toBe('C');
    expect(successView.list.map((s) => s.name)).toEqual(['A', 'C']);
    expect(successView.hidden).toBeNull(); // no handle while revealing
  });

  it('place with an invalid index is a safe no-op', () => {
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: config(['Solo']), latest });
    latest.current!.place(7); // out of range
    expect(latest.current!.phase).toBe('awaiting-drop');
    latest.current!.place(-1);
    expect(latest.current!.phase).toBe('awaiting-drop');
    latest.current!.continueTurn(); // invalid phase for continue: no-op
    expect(latest.current!.phase).toBe('awaiting-drop');
  });

  it('Continue rotates to the next non-winner in creation order and removes winners', () => {
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: config(['P1', 'P2'], 2), latest });
    // P1: start card A-1970; hidden B-1990 at index 1 is correct → win (2 songs).
    latest.current!.place(1);
    latest.current!.continueTurn();
    expect(latest.current!.winners).toEqual(['p-0']);
    expect(latest.current!.currentPlayer!.name).toBe('P2');
    // P2 wins too → game over.
    latest.current!.place(1);
    latest.current!.continueTurn();
    expect(latest.current!.phase).toBe('game-over');
    expect(latest.current!.winners).toEqual(['p-0', 'p-1']);
    expect(latest.current!.currentPlayer).toBeNull();
  });

  it('persists snapshots to the store after each transition', () => {
    const cfg = config(['Solo']);
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg, latest });
    latest.current!.place(1); // correct drop
    const raw = (globalThis as { localStorage: Storage }).localStorage.getItem('harlequin.game.pl-game');
    expect(raw).toBeTruthy();
    const snap = JSON.parse(raw!) as { state: { players: { songs: unknown[] }[] } };
    expect(snap.state.players[0].songs).toHaveLength(2);
    expect((globalThis as { localStorage: Storage }).localStorage.getItem('harlequin.game.active')).toBe('pl-game');
  });

  it('clears the snapshot and active pointer when the game reaches game-over', () => {
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg: config(['P1', 'P2'], 2), latest });
    expect((globalThis as { localStorage: Storage }).localStorage.getItem('harlequin.game.active')).toBe('pl-game');
    latest.current!.place(1);
    latest.current!.continueTurn();
    latest.current!.place(1);
    latest.current!.continueTurn(); // game-over: pointer + snapshot dropped
    expect(latest.current!.phase).toBe('game-over');
    const store = (globalThis as { localStorage: Storage }).localStorage;
    expect(store.getItem('harlequin.game.active')).toBeNull();
    expect(store.getItem('harlequin.game.pl-game')).toBeNull();
  });

  it('resumes a persisted mid-game snapshot instead of starting fresh', () => {
    const cfg = config(['Solo']);
    const state = drawHidden(startTurn(createTurnState(
      [{ id: 'p-0', name: 'Solo', songs: [song('A', 1970)] }],
      [...DECK].reverse(),
      3,
    )));
    saveGameState(cfg.playlistId, cfg, state);
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg, latest });
    const view = latest.current!;
    expect(view.phase).toBe('awaiting-drop'); // resumed mid-turn, not re-dealt
    expect(view.list.map((s) => s.name)).toEqual(['A']);
    expect(view.hidden).not.toBeNull();
  });

  it('starts fresh when the snapshot is for a different playlist', () => {
    const cfg = config(['Solo']);
    const otherCfg = { ...config(['Other']), playlistId: 'pl-other' };
    const state = drawHidden(startTurn(createTurnState(
      [{ id: 'x', name: 'Other', songs: [song('D', 2000)] }],
      [...DECK].reverse(),
      3,
    )));
    saveGameState('pl-other', otherCfg, state);
    const latest: MutableRefObject<GameEngineView | null> = { current: null };
    renderProbe({ deck: DECK, cfg, latest });
    // Fresh game: A-1970 dealt as start card, deck order as passed.
    expect(latest.current!.list.map((s) => s.name)).toEqual(['A']);
  });
});