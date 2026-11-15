/**
 * Deck module tests (M007 / S01, T1): node-pure, fixture-driven vitest.
 * - createDeck: seeded determinism, same-seed equality, different-seed
 *   divergence, input non-mutation, empty-input.
 * - drawNext: pops the top, appends drawn/skipped to the bottom (cycling
 *   deck invariant), skips owned songs, guards all-owned decks.
 * - songKey normalization via linked_from ?? uri.
 * - Negative/boundary: empty deck, single-card deck, all-owned deck,
 *   missing-URI tracks fall back to name.
 */

import { describe, expect, it } from 'vitest';

import type { SpotifyTrack } from '../api/tracks';
import { createDeck, drawNext, songKey, type DeckSong } from './deck';

function track(name: string, uri?: string, linkedFrom?: string): SpotifyTrack {
  return {
    id: name,
    name,
    uri,
    artists: [{ id: 'a1', name: 'Artist' }],
    album: { images: [], release_date: '2000-01-01' },
    type: 'track',
    ...(linkedFrom !== undefined ? { linked_from: { uri: linkedFrom } } : {}),
  } as SpotifyTrack;
}

const FIXTURE: SpotifyTrack[] = [
  track('Song A', 'spotify:track:a'),
  track('Song B', 'spotify:track:b'),
  track('Song C', 'spotify:track:c'),
  track('Song D', 'spotify:track:d'),
];

describe('createDeck', () => {
  it('is deterministic for a given seed', () => {
    expect(createDeck(FIXTURE, 42)).toEqual(createDeck(FIXTURE, 42));
  });

  it('produces a permutation of the input tracks', () => {
    const deck = createDeck(FIXTURE, 42);
    expect(deck).toHaveLength(FIXTURE.length);
    expect(deck.map((s) => s.name).sort()).toEqual(['Song A', 'Song B', 'Song C', 'Song D']);
  });

  it('diverges across different seeds (at least one of several)', () => {
    // With 4 tracks the chance all tested seeds collide is 1/24^5 — negligible.
    const orders = new Set([7, 13, 99, 1234, 2026].map((s) => createDeck(FIXTURE, s).map((x) => x.name).join('|')));
    expect(orders.size).toBeGreaterThan(1);
  });

  it('does not mutate the input array', () => {
    const original = [...FIXTURE];
    createDeck(FIXTURE, 42);
    expect(FIXTURE).toEqual(original);
  });

  it('returns an empty deck for empty input', () => {
    expect(createDeck([], 42)).toEqual([]);
  });

  it('preserves linked_from on deck cards', () => {
    const relinked = track('Relinked', 'spotify:track:variant', 'spotify:track:original');
    const deck = createDeck([relinked], 42);
    expect(deck[0].linked_from?.uri).toBe('spotify:track:original');
  });
});

describe('drawNext', () => {
  it('pops the top song and appends it to the bottom (cycling deck)', () => {
    const deck = createDeck(FIXTURE, 42);
    const top = deck[0];
    const { song, deck: after } = drawNext(deck, new Set());
    expect(song).toEqual(top);
    expect(after).toHaveLength(deck.length);
    expect(after[after.length - 1]).toEqual(top);
    expect(after.slice(0, -1)).toEqual(deck.slice(1));
  });

  it('does not mutate the input deck', () => {
    const deck = createDeck(FIXTURE, 42);
    const snapshot = [...deck];
    drawNext(deck, new Set());
    expect(deck).toEqual(snapshot);
  });

  it('skips owned songs and appends them to the bottom in draw order', () => {
    const deck: DeckSong[] = [
      { name: 'A', uri: 'u:a' },
      { name: 'B', uri: 'u:b' },
      { name: 'C', uri: 'u:c' },
    ];
    const { song, skipped, deck: after } = drawNext(deck, new Set(['u:a', 'u:b']));
    expect(song?.uri).toBe('u:c');
    expect(skipped.map((s) => s.uri)).toEqual(['u:a', 'u:b']);
    expect(after).toEqual([
      { name: 'A', uri: 'u:a' },
      { name: 'B', uri: 'u:b' },
      { name: 'C', uri: 'u:c' },
    ]);
  });

  it('matches ownership via linked_from ?? uri normalization', () => {
    const deck: DeckSong[] = [
      { name: 'Relinked', uri: 'spotify:track:variant', linked_from: { uri: 'spotify:track:original' } },
      { name: 'Other', uri: 'u:other' },
    ];
    const { song } = drawNext(deck, new Set(['spotify:track:original']));
    expect(song?.uri).toBe('u:other');
  });

  it('returns null song when every card is owned (skip-loop guard)', () => {
    const deck: DeckSong[] = [
      { name: 'A', uri: 'u:a' },
      { name: 'B', uri: 'u:b' },
    ];
    const { song, skipped, deck: after } = drawNext(deck, new Set(['u:a', 'u:b']));
    expect(song).toBeNull();
    expect(skipped).toHaveLength(2);
    expect(after).toHaveLength(2);
    // All-owned decks cycle back to the same rotation, not an empty deck.
    expect(after.map((s) => s.uri)).toEqual(['u:a', 'u:b']);
  });

  it('returns null song for an empty deck without throwing', () => {
    const { song, skipped, deck } = drawNext([], new Set());
    expect(song).toBeNull();
    expect(skipped).toEqual([]);
    expect(deck).toEqual([]);
  });

  it('cycles a single-card deck forever (length invariant)', () => {
    const deck: DeckSong[] = [{ name: 'Only', uri: 'u:only' }];
    let current = deck;
    for (let i = 0; i < 5; i += 1) {
      const res = drawNext(current, new Set());
      expect(res.song?.uri).toBe('u:only');
      expect(res.deck).toHaveLength(1);
      current = res.deck;
    }
  });

  it('falls back to name when a track has no uri', () => {
    const deck: DeckSong[] = [{ name: 'NoURI' }, { name: 'HasURI', uri: 'u:x' }];
    const { song } = drawNext(deck, new Set(['NoURI']));
    expect(song?.uri).toBe('u:x');
  });
});

describe('songKey', () => {
  it('prefers linked_from.uri over uri', () => {
    expect(songKey({ name: 'x', uri: 'u:variant', linked_from: { uri: 'u:original' } })).toBe('u:original');
  });
  it('uses uri when linked_from is absent', () => {
    expect(songKey({ name: 'x', uri: 'u:plain' })).toBe('u:plain');
  });
  it('falls back to name when no uri exists', () => {
    expect(songKey({ name: 'Name Only' })).toBe('Name Only');
  });
});