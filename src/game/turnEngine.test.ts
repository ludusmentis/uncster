/**
 * Turn engine tests (M007 / S01, T03).
 *
 * Fixture-driven vitest suite proving the pure turn state machine:
 * rotation in creation order, start-card dealing, hidden draw with
 * owned-song skip, correct/wrong drops, win detection, winner removal
 * from rotation, and game-over when all players have won. All transitions
 * are pure — input states are frozen and asserted unmutated.
 */

import { describe, expect, it } from 'vitest';
import {
  createTurnState,
  drawHidden,
  drop,
  resolveTurn,
  startTurn,
  type TurnPlayer,
  type TurnSong,
  type TurnState,
} from './turnEngine';

/** A song fixture: years distinct for clear ordering. */
function song(name: string, releaseYear: string): TurnSong {
  return { name, uri: `spotify:track:${name}`, releaseYear };
}

function player(id: string, songs: TurnSong[] = []): TurnPlayer {
  return { id, name: `Player ${id}`, songs };
}

/** A small deck where top-of-deck order is exactly the array order. */
const deck = (): TurnSong[] => [
  song('A-1990', '1990'),
  song('B-2000', '2000'),
  song('C-1995', '1995'),
  song('D-2010', '2010'),
  song('E-1985', '1985'),
];

/** Freeze a state deeply so accidental mutation throws in strict mode. */
function frozen(state: TurnState): TurnState {
  return {
    ...state,
    players: state.players.map((p) =>
      Object.freeze({ ...p, songs: Object.freeze([...p.songs]) as TurnSong[] }),
    ),
    deck: Object.freeze([...state.deck]) as TurnSong[],
    winners: Object.freeze([...state.winners]) as string[],
  };
}

/** Advance one full turn: start → draw → drop → resolve. */
function takeTurn(state: TurnState, dropIndex: number): TurnState {
  let s = startTurn(state);
  s = drawHidden(s);
  s = drop(s, dropIndex);
  return resolveTurn(s);
}

describe('createTurnState', () => {
  it('creates initial state for players in creation order', () => {
    const s = createTurnState([player('p1'), player('p2')], deck(), 3);
    expect(s.currentIndex).toBe(0);
    expect(s.phase).toBe('start-card');
    expect(s.winners).toEqual([]);
    expect(s.finished).toBe(false);
    expect(s.hiddenSong).toBeNull();
  });

  it('rejects empty players, empty deck, and songsToWin < 1', () => {
    expect(() => createTurnState([], deck(), 3)).toThrow();
    expect(() => createTurnState([player('p1')], [], 3)).toThrow();
    expect(() => createTurnState([player('p1')], deck(), 0)).toThrow();
  });

  it('does not mutate its inputs', () => {
    const players = [player('p1')];
    const d = deck();
    createTurnState(players, d, 2);
    expect(players[0].songs).toEqual([]);
    expect(d.map((s) => s.name)).toEqual(['A-1990', 'B-2000', 'C-1995', 'D-2010', 'E-1985']);
  });
});

describe('startTurn (start card)', () => {
  it("deals the player's first card free and returns it to the deck bottom", () => {
    const s = createTurnState([player('p1')], deck(), 3);
    const after = startTurn(s);
    expect(after.players[0].songs.map((x) => x.name)).toEqual(['A-1990']);
    // deck cycled: top popped and re-appended at bottom
    expect(after.deck.map((x) => x.name)).toEqual(['B-2000', 'C-1995', 'D-2010', 'E-1985', 'A-1990']);
    expect(after.phase).toBe('draw-hidden');
    expect(after.hiddenSong).toBeNull();
  });

  it('skips the start card when the list is not empty', () => {
    const s = createTurnState([player('p1', [song('X-1970', '1970')])], deck(), 3);
    const after = startTurn(s);
    expect(after.players[0].songs.map((x) => x.name)).toEqual(['X-1970']);
    expect(after.deck.map((x) => x.name)).toEqual(deck().map((x) => x.name));
    expect(after.phase).toBe('draw-hidden');
  });

  it('rejects a phase other than start-card', () => {
    const s = createTurnState([player('p1')], deck(), 3);
    expect(() => startTurn(startTurn(s))).toThrow(/start-card/);
  });

  it('is pure: does not mutate the input state', () => {
    const s = frozen(createTurnState([player('p1')], deck(), 3));
    const after = startTurn(s);
    expect(s.players[0].songs).toEqual([]);
    expect(s.phase).toBe('start-card');
    expect(after.players[0].songs.map((x) => x.name)).toEqual(['A-1990']);
  });
});

