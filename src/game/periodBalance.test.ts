/**
 * Contract tests for the pure period-balance math (S02-T1) — node-pure vitest.
 * D018 balancedness formula, D019 whole-calendar-decade bins, D021 warn-only signal.
 */

import { describe, expect, it } from 'vitest';
import type { SpotifyTrackItem } from '../api/tracks';
import { assessPeriod, buildDecadeHistogram } from './periodBalance';

function makeItem(releaseDate: string | null): SpotifyTrackItem {
  return {
    item: {
      id: `t-${releaseDate ?? 'none'}`,
      name: 'Track',
      artists: [{ id: 'a-1', name: 'Artist' }],
      album: {
        images: [],
        release_date: releaseDate ?? undefined,
      },
      type: 'track',
    },
  };
}

function unavailable(): SpotifyTrackItem {
  return { item: null };
}

/** n tracks spread evenly over the given years, cycling through `years`. */
function spread(countsByYear: Array<[year: number, count: number]>): SpotifyTrackItem[] {
  const items: SpotifyTrackItem[] = [];
  for (const [year, count] of countsByYear) {
    for (let i = 0; i < count; i += 1) {
      items.push(makeItem(String(year)));
    }
  }
  return items;
}

describe('buildDecadeHistogram', () => {
  it('uses whole calendar decade bins spanning min→max release year (D019)', () => {
    const items = spread([
      [1965, 1],
      [1972, 1],
      [2003, 1],
    ]);
    const bins = buildDecadeHistogram(items);
    expect(bins).toEqual([
      { startYear: 1960, endYear: 1969, count: 1 },
      { startYear: 1970, endYear: 1979, count: 1 },
      { startYear: 1980, endYear: 1989, count: 0 },
      { startYear: 1990, endYear: 1999, count: 0 },
      { startYear: 2000, endYear: 2009, count: 1 },
    ]);
  });

  it('produces a single bin when min and max fall in the same decade', () => {
    const bins = buildDecadeHistogram(spread([[1971, 1], [1979, 1]]));
    expect(bins).toEqual([{ startYear: 1970, endYear: 1979, count: 2 }]);
  });

  it('excludes items whose releaseYear is the placeholder (null item, missing date)', () => {
    const bins = buildDecadeHistogram([unavailable(), unavailable(), makeItem(''), makeItem('')]);
    expect(bins).toEqual([]);
  });

  it('mixes placeholder and dated items without affecting bin counts of dated tracks', () => {
    const bins = buildDecadeHistogram([
      unavailable(),
      ...spread([[1984, 2]]),
      makeItem(''),
      unavailable(),
    ]);
    expect(bins).toEqual([{ startYear: 1980, endYear: 1989, count: 2 }]);
  });

  it('returns an empty array for empty input', () => {
    expect(buildDecadeHistogram([])).toEqual([]);
  });
});

