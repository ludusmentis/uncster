import type { SpotifyPlaylist } from '../api/playlists';

/**
 * A single playlist tile: cover art (or a placeholder when Spotify returned
 * no image) with the playlist name and a track-count subtitle underneath.
 * Hover lifts the card with a neon pink border glow; keyboard focus gets a
 * solid neon focus ring (:focus-visible). Cards stay presentational —
 * click-through is wired via the optional onOpen callback (P005).
 */
export default function PlaylistCard({
  playlist,
  onOpen,
}: {
  playlist: SpotifyPlaylist;
  onOpen?: () => void;
}): JSX.Element {
  const cover = playlist.images?.find((img) => img.url)?.url;
  const trackCount = playlist.tracks?.total;

  const content = (
    <>
      <div className="playlist-card-media">
        {cover ? (
          <img
            src={cover}
            alt={`${playlist.name} cover art`}
            width={300}
            height={300}
            loading="lazy"
            decoding="async"
            className="cover-img"
          />
        ) : (
          <div
            aria-label={`${playlist.name} has no cover art`}
            role="img"
            className="cover-placeholder"
          >
            🎵
          </div>
        )}
      </div>
      <p className="playlist-name" title={playlist.name}>
        {playlist.name}
      </p>
      {typeof trackCount === 'number' && (
        <p className="playlist-subtitle text-small">
          {`${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`}
        </p>
      )}
    </>
  );

  if (onOpen) {
    return (
      <button onClick={onOpen} className="playlist-card-btn">
        {content}
      </button>
    );
  }

  return (
    <article className="playlist-card">
      {content}
    </article>
  );
}
