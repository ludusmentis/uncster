/**
 * PodiumSummary (M007 / S05, T02) — full game-over podium.
 *
 * Rendered by the game view once the engine is finished (every player
 * has won): one block per player in win order (rank 1 first), each
 * showing the player's name above their FULL revealed chronology in
 * the standard track-row styling (title/artist placeholder/year all
 * visible — the hidden-until-drop rule is over at game over; missing
 * release years render the RELEASE_YEAR_PLACEHOLDER). Two exit options:
 * Play again → /setup/<playlistId> and Back to playlist →
 * /playlist/<playlistId>.
 *
 * Pure render of in-memory engine state (podium is derived in the view
 * builder): no store or reducer changes. Refresh after game over falls
 * back to GameFallback by design (finished snapshots are cleared).
 */

import type { PodiumEntry } from '../game/useGameEngine';
import { RELEASE_YEAR_PLACEHOLDER } from '../api/tracks';
import { navigate } from '../routing';

interface PodiumSummaryProps {
  /** Every player with their chronology, winners first in win order. */
  podium: PodiumEntry[];
  /** Winner ids in win order (kept for the DOM-observable UAT list). */
  winners: string[];
  /** The played playlist: powers both exit-option routes. */
  playlistId: string;
}

export default function PodiumSummary({
  podium,
  winners,
  playlistId,
}: PodiumSummaryProps): JSX.Element {
  const setupPath = `/setup/${encodeURIComponent(playlistId)}`;
  const playlistPath = `/playlist/${encodeURIComponent(playlistId)}`;
  return (
    <section className="page game-page podium-summary" aria-label="Game over" data-testid="podium">
      <h2 className="neon-heading">Game over</h2>
      <p className="game-over-sub">Every player filled their timeline. Congratulations!</p>
      <ol className="podium-list">
        {podium.map((entry) => (
          <li
            key={entry.id}
            className="podium-player"
            data-testid="podium-player"
            data-player-id={entry.id}
            data-rank={entry.rank}
          >
            <h3 className="podium-player-name">
              <span className="podium-rank" data-testid="podium-rank">{`#${entry.rank}`}</span>
              <span className="podium-player-title">
                {entry.name}
                {entry.rank === 1 && <span className="podium-winner"> — winner!</span>}
              </span>
            </h3>
            {entry.songs.length > 0 ? (
              <ol className="track-list game-list podium-song-list">
                {entry.songs.map((song, index) => (
                  <li
                    key={`${song.name}-${index}`}
                    className="track-item game-list-row"
                    data-testid="podium-song"
                  >
                    <span className="track-index" aria-hidden="true">{index + 1}</span>
                    <span aria-hidden="true" className="track-cover-placeholder">🎵</span>
                    <div className="track-info">
                      <p className="track-title">{song.name}</p>
                      <p className="track-artist">—</p>
                    </div>
                    <span className="track-year">
                      {song.releaseYear ?? RELEASE_YEAR_PLACEHOLDER}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="podium-empty">No songs placed.</p>
            )}
          </li>
        ))}
      </ol>
      <p className="back-row podium-actions">
        <button
          className="btn"
          data-testid="podium-play-again"
          onClick={() => navigate(setupPath)}
        >
          Play again
        </button>
        <button
          className="btn"
          data-testid="podium-back-to-playlist"
          onClick={() => navigate(playlistPath)}
        >
          ← Back to playlist
        </button>
      </p>
      {/* Rendered for DOM-observable winner count (UAT walk compatibility). */}
      <ul className="sr-only" data-testid="game-over-winners">
        {winners.map((id) => (<li key={id}>{id}</li>))}
      </ul>
    </section>
  );
}