import type { SpotifyPlaylist } from '../api/playlists';

/**
 * A single playlist tile: cover art (or a placeholder when Spotify returned
 * no image) with the playlist name underneath.
 */
export default function PlaylistCard({
  playlist,
  onOpen,
}: {
  playlist: SpotifyPlaylist;
  onOpen?: () => void;
}): JSX.Element {
  const cover = playlist.images?.find((img) => img.url)?.url;

  const content = (
    <>
      {cover ? (
        <img
          src={cover}
          alt={`${playlist.name} cover art`}
          width={180}
          height={180}
          style={{ borderRadius: 8, display: 'block', objectFit: 'cover' }}
        />
      ) : (
        <div
          aria-label={`${playlist.name} has no cover art`}
          role="img"
          style={{
            width: 180,
            height: 180,
            borderRadius: 8,
            background: '#1db95422',
            border: '1px solid #1db95488',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '3rem',
            boxSizing: 'border-box',
          }}
        >
          🎵
        </div>
      )}
      <p
        style={{
          margin: '0.5rem 0 0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={playlist.name}
      >
        {playlist.name}
      </p>
    </>
  );

  if (onOpen) {
    return (
      <button
        onClick={onOpen}
        style={{
          display: 'block',
          border: 'none',
          background: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'center',
          width: 180,
          cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {content}
      </button>
    );
  }

  return (
    <article
      style={{
        width: 180,
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {content}
    </article>
  );
}
