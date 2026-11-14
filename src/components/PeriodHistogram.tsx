/**
 * Period histogram + two-factor balance assessment for the playlist view
 * (M006 / S02-T2, D018/D019/D020/D021).
 *
 * Presentational: pure props in, pure math out — all computation lives in
 * src/game/periodBalance.ts (assessPeriod). Renders a hand-rolled CSS bar
 * histogram (one bar per decade bin, D019), the period-length and
 * balancedness verdicts (D018), and — when the combined warning fires —
 * a role="alert" warning banner using the existing .alert--warning
 * language (non-blocking amber-cyan advisory, precedent: GameSetup).
 *
 * Warn only, never block (D021): this component renders information; the
 * Start Game path stays untouched.
 */

import { assessPeriod } from '../game/periodBalance';
import type { SpotifyTrackItem } from '../api/tracks';

function decadeLabel(startYear: number): string {
  return `${startYear}s`;
}

export default function PeriodHistogram({
  items,
}: {
  items: SpotifyTrackItem[];
}): JSX.Element {
  const assessment = assessPeriod(items);

  if (!assessment.available) {
    return (
      <section className="period-histogram period-histogram--unavailable">
        <p className="text-small">
          Assessment unavailable — not enough release-year data.
        </p>
      </section>
    );
  }

  const bins = assessment.bins ?? [];
  const maxCount = Math.max(...bins.map((b) => b.count), 1);

  return (
    <section
      className="period-histogram"
      aria-label="Release-year period balance"
    >
      <h2 className="text-small period-histogram-title">
        {`Release decades · ${assessment.minYear}–${assessment.maxYear} · ${assessment.spanYears} ${assessment.spanYears === 1 ? 'year' : 'years'}`}
      </h2>

      <div className="histogram" role="img" aria-label="Histogram of tracks per release decade">
        {bins.map((bin) => (
          <div className="histogram-bin" key={bin.startYear}>
            <span className="histogram-bin-count">{bin.count}</span>
            <div
              className="histogram-bar"
              style={{ height: `${Math.max((bin.count / maxCount) * 100, 4)}%` }}
              aria-hidden="true"
            />
            <span className="histogram-bin-label">{decadeLabel(bin.startYear)}</span>
          </div>
        ))}
      </div>

      <div className="period-verdicts">
        <p className="period-verdict">
          Balancedness:{' '}
          <span className={`verdict verdict--${(assessment.balancednessVerdict ?? 'Bad').toLowerCase()}`}>
            {assessment.balancednessVerdict}
          </span>
        </p>
        <p className="period-verdict">
          Period length:{' '}
          <span className={`verdict verdict--${(assessment.periodLengthVerdict ?? 'Bad').toLowerCase()}`}>
            {assessment.periodLengthVerdict}
          </span>
        </p>
      </div>

      {assessment.warnBadlyBalanced && (
        <section role="alert" className="alert alert--warning">
          <p>
            Heads up: this playlist looks badly balanced for the game — the
            release years cluster too tightly or too unevenly. It stays fully
            playable, but rounds may feel samey.
          </p>
        </section>
      )}
    </section>
  );
}
