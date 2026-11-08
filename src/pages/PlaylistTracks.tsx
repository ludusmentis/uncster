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
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <p style={{ margin: '0 0 1rem' }}>
        <button onClick={() => navigate('/')}>← Back to playlists</button>
      </p>
      <h1>Playlist tracks</h1>
      {loading ? (
        <p role="status">Loading tracks…</p>
      ) : error ? (
        <section role="alert" style={{ color: '#c0392b' }}>
          <p>{error}</p>
          <button onClick={() => setRetryCount((n) => n + 1)}>
            Try again
          </button>
        </section>
      ) : tracks.length === 0 ? (
        <p role="status">No tracks in this playlist yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid #eee',
                }}
              >
                {track && cover ? (
                  <img
                    src={cover}
                    alt={`${track.name} cover art`}
                    width={48}
                    height={48}
                    style={{ borderRadius: 4, objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    aria-label={
                      track
                        ? `${track.name} has no cover art`
                        : 'Unavailable track'
                    }
                    role="img"
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 4,
                      background: '#1db95422',
                      border: '1px solid #1db95488',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxSizing: 'border-box',
                    }}
                  >
                    🎵
                  </div>
                )}
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>
                    {track ? track.name : 'Unavailable track'}
                  </p>
                  <p style={{ margin: 0, color: '#555' }}>
                    {artists || '—'} · {releaseYear(item)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}