import { useEffect, useState } from 'react';
import HeroTagline from '../components/HeroTagline';
import PlaylistGrid from '../components/PlaylistGrid';
import {
  fetchAllPlaylists,
  type SpotifyPlaylist,
} from '../api/playlists';
import { navigate } from '../routing';

/**
 * Home view (M003 / S03-2, T2): hero tagline + playlist library. Identity,
 * connect and logout chrome live in the shared Header (App), so Home is
 * purely content: the "Connect Spotify" entry CTA for unauthed visitors and
 * the playlist grid for connected ones. Auth state arrives via props from
 * App, which owns the subscribeAuth / emitAuth wiring.
 */
export interface HomeProps {
  authed: boolean;
  everConnected: boolean;
  authError: string | null;
  profileError: string | null;
  onRetryProfile: () => void;
  onConnect: () => void;
}

export default function Home({
  authed,
  everConnected,
  authError,
  profileError,
  onRetryProfile,
  onConnect,
}: HomeProps): JSX.Element {
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);

  // Load the user's playlist library whenever they're connected (and on
  // every retry). Aborts on unmount so a slow page fetch can't set state
  // after cleanup. API/network failures land in the retryable error state.
  useEffect(() => {
    if (!authed) {
      setPlaylists([]);
      setPlaylistsError(null);
      setPlaylistsLoading(false);
      return;
    }
    const controller = new AbortController();
    setPlaylistsLoading(true);
    setPlaylistsError(null);
    fetchAllPlaylists(controller.signal)
      .then((all) => {
        setPlaylists(all);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        console.error('[playlists] failed to load playlist library', err);
        setPlaylistsError(
          err instanceof Error
            ? `${err.message}`
            : 'Failed to load playlists.',
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setPlaylistsLoading(false);
        }
      });
    return () => controller.abort();
  }, [authed, reloadCount]);

  const connectLabel = everConnected ? 'Reconnect Spotify' : 'Connect Spotify';

  return (
    <main className="page">
      <HeroTagline />
      {authError ? (
        <section role="alert" className="alert">
          <p>{authError}</p>
        </section>
      ) : null}
      {authed ? (
        <>
          {profileError ? (
            <p role="alert" className="alert-inline">
              {profileError}{' '}
              <button className="btn" onClick={onRetryProfile}>
                Retry
              </button>
            </p>
          ) : null}
          <h2 className="neon-heading">Your playlists</h2>
          <PlaylistGrid
            playlists={playlists}
            loading={playlistsLoading}
            error={playlistsError}
            onRetry={() => setReloadCount((n) => n + 1)}
            onOpenPlaylist={(id) =>
              navigate('/playlist/' + encodeURIComponent(id))
            }
          />
        </>
      ) : (
        <section className="empty-state empty-state--cta" role="status">
          <span className="empty-icon" aria-hidden="true">🦑</span>
          <p className="empty-title">Your library's one tap away</p>
          <p className="empty-sub">
            Connect Spotify and uncster pulls in your whole playlist library.
            It's giving instant neon, it's giving your music.
          </p>
          <button className="btn btn-primary" onClick={onConnect}>{connectLabel}</button>
        </section>
      )}
    </main>
  );
}
