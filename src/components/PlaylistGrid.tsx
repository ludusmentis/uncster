import type { SpotifyPlaylist } from '../api/playlists';
import PlaylistCard from './PlaylistCard';

/**
 * Responsive grid of playlist cards with loading, empty, error (retryable),
 * and success states.
 */
export default function PlaylistGrid({
  playlists,
  loading,
  error,
  onRetry,
}: {
  playlists: SpotifyPlaylist[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}): JSX.Element {
  if (loading) {
    return <p role="status">Loading your playlists…</p>;
  }

  if (error) {
    return (
      <section role="alert" style={{ color: '#c0392b' }}>
        <p>{error}</p>
        <button onClick={onRetry}>Try again</button>
      </section>
    );
  }

  if (playlists.length === 0) {
    return (
      <p role="status">No playlists yet — create one in Spotify and it will show up here.</p>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
      }}
    >
      {playlists.map((playlist) => (
        <PlaylistCard key={playlist.id} playlist={playlist} />
      ))}
    </div>
  );
}