describe('drawHidden', () => {
  it('draws the top song as the hidden song and cycles it to the bottom', () => {
    const s0 = createTurnState([player('p1', [song('A-1990', '1990')])], deck(), 3);
    const s = drawHidden(startTurn(s0));
    // A-1990 is owned, so it was skipped (to the bottom); B-2000 is drawn
    expect(s.hiddenSong?.name).toBe('B-2000');
    expect(s.deck.map((x) => x.name)).toEqual([
      'C-1995', 'D-2010', 'E-1985', 'A-1990', 'B-2000',
    ]);
    expect(s.phase).toBe('awaiting-drop');
  });

  it('fails the turn when the player owns every card', () => {
    const d = [song('A-1990', '1990'), song('B-2000', '2000')];
    const s0 = createTurnState([player('p1', d)], d, 3);
    const s = drawHidden(startTurn(s0));
    expect(s.hiddenSong).toBeNull();
    expect(s.phase).toBe('reveal-fail');
  });

  it('rejects a phase other than draw-hidden', () => {
    const s = createTurnState([player('p1')], deck(), 3);
    expect(() => drawHidden(s)).toThrow(/draw-hidden/);
  });
});

describe('drop', () => {
  it('accepts a chronologically correct drop and inserts the song', () => {
    // list [1995], hidden A-1990 (deck top, start card skipped) -> correct at index 0
    const s0 = createTurnState([player('p1', [song('C-1995', '1995')])], deck(), 3);
    let s = startTurn(s0);
    s = drawHidden(s);
    expect(s.hiddenSong?.name).toBe('A-1990');
    s = drop(s, 0); // 1990 before 1995 -> correct
    expect(s.phase).toBe('reveal-success');
    expect(s.players[0].songs.map((x) => x.name)).toEqual(['A-1990', 'C-1995']);
  });

  it('rejects a chronologically wrong drop without inserting', () => {
    // list [2000], hidden A-1990 dropped AFTER it -> wrong
    const s0 = createTurnState([player('p1', [song('B-2000', '2000')])], deck(), 3);
    let s = startTurn(s0);
    s = drawHidden(s);
    expect(s.hiddenSong?.name).toBe('A-1990');
    s = drop(s, 1); // 1990 after 2000 -> wrong
    expect(s.phase).toBe('reveal-fail');
    expect(s.players[0].songs.map((x) => x.name)).toEqual(['B-2000']);
  });

  it('rejects a phase other than awaiting-drop', () => {
    const s = createTurnState([player('p1')], deck(), 3);
    expect(() => drop(s, 0)).toThrow(/awaiting-drop/);
  });
});

