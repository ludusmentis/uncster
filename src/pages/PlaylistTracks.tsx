import { useEffect, useState } from 'react';
import { navigate } from '../routing';
import {
  fetchAllPlaylistTracks,
  releaseYear,
  type SpotifyTrackItem,
} from '../api/tracks';

/**
 * Playlist tracks view (M002 / S02, R004): renders all tracks of one
 * playlist at /playlist/:id with friendly loading / error / empty states.
 *
 * State shapes mirror Home.tsx (P002 / MEM010): abort on unmount so a slow
 * fetch after Back can never set state; non-abort failures land in a
 * retryable error state (R005). No auth gate here — Home gates the grid,
 * and a failed silent refresh mid-browse flips Home via AuthContext.
 */
export default function PlaylistTracks({ id }: { id: string }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [tracks, setTracks] = useState<SpotifyTrackItem[]>([]);

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
                {track && cover ? (
                  <img
                    src={cover}
                    alt={`${track.name} cover art`}
                    width={48}
                    height={48}
                    loading="lazy"
                    decoding="async"
                    className="track-cover"
                  />
                ) : (
                  <div
                    aria-label={
                      track
                        ? `${track.name} has no cover art`
                        : 'Unavailable track'
                    }
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
      )}
    </main>
  );
}