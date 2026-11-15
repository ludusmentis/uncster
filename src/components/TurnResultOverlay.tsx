/**
 * TurnResultOverlay (M007 / S02, T04) — full-screen outcome overlays.
 *
 * Rendered by the game view while the engine is in a reveal phase:
 * - Correct drop: the song has already joined the player's list (the
 *   engine did that at drop time), so the list behind this overlay
 *   shows it with full info — and the overlay itself reveals the song
 *   title + year above a Continue button.
 * - Wrong drop: the song is lost (never joins the list); the symmetric
 *   fail overlay reveals both the correct position (1-based, human
 *   wording) and the actual year + Continue.
 *
 * Continue rotates to the next non-winner in creation order via the
 * controller's `continueTurn`. The overlay uses role="alertdialog" +
 * aria-modal so screen readers announce the outcome.
 */

import type { TurnOutcome } from '../game/useGameEngine';

interface TurnResultOverlayProps {
  /** Reveal payload from the engine (success or fail). */
  outcome: TurnOutcome;
  /** Continue: resolve the reveal and rotate to the next player. */
  onContinue: () => void;
}

export default function TurnResultOverlay({
  outcome,
  onContinue,
}: TurnResultOverlayProps): JSX.Element {
  const song = outcome.song;
  return (
    <div className="turn-result-backdrop">
      <div
        role="alertdialog"
        aria-modal={true}
        aria-label={outcome.correct ? 'Correct placement' : 'Wrong placement'}
        className={
          outcome.correct
            ? 'turn-result-overlay turn-result-overlay--success'
            : 'turn-result-overlay turn-result-overlay--fail'
        }
      >
        <h2 className="turn-result-heading">
          {outcome.correct ? 'Correct!' : 'Wrong!'}
        </h2>
        {song !== null && (
          <p className="turn-result-song">
            <strong className="turn-result-title">{song.name}</strong>
            <span className="turn-result-year">{song.releaseYear ?? '—'}</span>
          </p>
        )}
        {!outcome.correct && (
          <p className="turn-result-hint">
            It should have gone at position {outcome.correctPosition + 1}.
          </p>
        )}
        <button className="btn" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}