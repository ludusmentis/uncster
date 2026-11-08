import { useEffect, useState } from 'react';
import { beginLogin } from '../auth/spotifyAuth';
import { loadTokens, hasUsableAccessToken } from '../auth/tokenStore';
import {
  emitAuthConnected,
  emitAuthDisconnected,
  getAuthState,
  subscribeAuth,
} from '../auth/AuthContext';
import PlaylistGrid from '../components/PlaylistGrid';
import {
  fetchAllPlaylists,
  type SpotifyPlaylist,
} from '../api/playlists';
import { fetchCurrentUser } from '../api/user';
import { logout } from '../api/auth';
import { navigate } from '../routing';

/**
 * Home view: shows the authenticated state when tokens exist (and the access
 * token is still usable), otherwise the "Connect Spotify" entry point that
 * starts the PKCE login flow. After a failed silent refresh the button is
 * labeled "Reconnect Spotify" (D003 / R009).
 */
export default function Home(): JSX.Element {
  const [authed, setAuthed] = useState(hasUsableAccessToken(loadTokens()));
  const [everConnected, setEverConnected] = useState(getAuthState().status === 'connected');
  const [error, setError] = useState<string | null>(null);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(false);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetryCount, setProfileRetryCount] = useState(0);

  useEffect(() => {
    // Track auth state pushed from non-React code (e.g. authedFetch's
    // failed-refresh wipe) so the UI flips to Reconnect automatically.
    const unsubscribe = subscribeAuth((state) => {
      setAuthed(state.status === 'connected');
      if (state.status === 'connected') {
        setEverConnected(true);
      }
      if (state.status === 'disconnected' && state.reason) {
        setError(state.reason);
      }
    });
    if (hasUsableAccessToken(loadTokens())) {
      emitAuthConnected();
    } else {
      emitAuthDisconnected();
    }
    return unsubscribe;
  }, []);

  // Load the signed-in user's display name (GET /v1/me) for the header.
  // A profile failure is non-fatal: the header falls back to the generic
  // signed-in label with a retryable inline error (T005).
  useEffect(() => {
    if (!authed) {
      setDisplayName(null);
      setProfileError(null);
      return;
    }
    let cancelled = false;
    setProfileError(null);
    fetchCurrentUser()
      .then((user) => {
        if (!cancelled) setDisplayName(user.display_name ?? user.id);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error('[profile] failed to load display name', err);
        setProfileError(
          err instanceof Error
            ? err.message
            : 'Failed to load your profile.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authed, profileRetryCount]);

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

  const handleConnect = (): void => {
    beginLogin().catch((err: unknown) => setError(String(err)));
  };

  // Log out: wipe all session state (tokens, PKCE keys, refresh flight) so
  // the next visit starts a fresh login. The subscribeAuth listener flips
  // the UI back to the Connect entry point.
  const handleLogout = (): void => {
    logout();
    setAuthed(false);
    setEverConnected(false);
    setDisplayName(null);
  };

  const connectLabel = everConnected ? 'Reconnect Spotify' : 'Connect Spotify';

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Harlequin</h1>
      {error ? (
        <section role="alert" style={{ color: '#c0392b' }}>
          <p>{error}</p>
        </section>
      ) : null}
      {authed ? (
        <>
          <p>
            Signed in as{' '}
            <strong>{displayName ?? 'a Spotify user'}</strong>. 🎧
            <button style={{ marginLeft: '1rem' }} onClick={handleLogout}>
              Log out
            </button>
          </p>
          {profileError ? (
            <p role="alert" style={{ color: '#c0392b' }}>
              {profileError}{' '}
              <button onClick={() => setProfileRetryCount((n) => n + 1)}>
                Retry
              </button>
            </p>
          ) : null}
          <h2>Your playlists</h2>
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
        <p>
          You are <strong>not connected</strong> yet.{' '}
          <button onClick={handleConnect}>{connectLabel}</button>
        </p>
      )}
    </main>
  );
}
