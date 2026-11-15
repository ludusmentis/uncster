/**
 * Correctness judgment (M007 / S01, T02).
 *
 * Pure, React-free judge for the drop mechanic: given a player's ordered
 * song list, a drop position, and the hidden song, decide whether dropping
 * the song at that position is chronologically correct based on release
 * year only.
 *
 * Rule: the list is ordered chronologically (ascending, oldest first).
 * A drop is correct when the candidate's release year fits between its
 * future neighbors: candidate.year >= year of the song before the drop
 * position AND candidate.year <= year of the song after the drop position.
 * Songs sharing the same release year may sit in any order among
 * themselves, so ties are inclusive (>= / <=, not strict).
 *
 * A song with an unknown release year (RELEASE_YEAR_PLACEHOLDER, i.e.
 * missing data) constrains nothing on the side(s) where it appears: the
 * judgment treats that neighbor edge as unconstrained. A candidate with an
 * unknown year is likewise always correct — it cannot be judged wrong for
 * ordering purposes.
 */

import { RELEASE_YEAR_PLACEHOLDER } from '../api/tracks';

export interface CorrectnessSong {
  name: string;
  /** Release year as a string ('1998') or the placeholder when unknown. */
  releaseYear: string;
}

function isKnown(year: string): boolean {
  return year !== RELEASE_YEAR_PLACEHOLDER;
}

function toComparable(year: string): number | null {
  if (!isKnown(year)) return null;
  const n = Number(year);
  return Number.isFinite(n) ? n : null;
}

/**
 * Judge whether dropping `candidate` at `dropIndex` in the player's ordered
 * list is chronologically correct. `dropIndex` is the position the song
 * will occupy in the resulting list (0..list.length inclusive). The input
 * list is not mutated.
 */
export function judgeDrop(
  list: CorrectnessSong[],
  dropIndex: number,
  candidate: CorrectnessSong,
): boolean {
  if (dropIndex < 0 || dropIndex > list.length) return false;

  const candidateYear = toComparable(candidate.releaseYear);

  // Unknown candidate year: ordering cannot be judged — accept.
  if (candidateYear === null) return true;

  const prev = dropIndex > 0 ? toComparable(list[dropIndex - 1].releaseYear) : null;
  const next = dropIndex < list.length ? toComparable(list[dropIndex].releaseYear) : null;

  // Same-year ties are correct in any arrangement, so constraints are inclusive.
  if (prev !== null && candidateYear < prev) return false;
  if (next !== null && candidateYear > next) return false;
  return true;
}
