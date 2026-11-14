/**
 * Period-balance math for the playlist assessment UI (D018/D019/D021).
 * Pure, deterministic functions — no React, no network.
 *
 * D018: balancedness = 0.5 × coverage + 0.5 × normalized Shannon entropy,
 * computed over decade bins of the playlist's release years.
 * D019: bins are whole calendar decades (1970s, 1980s, …) spanning the
 * min→max release year — NOT an equal-width 10-bin split.
 * D021: the combined warning is a WARN-ONLY signal — callers must never
 * use it to block the Start Game path. Combined warning fires when the
 * balancedness verdict is Bad or Fair, or the period-length verdict is Bad.
 * This is a reasonable interpretation of "badly balanced playlist" from
 * D021: the two factors carry the balance signal; a short period is the
 * strongest single indicator that a game will feel samey, so it forces a
 * warning, while an otherwise Excellent/Good balance on a short period
 * still warns via the period factor alone.
 */

import { releaseYear, RELEASE_YEAR_PLACEHOLDER, type SpotifyTrackItem } from '../api/tracks';

export interface DecadeBin {
  startYear: number;
  endYear: number;
  count: number;
}

export type Verdict = 'Excellent' | 'Good' | 'Fair' | 'Bad';

export interface Assessment {
  /** false when no parseable release years exist — all metrics then undefined. */
  available: boolean;
  minYear?: number;
  maxYear?: number;
  spanYears?: number;
  bins?: DecadeBin[];
  /** non-empty bins / total bins */
  coverage?: number;
  /** H / ln(numBins); 1.0 when there is exactly one bin */
  normalizedEntropy?: number;
  /** 0.5 × coverage + 0.5 × normalizedEntropy (D018) */
  balancedness?: number;
  balancednessVerdict?: Verdict;
  periodLengthVerdict?: Verdict;
  /** true when the combined warning fires (D021: warn only, never block) */
  warnBadlyBalanced?: boolean;
}

function parseYear(item: SpotifyTrackItem): number | null {
  const raw = releaseYear(item);
  if (raw === RELEASE_YEAR_PLACEHOLDER) {
    return null;
  }
  const year = Number.parseInt(raw, 10);
  return Number.isFinite(year) ? year : null;
}

function decadeStart(year: number): number {
  return year - (year % 10);
}

export function buildDecadeHistogram(items: SpotifyTrackItem[]): DecadeBin[] {
  const years = items
    .map(parseYear)
    .filter((y): y is number => y !== null)
    .sort((a, b) => a - b);
  if (years.length === 0) {
    return [];
  }
  const minDecade = decadeStart(years[0]);
  const maxDecade = decadeStart(years[years.length - 1]);
  const bins: DecadeBin[] = [];
  for (let start = minDecade; start <= maxDecade; start += 10) {
    bins.push({ startYear: start, endYear: start + 9, count: 0 });
  }
  for (const year of years) {
    bins[(decadeStart(year) - minDecade) / 10].count += 1;
  }
  return bins;
}

function balancednessVerdict(score: number): Verdict {
  if (score >= 0.8) return 'Excellent';
  if (score >= 0.6) return 'Good';
  if (score >= 0.4) return 'Fair';
  return 'Bad';
}

function periodLengthVerdict(span: number): Verdict {
  if (span >= 80) return 'Excellent';
  if (span >= 60) return 'Good';
  if (span > 40) return 'Fair';
  return 'Bad';
}

export function assessPeriod(items: SpotifyTrackItem[]): Assessment {
  const bins = buildDecadeHistogram(items);
  if (bins.length === 0) {
    return { available: false };
  }
  // Track-level min/max — span = maxYear−minYear over actual release years,
  // not decade boundaries (per slice plan).
  const years = items.map(parseYear).filter((y): y is number => y !== null);
  const trackMin = Math.min(...years);
  const trackMax = Math.max(...years);
  const spanYears = trackMax - trackMin;

  const numBins = bins.length;
  const total = bins.reduce((sum, b) => sum + b.count, 0);
  const nonEmpty = bins.filter((b) => b.count > 0).length;
  const coverage = nonEmpty / numBins;

  let entropy = 0;
  for (const bin of bins) {
    if (bin.count > 0) {
      const p = bin.count / total;
      entropy -= p * Math.log(p);
    }
  }
  const normalizedEntropy = numBins === 1 ? 1 : entropy / Math.log(numBins);
  const balancedness = 0.5 * coverage + 0.5 * normalizedEntropy;

  const bVerdict = balancednessVerdict(balancedness);
  const pVerdict = periodLengthVerdict(spanYears);
  const warnBadlyBalanced = bVerdict === 'Bad' || bVerdict === 'Fair' || pVerdict === 'Bad';

  return {
    available: true,
    minYear: trackMin,
    maxYear: trackMax,
    spanYears,
    bins,
    coverage,
    normalizedEntropy,
    balancedness,
    balancednessVerdict: bVerdict,
    periodLengthVerdict: pVerdict,
    warnBadlyBalanced,
  };
}