describe('resolveTurn: rotation and winner removal', () => {
  it('rotates players strictly in creation order', () => {
    const s0 = createTurnState([player('p1'), player('p2'), player('p3')], deck(), 3);
    const s1 = takeTurn(s0, 1); // p1 turn (start card A-1990, drop B-2000)
    expect(s1.currentIndex).toBe(1);
    const s2 = takeTurn(s1, 1);
    expect(s2.currentIndex).toBe(2);
    const s3 = takeTurn(s2, 1);
    expect(s3.currentIndex).toBe(0);
  });

  it('removes a winner from the rotation and skips them', () => {
    const s0 = createTurnState(
      [player('p1', [song('Z-1970', '1970'), song('Y-1980', '1980')]), player('p2')],
      deck(),
      3,
    );
    // p1's start card skipped (list non-empty); draws B-2000 and drops correctly -> 3 songs -> wins
    const s1 = takeTurn(s0, 2);
    expect(s1.winners).toEqual(['p1']);
    // p2 next, not p1
    expect(s1.currentIndex).toBe(1);
    // p2's turn resolves back to p2 (only active player)
    const s2 = takeTurn(s1, 1);
    expect(s2.currentIndex).toBe(1);
    expect(s2.winners).toEqual(['p1']);
  });

  it('ends the game when every player has won', () => {
    // single player, songsToWin 1: wrong drop then correct drop ends it
    const s0 = createTurnState([player('p1', [])], deck(), 1);
    let s = startTurn(s0); // start card A-1990
    s = drawHidden(s); // hidden B-2000 (A owned, skipped)
    s = drop(s, 0); // 2000 before 1990 -> wrong
    s = resolveTurn(s);
    expect(s.phase).toBe('start-card');
    expect(s.winners).toEqual([]);
    s = takeTurn(s, 1); // C-1995 after 1990 -> correct -> len 2 >= 1 -> win
    expect(s.winners).toEqual(['p1']);
    expect(s.phase).toBe('game-over');
    expect(s.finished).toBe(true);
    expect(s.hiddenSong).toBeNull();
  });

  it('skips winners when advancing rotation mid-game', () => {
    // Deck [A1990, B2000, C1995, D2010, E1985]; songsToWin 2.
    // Turn 1 (p1): start card A-1990, hidden B-2000 dropped after it ->
    // correct -> 2 songs -> p1 wins. Rotation skips p1 to p2.
    // Turn 2 (p2, owns Y-1980): hidden C-1995 dropped after Y-1980 ->
    // correct -> 2 songs -> p2 wins. Rotation skips p1 and p2 to p3.
    // Turn 3 (p3): start card D-2010, hidden E-1985 dropped before it ->
    // correct -> 2 songs -> p3 wins -> game over.
    const s0 = createTurnState(
      [player('p1'), player('p2', [song('Y-1980', '1980')]), player('p3')],
      deck(),
      2,
    );
    const s1 = takeTurn(s0, 1); // p1 turn
    expect(s1.winners).toEqual(['p1']);
    expect(s1.currentIndex).toBe(1); // p2
    const s2 = takeTurn(s1, 1); // p2 turn
    expect(s2.winners).toEqual(['p1', 'p2']);
    expect(s2.currentIndex).toBe(2); // p3 (p1 and p2 skipped)
    const s3 = takeTurn(s2, 0); // p3 turn
    expect(s3.winners).toEqual(['p1', 'p2', 'p3']);
    expect(s3.phase).toBe('game-over');
    expect(s3.finished).toBe(true);
    // Winners keep their lists.
    expect(s3.players[0].songs.map((x) => x.name)).toEqual(['A-1990', 'B-2000']);
    expect(s3.players[1].songs.map((x) => x.name)).toEqual(['Y-1980', 'C-1995']);
    expect(s3.players[2].songs.map((x) => x.name)).toEqual(['E-1985', 'D-2010']);
  });
});

describe('immutability across a full machine run', () => {
  it('never mutates prior states while playing a game to completion', () => {
    const s0 = frozen(createTurnState([player('p1'), player('p2')], deck(), 2));
    const snapshots: TurnState[] = [s0];
    let s = s0;
    // Play until finished; cap turns to avoid an infinite loop on a bug.
    for (let i = 0; i < 40 && !s.finished; i += 1) {
      s = startTurn(s);
      s = drawHidden(s);
      if (!s.hiddenSong) {
        s = resolveTurn(s);
        continue;
      }
      // Greedy strategy: try the correct position if one exists.
      const list = s.players[s.currentIndex].songs;
      const year = Number(s.hiddenSong.releaseYear);
      let idx = list.length;
      for (let j = 0; j <= list.length; j += 1) {
        const prev = j > 0 ? Number(list[j - 1].releaseYear) : -Infinity;
        const next = j < list.length ? Number(list[j].releaseYear) : Infinity;
        if (year >= prev && year <= next) {
          idx = j;
          break;
        }
      }
      s = drop(s, idx);
      s = resolveTurn(s);
      snapshots.push(s);
    }
    expect(s.finished).toBe(true);
    expect(s.winners.sort()).toEqual(['p1', 'p2']);
    // First snapshot untouched throughout.
    expect(s0.players[0].songs).toEqual([]);
    expect(s0.phase).toBe('start-card');
    expect(s0.winners).toEqual([]);
    expect(snapshots.length).toBeGreaterThan(2);
  });
});

describe('same-year ties', () => {
  it('counts any same-year arrangement as correct', () => {
    const d = [song('T1-1999', '1999'), song('T2-1999', '1999'), song('T3-1999', '1999')];
    const s0 = createTurnState([player('p1', [song('T1-1999', '1999')])], d, 3);
    let s = startTurn(s0);
    s = drawHidden(s); // T2-1999 (T1 owned, skipped)
    s = drop(s, 0); // same-year drop before T1 -> correct
    expect(s.phase).toBe('reveal-success');
    expect(s.players[0].songs.map((x) => x.name)).toEqual(['T2-1999', 'T1-1999']);
  });
});