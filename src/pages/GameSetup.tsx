import { useEffect, useState } from 'react';
import { navigate } from '../routing';
import { fetchPlaylist, type SpotifyPlaylist } from '../api/playlists';
import {
  DEFAULT_SONGS_TO_WIN,
  addPlayer,
  removePlayer,
  setSongsToWin,
  isShortPlaylist,
  validateStart,
  type GameConfig,
  type SetupState,
} from '../game/setupLogic';
import { loadSetupState, saveSetupState, setPendingGameConfig } from '../game/setupStore';

/**
 * Game setup view (M004 / S03, T5 — D010 / MEM038): full setup surface at
 * /setup/:playlistId. The playlist id comes from the route (shareable URL,
 * no nav params); metadata (name + tracks.total) is fetched here via one
 * GET /v1/playlists/{id} with an abort-on-unmount gate (P002 / MEM010
 * loading / error-retryable / loaded shape).
 *
 * SetupState hydrates from localStorage per playlist and persists on every
 * change; the Start Game handoff goes through the shared module slot
 * (setPendingGameConfig), never URL params (D010).
 */
export default function GameSetup({ id }: { id: string }): JSX.Element {
  // Playlist metadata: loading / error-retryable / loaded (P002 / MEM010).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [playlist, setPlaylist] = useState<SpotifyPlaylist | null>(null);

  // Setup state: hydrated per playlist from localStorage on first render.
  const [state, setState] = useState<SetupState>(() => loadSetupState(id));
  const [playerName, setPlayerName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [winReason, setWinReason] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchPlaylist(id, controller.signal)
      .then((meta) => {
        setPlaylist(meta);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('[setup] failed to load playlist metadata', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load playlist.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [id, retryCount]);

  const updateState = (next: SetupState): void => {
    setState(next);
    saveSetupState(id, next);
  };

  const handleAddPlayer = (): void => {
    const result = addPlayer(state, playerName);
    if (result.error) {
      setAddError(result.error);
      return;
    }
    setAddError(null);
    setPlayerName('');
    updateState(result.state);
  };

  const handleSongsToWin = (raw: string): void => {
    const value = Number(raw);
    const result = setSongsToWin(state, value);
    setWinReason(result.reason);
    if (!result.reason) {
      updateState(result.state);
    }
  };

  const totalTracks = playlist?.tracks?.total ?? null;
  const short =
    totalTracks !== null && isShortPlaylist(state, totalTracks);
  const startBlocked = validateStart(state, totalTracks ?? 0);

  const handleStart = (): void => {
    const config: GameConfig = {
      playlistId: id,
      playlistName: playlist?.name ?? '',
      players: state.players,
      songsToWin: state.songsToWin,
    };
    setPendingGameConfig(config);
    navigate('/game');
  };

  return (
    <main className="page">
      <p className="back-row">
        <button
          className="btn"
          onClick={() => navigate(`/playlist/${encodeURIComponent(id)}`)}
        >
          ← Back to playlist
        </button>
      </p>
      <h1 className="neon-heading">Game setup</h1>

      {loading ? (
        <p role="status">Loading playlist…</p>
      ) : error ? (
        <section role="alert" className="alert">
          <p>{error}</p>
          <button className="btn" onClick={() => setRetryCount((n) => n + 1)}>
            Try again
          </button>
        </section>
      ) : (
        <p>
          Playlist:{' '}
          <strong>{playlist?.name ?? id}</strong>
          {totalTracks !== null && (
            <span className="neon-text-muted"> ({totalTracks} tracks)</span>
          )}
        </p>
      )}

      <section className="setup-section">
            <h2>Players</h2>
            <div className="setup-add-row">
              <label className="sr-only" htmlFor="player-name">Player name</label>
              <input
                id="player-name"
                className="field"
                type="text"
                value={playerName}
                placeholder="Player name"
                onChange={(e) => {
                  setPlayerName(e.target.value);
                  setAddError(null);
                }}
              />
              <button className="btn" onClick={handleAddPlayer}>
                Add
              </button>
            </div>
            {addError && (
              <p role="alert" className="alert-inline">{addError}</p>
            )}
            <ul className="setup-players">
              {state.players.map((player) => (
                <li key={player.id} className="setup-player">
                  <span>{player.name}</span>
                  <button
                    className="btn"
                    onClick={() => updateState(removePlayer(state, player.id))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="setup-section">
            <h2>Win condition</h2>
            <div className="setup-add-row">
              <label htmlFor="songs-to-win">Songs to win</label>
              <input
                id="songs-to-win"
                className="field field--num"
                type="number"
                min={1}
                max={15}
                step={1}
                defaultValue={state.songsToWin || DEFAULT_SONGS_TO_WIN}
                onChange={(e) => handleSongsToWin(e.target.value)}
              />
            </div>
            {winReason && (
              <p role="alert" className="alert-inline">{winReason}</p>
            )}
          </section>

      {short && (
        <section role="alert" className="alert alert--warning">
          <p>
            Heads up: this playlist has {totalTracks} tracks, but{' '}
            {state.players.length} player
            {state.players.length === 1 ? '' : 's'} × {state.songsToWin}{' '}
            song{state.songsToWin === 1 ? '' : 's'} each could need{' '}
            {state.players.length * state.songsToWin}. Songs may repeat —
            you can still start if you're okay with that.
          </p>
        </section>
      )}

      <p>
        <button
          className="btn btn-primary"
          disabled={startBlocked !== null}
          onClick={handleStart}
        >
          🎮 Start Game
        </button>
      </p>
      {startBlocked && <p className="neon-text-muted">{startBlocked}</p>}
    </main>
  );
}
