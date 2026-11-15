/**
 * Turn state machine (M007 / S01, T03).
 *
 * Pure, React-free, reducer-style turn engine for the game:
 * - Players rotate strictly in creation order; winners leave the rotation.
 * - Start card: on a player's first turn (empty list) they draw the next
 *   deck song into their list for free — the card is returned to the deck
 *   bottom like any draw, so the deck cycles forever.
 * - Each turn then draws one hidden song (drawNext skips songs the player
 *   already owns) and awaits a drop.
 * - A drop is judged with judgeDrop (release-year ordering, same-year
 *   ties inclusive). Correct: the song joins the list. Wrong: the song is
 *   lost (it already returned to the deck bottom at draw time).
 * - A player wins when their list reaches `songsToWin`; winners leave
 *   rotation; the game ends when every player has won.
 *
 * Every transition is a pure function returning a new immutable state; the
 * input state is never mutated. The whole machine is unit-testable with
 * fixtures.
 */

import { RELEASE_YEAR_PLACEHOLDER } from '../api/tracks';
import { drawNext, songKey, type DeckSong } from './deck';
import { judgeDrop } from './correctness';

export type TurnPhase =
  | 'start-card' // start of a turn; start card dealt if the player's list is empty
  | 'draw-hidden' // the turn's hidden song is about to be drawn
  | 'awaiting-drop' // hidden song drawn; player picks a drop position
  | 'reveal-success' // drop was chronologically correct
  | 'reveal-fail' // drop was wrong (or no drawable card); the song is lost
  | 'game-over'; // every player has won

/** A deck song carrying its release year for drop judgment. */
export interface TurnSong extends DeckSong {
  /** Release year as a string ('1998'), or missing when unknown. */
  releaseYear?: string;
  /** Artist name(s) joined with ', ' (from track.artists), or missing when unknown. */
  artist?: string;
  /** Cover art URL (first album image), or missing when the track has no image. */
  coverUrl?: string;
}

export interface TurnPlayer {
  id: string;
  name: string;
  /** The player's chronologically ordered list of won songs. */
  songs: TurnSong[];
}

export interface TurnState {
  /** Players in creation order; rotation follows this order. */
  players: TurnPlayer[];
  /** Cycling deck (top = index 0). */
  deck: TurnSong[];
  /** Index into `players` of the player whose turn it is. */
  currentIndex: number;
  /** Current turn phase. */
  phase: TurnPhase;
  /** The hidden song for this turn, or null outside awaiting/reveal. */
  hiddenSong: TurnSong | null;
  /** Player ids that have won, in win order. */
  winners: string[];
  /** Songs a player must hold to win. */
  songsToWin: number;
  /** True once every player has won. */
  finished: boolean;
}

/**
 * Build a fresh game state. Players are given in creation order and start
 * with empty lists (their start card is dealt on their first turn).
 */
export function createTurnState(
  players: TurnPlayer[],
  deck: TurnSong[],
  songsToWin: number,
): TurnState {
  if (players.length === 0) throw new Error('createTurnState: at least one player required');
  if (songsToWin < 1) throw new Error('createTurnState: songsToWin must be >= 1');
  if (deck.length === 0) throw new Error('createTurnState: deck must not be empty');
  return {
    players: players.map((p) => ({ ...p, songs: [...p.songs] })),
    deck: [...deck],
    currentIndex: 0,
    phase: 'start-card',
    hiddenSong: null,
    winners: [],
    songsToWin,
    finished: false,
  };
}

/** A player is active while they are in the rotation (not a winner). */
function isActive(winners: readonly string[], player: TurnPlayer): boolean {
  return !winners.includes(player.id);
}

/** The next active player index after `from`, in creation order. */
function nextActiveIndex(
  players: readonly TurnPlayer[],
  winners: readonly string[],
  from: number,
): number {
  for (let step = 1; step <= players.length; step += 1) {
    const idx = (from + step) % players.length;
    if (isActive(winners, players[idx])) return idx;
  }
  return from;
}

/** A song's release year, or the unknown placeholder when missing. */
function yearOf(song: TurnSong): string {
  return song.releaseYear ?? RELEASE_YEAR_PLACEHOLDER;
}

