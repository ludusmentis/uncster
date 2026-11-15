/**
 * Deck module (M007 / S01, T1).
 *
 * Pure, deterministic, React-free deck primitives for the game:
 * - createDeck: seeded shuffle (mulberry32 RNG + Fisher-Yates) so a given
 *   seed always yields the same deck order.
 * - drawNext: pops the top song; every song touched this draw (drawn or
 *   skipped) is appended to the bottom immediately, so the deck cycles
 *   forever instead of running out.
 * - Songs the current player already owns are skipped: the card still goes
 *   to the bottom, the draw continues with the next card.
 *
 * Track identity is keyed on `linked_from?.uri ?? uri` — the same
 * normalization the playing-track matching in src/pages/PlaylistTracks.tsx
 * uses, so a relinked variant URI still counts as the same song.
 */

import type { SpotifyTrack } from '../api/tracks';

/** A song card in the deck. */
export interface DeckSong {
  name: string;
  /** Spotify track URI (spotify:track:...). */
  uri?: string;
  /** Original URI when Spotify relinked the track to a variant URI. */
  linked_from?: { uri: string } | null;
}

export function songKey(song: DeckSong): string {
  return song.linked_from?.uri ?? song.uri ?? song.name;
}

/** mulberry32 — tiny, fast, deterministic seeded 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic seeded Fisher-Yates shuffle. The input array is copied;
 * the argument is never mutated. The same (tracks, seed) pair always
 * produces the same deck order.
 */
export function createDeck(tracks: SpotifyTrack[], seed: number): DeckSong[] {
  const rng = mulberry32(seed);
  const deck: DeckSong[] = tracks.map((t) => ({
    name: t.name,
    uri: t.uri,
    linked_from: (t as DeckSong).linked_from ?? null,
  }));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export interface DrawResult {
  /** The hidden song for this turn, or null when every card is owned. */
  song: DeckSong | null;
  /** Songs skipped this draw (owned by the current player), in draw order. */
  skipped: DeckSong[];
  /** The deck after the draw: top was popped, touched cards re-appended. */
  deck: DeckSong[];
}

/**
 * Draw the next deck song for the current player.
 *
 * - Pops the top song; if the player already owns it (its key is in
 *   ownedTrackKeys), it is appended to the bottom and the next card is
 *   drawn instead — repeated until a non-owned song appears.
 * - The drawn song is also appended to the bottom immediately, so the
 *   deck cycles (deck length is invariant).
 * - Returns { song: null } only when every remaining card is owned by the
 *   current player (guards the infinite-skip loop).
 */
export function drawNext(deck: DeckSong[], ownedTrackKeys: ReadonlySet<string>): DrawResult {
  const nextDeck = [...deck];
  const skipped: DeckSong[] = [];
  let song: DeckSong | null = null;
  const max = nextDeck.length; // every card owned ⇒ no draw possible
  for (let i = 0; i < max && nextDeck.length > 0; i += 1) {
    const top = nextDeck.shift() as DeckSong;
    if (ownedTrackKeys.has(songKey(top))) {
      nextDeck.push(top);
      skipped.push(top);
      continue;
    }
    nextDeck.push(top);
    song = top;
    break;
  }
  return { song, skipped, deck: nextDeck };
}