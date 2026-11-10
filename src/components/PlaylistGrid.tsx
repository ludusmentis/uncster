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
  onOpenPlaylist,
}: {
  playlists: SpotifyPlaylist[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenPlaylist?: (id: string) => void;
}): JSX.Element {
  if (loading) {
    // Shimmer skeletons in the same grid shape as the loaded cards, so the
    // layout never jumps when data arrives (03-3-T3).
    return (
      <div
        className="playlist-grid"
        role="status"
        aria-label="Loading your playlists"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <div className="skeleton-card" key={i} aria-hidden="true">
            <div className="skeleton skeleton-media" />
            <div className="skeleton skeleton-line" />
            <div className="skeleton skeleton-line skeleton-line--short" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <section role="alert" className="alert">
        <p>{error}</p>
        <button className="btn" onClick={onRetry}>Try again</button>
      </section>
    );
  }

  if (playlists.length === 0) {
    return (
      <section className="empty-state" role="status">
        <span className="empty-icon" aria-hidden="true">🎧</span>
        <p className="empty-title">It's giving… nothing rn</p>
        <p className="empty-sub">
          No playlists yet. Save one in Spotify and it'll slide into your
          library here, no cap.
        </p>
      </section>
    );
  }

  return (
    <div className="playlist-grid">
      {playlists.map((playlist) => (
        <PlaylistCard
          key={playlist.id}
          playlist={playlist}
          onOpen={onOpenPlaylist ? () => onOpenPlaylist(playlist.id) : undefined}
        />
      ))}
    </div>
  );
}