/**
 * Begin the current player's turn (phase 'start-card'):
 * - If the player's list is empty (first turn), deal their start card:
 *   draw the next deck song and place it in their list, free. The card
 *   is returned to the deck bottom like any draw.
 * - Either way, the turn moves to 'draw-hidden'.
 */
export function startTurn(state: TurnState): TurnState {
  if (state.phase !== 'start-card') {
    throw new Error(`startTurn: expected phase 'start-card', got '${state.phase}'`);
  }
  const player = state.players[state.currentIndex];
  let deck = [...state.deck];
  let songs = [...player.songs];
  if (songs.length === 0) {
    const { song, deck: nextDeck } = drawNext(deck, new Set());
    deck = nextDeck;
    if (song) songs = [song as TurnSong];
  }
  return {
    ...state,
    deck,
    players: state.players.map((p) => (p.id === player.id ? { ...p, songs } : p)),
    phase: 'draw-hidden',
    hiddenSong: null,
  };
}

/**
 * Draw this turn's hidden song (phase 'draw-hidden' → 'awaiting-drop').
 * Songs the player already owns are skipped (returned to the deck bottom).
 * The drawn song is also appended to the deck bottom immediately, so the
 * deck length never changes; a "lost" drop simply means the card cycles
 * back around. If every card is owned by this player, the turn fails with
 * no hidden song.
 */
export function drawHidden(state: TurnState): TurnState {
  if (state.phase !== 'draw-hidden') {
    throw new Error(`drawHidden: expected phase 'draw-hidden', got '${state.phase}'`);
  }
  const player = state.players[state.currentIndex];
  const owned = new Set(player.songs.map(songKey));
  const { song, deck } = drawNext(state.deck, owned);
  if (!song) {
    return { ...state, deck, hiddenSong: null, phase: 'reveal-fail' };
  }
  return { ...state, deck, hiddenSong: song as TurnSong, phase: 'awaiting-drop' };
}

/**
 * Drop the hidden song at `dropIndex` in the current player's list
 * (phase 'awaiting-drop' → 'reveal-success' | 'reveal-fail').
 *
 * A chronologically correct drop (judgeDrop) joins the player's list; a
 * wrong drop loses the song — it is NOT added (it already sits at the deck
 * bottom from the draw, so it cycles back around).
 */
export function drop(state: TurnState, dropIndex: number): TurnState {
  if (state.phase !== 'awaiting-drop' || !state.hiddenSong) {
    throw new Error(`drop: expected phase 'awaiting-drop', got '${state.phase}'`);
  }
  const player = state.players[state.currentIndex];
  const song = state.hiddenSong;
  const correct = judgeDrop(
    player.songs.map((s) => ({ name: s.name, releaseYear: yearOf(s) })),
    dropIndex,
    { name: song.name, releaseYear: yearOf(song) },
  );
  if (!correct) return { ...state, phase: 'reveal-fail' };
  const songs = [...player.songs];
  songs.splice(dropIndex, 0, song);
  return {
    ...state,
    players: state.players.map((p) => (p.id === player.id ? { ...p, songs } : p)),
    phase: 'reveal-success',
  };
}

/**
 * Resolve the reveal (phase 'reveal-success' | 'reveal-fail'):
 * - On success, a win check runs: list length >= songsToWin makes the
 *   player a winner and removes them from the rotation.
 * - When every player has won, the game is over ('game-over').
 * - Otherwise the rotation advances to the next active player in
 *   creation order and the next turn starts ('start-card').
 */
export function resolveTurn(state: TurnState): TurnState {
  if (state.phase !== 'reveal-success' && state.phase !== 'reveal-fail') {
    throw new Error(`resolveTurn: expected a reveal phase, got '${state.phase}'`);
  }
  const player = state.players[state.currentIndex];
  let winners = state.winners;
  if (state.phase === 'reveal-success' && player.songs.length >= state.songsToWin) {
    winners = [...state.winners, player.id];
  }
  if (winners.length === state.players.length) {
    return { ...state, winners, hiddenSong: null, phase: 'game-over', finished: true };
  }
  const currentIndex = nextActiveIndex(state.players, winners, state.currentIndex);
  return {
    ...state,
    winners,
    currentIndex,
    hiddenSong: null,
    phase: 'start-card',
  };
}