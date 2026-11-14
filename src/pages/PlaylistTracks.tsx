import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../routing';
import { usePlayer } from '../playback/PlayerProvider';
import { playTrack } from '../playback/playTrack';
import {
  fetchAllPlaylistTracks,
  releaseYear,
  type SpotifyTrackItem,
  type SpotifyTrack,
} from '../api/tracks';
import { assessPeriod } from '../game/periodBalance';
import PeriodHistogram from '../components/PeriodHistogram';

/**
 * Cover art as a play/pause control (M005 / S03-T2).
 *
 * Both real cover art and the 🎵 placeholder (D013) are clickable play
 * surfaces; only item.track === null rows are non-interactive (rendered
 * by the caller without this wrapper). Overlay state derives from the
 * PlayerProvider context (D012): ▶ when this track is not the playing
 * one, ⏸ when it is; while the device is not ready the control is a
 * logged no-op with a connecting hint.
 */
function CoverArtButton({
  track,
  cover,
  isReady,
  isCurrentPlaying,
  onPlay,
  onToggle,
}: {
  track: SpotifyTrack;
  cover: string | undefined;
  isReady: boolean;
  isCurrentPlaying: boolean;
  onPlay: () => void;
  onToggle: () => void;
}): JSX.Element {
  const handleClick = () => {
    if (!isReady) {
      // Connecting hint: the surface stays visible but inert so the user
      // understands playback is coming, not broken (logged for
      // observability).
      console.info('[tracks] playback click ignored — player not ready');
      return;
    }
    if (isCurrentPlaying) onToggle();
    else onPlay();
  };

  return (
    <button
      type="button"
      className={
        isCurrentPlaying
          ? 'track-cover-btn track-cover-btn--playing'
          : 'track-cover-btn'
      }
      aria-label={
        isCurrentPlaying ? `Pause ${track.name}` : `Play ${track.name}`
      }
      title={isReady ? undefined : 'Connecting to Spotify…'}
      aria-disabled={!isReady}
      onClick={handleClick}
    >
      {cover ? (
        <img
          src={cover}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
          className="track-cover"
        />
      ) : (
        <span aria-hidden="true" className="track-cover track-cover-placeholder">
          🎵
        </span>
      )}
      <span className="track-overlay" aria-hidden="true">
        {isCurrentPlaying ? '⏸' : '▶'}
      </span>
    </button>
  );
}

/**
 * Playlist tracks view (M002 / S02, R004): renders all tracks of one
 * playlist at /playlist/:id with friendly loading / error / empty states.
 *
 * State shapes mirror Home.tsx (P002 / MEM010): abort on unmount so a slow
 * fetch after Back can never set state; non-abort failures land in a
 * retryable error state (R005). No auth gate here — Home gates the grid,
 * and a failed silent refresh mid-browse flips Home via AuthContext.
 *
 * S03-T2: cover art (or the 🎵 placeholder, D013) starts playback on our
 * Connect device via playTrack; clicking the playing track toggles pause /
 * resume. All overlay state comes from usePlayer() (D012).
 */
export default function PlaylistTracks({ id }: { id: string }): JSX.Element {
  const {
    deviceId,
    isReady,
    isPaused,
    currentTrack,
    activateElement,
    togglePlay,
  } = usePlayer();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [tracks, setTracks] = useState<SpotifyTrackItem[]>([]);

  // S02-T2: two-factor period assessment (D018/D021) for the histogram
  // and the Start Game warning badge. Warn only — never blocks the button.
  const assessment = useMemo(() => assessPeriod(tracks), [tracks]);
  const warnBadlyBalanced = assessment.available === true && assessment.warnBadlyBalanced === true;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchAllPlaylistTracks(id, controller.signal)
      .then((all) => {
        setTracks(all);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('[tracks] failed to load playlist tracks', err);
        setError(
          err instanceof Error
            ? err.message
            : 'Failed to load playlist tracks.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [id, retryCount]);

  return (
    <main className="page">
      <p className="back-row">
        <button className="btn" onClick={() => navigate('/')}>← Back to playlists</button>
      </p>
      {/* S02-T3: entry point to the game-setup view — sits above the whole
          playlist (all states) and needs only the id prop, never tracks. */}
      <p className="back-row">
        <button
          className="btn btn-primary"
          onClick={() => navigate(`/setup/${encodeURIComponent(id)}`)}
        >
          🎮 Play with this playlist
        </button>
        {warnBadlyBalanced && (
          <span className="badge badge--warning">⚠ Badly balanced</span>
        )}
      </p>
      <h1 className="neon-heading">Playlist tracks</h1>
      {loading ? (
        // Shimmer skeleton rows in the same grid shape as the loaded rows
        // (03-3-T3) — layout stays stable when data lands.
        <div role="status" aria-label="Loading tracks" className="track-list">
          {Array.from({ length: 8 }, (_, i) => (
            <div
              className="skeleton-track-row"
              key={i}
              aria-hidden="true"
            >
              <div className="skeleton skeleton-cover" />
              <div className="skeleton-track-lines">
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line skeleton-line--short" />
              </div>
              <div className="skeleton skeleton-year" />
            </div>
          ))}
        </div>
      ) : error ? (
        <section role="alert" className="alert">
          <p>{error}</p>
          <button className="btn" onClick={() => setRetryCount((n) => n + 1)}>
            Try again
          </button>
        </section>
      ) : tracks.length === 0 ? (
        <section className="empty-state" role="status">
          <span className="empty-icon" aria-hidden="true">✨</span>
          <p className="empty-title">Blank canvas energy</p>
          <p className="empty-sub">
            No tracks in this playlist yet. Add some bangers in Spotify and
            they'll pop up here.
          </p>
        </section>
      ) : (
        <>
        <PeriodHistogram items={tracks} />
        <ul className="track-list">
          {tracks.map((item, index) => {
            const track = item.item;
            const cover = track?.album?.images?.find((img) => img.url)?.url;
            const artists =
              track?.artists
                ?.map((a) => a.name)
                .join(', ');
            return (
              <li
                key={`${track?.id ?? 'unavailable'}-${index}`}
                className="track-item"
              >
                <span className="track-index" aria-hidden="true">
                  {index + 1}
                </span>
                {track ? (
                  <CoverArtButton
                    track={track}
                    cover={cover}
                    isReady={isReady}
                    isCurrentPlaying={
                      !!currentTrack &&
                      // Relinked tracks (regional/availability variants) play
                      // under a different URI than the playlist row's; the
                      // SDK reports the original via linked_from.
                      (currentTrack.linked_from?.uri ?? currentTrack.uri) ===
                        track.uri &&
                      !isPaused
                    }
                    onPlay={() => {
                      // Autoplay unlock must live in the click handler (S03-T1
                      // contract) before the Connect API call.
                      activateElement();
                      if (!track.uri) {
                        console.warn(
                          '[tracks] track has no uri — cannot start playback',
                          track.id,
                        );
                        return;
                      }
                      playTrack(track.uri, deviceId).catch((err: unknown) => {
                        console.error('[tracks] failed to start playback', err);
                      });
                    }}
                    onToggle={() => {
                      activateElement();
                      togglePlay();
                    }}
                  />
                ) : (
                  <div
                    aria-label="Unavailable track"
                    role="img"
                    className="track-cover-placeholder"
                  >
                    🎵
                  </div>
                )}
                <div className="track-info">
                  <p className="track-title">
                    {track ? track.name : 'Unavailable track'}
                  </p>
                  <p className="track-artist">{artists || '—'}</p>
                </div>
                <span className="track-year">{releaseYear(item)}</span>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </main>
  );
}