describe('assessPeriod', () => {
  it('reports unavailable for empty input', () => {
    expect(assessPeriod([])).toEqual({ available: false });
  });

  it('reports unavailable when every year is missing (all placeholder)', () => {
    const items = [unavailable(), unavailable(), makeItem(''), makeItem('')];
    expect(assessPeriod(items)).toEqual({ available: false });
  });

  it('single-year playlist → one bin, coverage 1, balancedness 1.0 (Excellent)', () => {
    const a = assessPeriod(spread([[1994, 7]]));
    expect(a.available).toBe(true);
    expect(a.bins).toHaveLength(1);
    expect(a.coverage).toBe(1);
    expect(a.normalizedEntropy).toBe(1);
    expect(a.balancedness).toBe(1);
    expect(a.balancednessVerdict).toBe('Excellent');
    expect(a.spanYears).toBe(0);
    expect(a.periodLengthVerdict).toBe('Bad');
    // Period-length Bad carries the warning alone (D023): single-year playlists warn.
    expect(a.warnBadlyBalanced).toBe(true);
  });

  it('multi-decade even spread → high balancedness (Excellent)', () => {
    const a = assessPeriod(
      spread([
        [1945, 2], [1950, 2], [1955, 2],
        [1960, 2], [1965, 2],
        [1970, 2], [1975, 2],
        [1980, 2], [1985, 2],
        [1990, 2], [1995, 2],
        [2000, 2], [2005, 2],
      ]),
    );
    expect(a.coverage).toBe(1);
    // Near-uniform: counts are 2/4/4/4/4/4/4 per decade → entropy ≈ 0.989.
    expect(a.normalizedEntropy).toBeGreaterThan(0.95);
    expect(a.balancedness).toBeGreaterThan(0.8);
    expect(a.balancednessVerdict).toBe('Excellent');
    expect(a.spanYears).toBe(60);
    expect(a.periodLengthVerdict).toBe('Good');
    expect(a.warnBadlyBalanced).toBe(false);
  });

  it('tracks clustered in two decades far apart → low coverage (D018 coverage factor)', () => {
    // 1970s and 2010s non-empty; 1980s–2000s empty → coverage 2/5.
    const a = assessPeriod(spread([[1975, 5], [2015, 5]]));
    expect(a.coverage).toBeCloseTo(0.4, 6);
    expect(a.bins).toHaveLength(5);
    expect(a.balancedness).toBeCloseTo(0.5 * 0.4 + 0.5 * (Math.LN2 / Math.log(5)), 6);
  });

  it('single-decade playlist spans one bin but period verdict is Bad (D019/D021 interpretation)', () => {
    const a = assessPeriod(spread([[2001, 3], [2009, 3]]));
    expect(a.bins).toHaveLength(1);
    expect(a.balancednessVerdict).toBe('Excellent');
    expect(a.spanYears).toBe(8);
    expect(a.periodLengthVerdict).toBe('Bad');
    expect(a.warnBadlyBalanced).toBe(true);
  });

  it('skewed distribution → Bad balancedness and warning', () => {
    // 14 tracks in one year, 6 in another; 5 decade bins (1990s–2030s), only 2 non-empty.
    const a = assessPeriod(spread([[1995, 14], [2035, 6]]));
    // coverage 2/5, entropy over (0.7, 0.3) normalized by ln5.
    const entropy = -(0.7 * Math.log(0.7) + 0.3 * Math.log(0.3));
    expect(a.balancedness).toBeCloseTo(0.5 * 0.4 + 0.5 * (entropy / Math.log(5)), 6);
    expect(a.balancedness).toBeLessThan(0.4);
    expect(a.balancednessVerdict).toBe('Bad');
    expect(a.warnBadlyBalanced).toBe(true);
  });

  it('exposes minYear/maxYear over actual release years, not decade boundaries', () => {
    const a = assessPeriod(spread([[1971, 1], [1992, 1]]));
    expect(a.minYear).toBe(1971);
    expect(a.maxYear).toBe(1992);
    expect(a.spanYears).toBe(21);
  });

  describe('balancedness verdict thresholds (0.80 / 0.60 / 0.40)', () => {
    it('balancedness just below 0.80 → Good; at/above → Excellent', () => {
      // 4 decade bins, counts (15,3,1,1): b ≈ 0.7885 → Good
      const below = assessPeriod(spread([[1995, 15], [2005, 3], [2015, 1], [2025, 1]]));
      expect(below.balancedness!).toBeLessThan(0.8);
      expect(below.balancedness!).toBeGreaterThan(0.6);
      expect(below.balancednessVerdict).toBe('Good');

      // counts (14,4,1,1): b ≈ 0.8144 → Excellent
      const above = assessPeriod(spread([[1995, 14], [2005, 4], [2015, 1], [2025, 1]]));
      expect(above.balancedness!).toBeGreaterThan(0.8);
      expect(above.balancednessVerdict).toBe('Excellent');
    });

    it('balancedness just below 0.60 → Fair; at/above → Good', () => {
      // 4 decade bins, counts (95,2,2,1): b ≈ 0.5907 → Fair
      const below = assessPeriod(spread([[1995, 95], [2005, 2], [2015, 2], [2025, 1]]));
      expect(below.balancedness!).toBeLessThan(0.6);
      expect(below.balancedness!).toBeGreaterThan(0.4);
      expect(below.balancednessVerdict).toBe('Fair');

      // counts (47,1,1,1): b ≈ 0.6056 → Good
      const above = assessPeriod(spread([[1995, 47], [2005, 1], [2015, 1], [2025, 1]]));
      expect(above.balancedness!).toBeGreaterThan(0.6);
      expect(above.balancednessVerdict).toBe('Good');
    });

    it('balancedness just below 0.40 → Bad; just above → Fair', () => {
      // 5 decade bins (1990s–2030s), only 1990s & 2030s non-empty: counts (14,6).
      // coverage 2/5, entropy over (0.7, 0.3) normalized by ln5 → b ≈ 0.3898 → Bad.
      const below = assessPeriod(spread([[1995, 14], [2035, 6]]));
      expect(below.bins).toHaveLength(5);
      expect(below.coverage).toBeCloseTo(0.4, 6);
      const entropy = -(0.7 * Math.log(0.7) + 0.3 * Math.log(0.3));
      expect(below.balancedness).toBeCloseTo(0.5 * 0.4 + 0.5 * (entropy / Math.log(5)), 6);
      expect(below.balancedness!).toBeLessThan(0.4);
      expect(below.balancednessVerdict).toBe('Bad');

      // Same 5-decade span, counts (13,7): entropy over (0.65, 0.35) → b ≈ 0.4154 → Fair.
      const above = assessPeriod(spread([[1995, 13], [2035, 7]]));
      expect(above.bins).toHaveLength(5);
      expect(above.balancedness!).toBeGreaterThan(0.4);
      expect(above.balancedness!).toBeLessThan(0.6);
      expect(above.balancednessVerdict).toBe('Fair');
    });
  });

  describe('period-length verdict thresholds (80 / 60 / 40 years span)', () => {
    const span = (min: number, max: number) =>
      assessPeriod(spread([[min, 1], [max, 1]])).periodLengthVerdict;

    it('span 80 → Excellent; span 79 → Good', () => {
      expect(span(1920, 2000)).toBe('Excellent');
      expect(span(1921, 2000)).toBe('Good');
    });

    it('span 60 → Good; span 59 → Fair', () => {
      expect(span(1940, 2000)).toBe('Good');
      expect(span(1941, 2000)).toBe('Fair');
    });

    it('span 41 → Fair; span 40 → Bad', () => {
      expect(span(1959, 2000)).toBe('Fair');
      expect(span(1960, 2000)).toBe('Bad');
    });
  });

  it('warning fires on Bad balancedness even with an Excellent period', () => {
    // Heavily skewed across a long span → period Excellent, balance Bad → still warns.
    const a = assessPeriod(spread([[1920, 47], [1935, 1], [1955, 1], [2000, 1]]));
    expect(a.periodLengthVerdict).toBe('Excellent');
    expect(a.balancednessVerdict).toBe('Bad');
    expect(a.warnBadlyBalanced).toBe(true);
  });

  it('warning fires on Bad period even with Excellent balancedness (D021 interpretation)', () => {
    const a = assessPeriod(spread([[2001, 3], [2005, 3], [2009, 3]]));
    expect(a.balancednessVerdict).toBe('Excellent');
    expect(a.periodLengthVerdict).toBe('Bad');
    expect(a.warnBadlyBalanced).toBe(true);
  });

  it('no warning for Good-or-better balance and Fair-or-better period', () => {
    const a = assessPeriod(
      spread([
        [1945, 3], [1950, 3],
        [1955, 3], [1960, 3],
        [1965, 3], [1970, 3],
        [1975, 3], [1980, 3],
        [1985, 3], [1990, 3],
        [1995, 3], [2005, 3],
      ]),
    );
    expect(a.balancednessVerdict).toBe('Excellent');
    expect(a.periodLengthVerdict).toBe('Good');
    expect(a.warnBadlyBalanced).toBe(false);
  });
});
