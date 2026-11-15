import { describe, expect, it } from 'vitest';
import { judgeDrop, type CorrectnessSong } from './correctness';
import { RELEASE_YEAR_PLACEHOLDER } from '../api/tracks';

const song = (name: string, releaseYear: string): CorrectnessSong => ({ name, releaseYear });

// A representative chronological list: 1969, 1984, 1991, 1994.
const LIST = [
  song('a', '1969'),
  song('b', '1984'),
  song('c', '1991'),
  song('d', '1994'),
];

describe('judgeDrop', () => {
  it('accepts a correct ascending drop between different years', () => {
    // 1988 fits between 1984 and 1991.
    expect(judgeDrop(LIST, 2, song('x', '1988'))).toBe(true);
  });

  it('accepts drops at the extremes (front and back)', () => {
    expect(judgeDrop(LIST, 0, song('x', '1960'))).toBe(true);
    expect(judgeDrop(LIST, LIST.length, song('x', '2001'))).toBe(true);
  });

  it('rejects a wrong drop that breaks ascending order', () => {
    // 1970 after 1984 (index 2 sits between 1984 and 1991).
    expect(judgeDrop(LIST, 2, song('x', '1970'))).toBe(false);
    // 1995 before 1994 at the front.
    expect(judgeDrop(LIST, 0, song('x', '1995'))).toBe(false);
    // 1990 past the end (after 1994).
    expect(judgeDrop(LIST, LIST.length, song('x', '1990'))).toBe(false);
  });

  it('allows any arrangement among same-year ties (inclusive constraints)', () => {
    // List with two 1991 songs in swapped order — both arrangements are valid.
    const tieList = [
      song('a', '1969'),
      song('c2', '1991'),
      song('c', '1991'),
      song('d', '1994'),
    ];
    // Dropping another 1991 anywhere among the 1991 block is correct.
    expect(judgeDrop(tieList, 1, song('x', '1991'))).toBe(true);
    expect(judgeDrop(tieList, 3, song('x', '1991'))).toBe(true);
    // Same-year candidate adjacent to a same-year neighbor is fine.
    expect(judgeDrop([song('c', '1991')], 0, song('x', '1991'))).toBe(true);
    // Equal to neighbors on both sides: accepted, not rejected as strictness would.
    expect(judgeDrop([song('c', '1991'), song('d', '1994')], 1, song('x', '1991'))).toBe(true);
  });

  it('rejects same-year tie placements that break order across different years', () => {
    // A 1984 song dropped between 1991 and 1994 is still wrong even though
    // ties elsewhere are flexible.
    expect(judgeDrop(LIST, 3, song('x', '1984'))).toBe(false);
  });

  it('treats unknown release years as unconstrained on either side', () => {
    const list = [song('a', '1969'), song('?', RELEASE_YEAR_PLACEHOLDER), song('d', '1994')];
    // Neighbor unknown -> that edge imposes no constraint.
    expect(judgeDrop(list, 1, song('x', '1980'))).toBe(true);
    expect(judgeDrop(list, 1, song('x', '2000'))).toBe(true);
    // Candidate year unknown -> always accepted.
    expect(judgeDrop(LIST, 2, song('x', RELEASE_YEAR_PLACEHOLDER))).toBe(true);
    expect(judgeDrop(LIST, 3, song('x', RELEASE_YEAR_PLACEHOLDER))).toBe(true);
  });

  it('rejects out-of-range drop indices', () => {
    expect(judgeDrop(LIST, -1, song('x', '1988'))).toBe(false);
    expect(judgeDrop(LIST, LIST.length + 1, song('x', '1988'))).toBe(false);
    expect(judgeDrop(LIST, 5, song('x', '1988'))).toBe(false);
  });

  it('works on an empty list (any candidate fits)', () => {
    expect(judgeDrop([], 0, song('x', '1991')).toString()).toBe('true');
    expect(judgeDrop([], 0, song('x', RELEASE_YEAR_PLACEHOLDER)).toString()).toBe('true');
    expect(judgeDrop([], 1, song('x', '1991')).toString()).toBe('false');
  });
});
