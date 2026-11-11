import { useEffect, useState } from 'react';
import Home from './pages/Home';
import Callback from './pages/Callback';
import PlaylistTracks from './pages/PlaylistTracks';
import GameSetup from './pages/GameSetup';
import MockGame from './pages/MockGame';
import Header from './components/Header';
import PageShell from './components/PageShell';
import { parseRoute, subscribeRoute } from './routing';
import { beginLogin } from './auth/spotifyAuth';
import { loadTokens, hasUsableAccessToken } from './auth/tokenStore';
import {
  emitAuthConnected,
  emitAuthDisconnected,
  getAuthState,
  subscribeAuth,
} from './auth/AuthContext';
import { fetchCurrentUser } from './api/user';
import { logout } from './api/auth';

/**
 * App shell (M003 / S03-2, T2): every route shares the same chrome —
 * pulsing Monoton 'Uncster' header (identity / connect / logout) plus the
 * PageShell container. App owns the auth-chrome state lifted out of Home
 * (03-2-T2) so subscribeAuth / emitAuth wiring stays intact and identity
 * renders identically on Home, Playlist Tracks and Callback.
 */
export default function App(): JSX.Element {
  const [path, setPath] = useState(window.location.pathname);
  const [authed, setAuthed] = useState(hasUsableAccessToken(loadTokens()));
  const [everConnected, setEverConnected] = useState(getAuthState().status === 'connected');
  const [authError, setAuthError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileRetryCount, setProfileRetryCount] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeRoute((next) => setPath(next));
    return unsubscribe;
  }, []);

  useEffect(() => {
    // Track auth state pushed from non-React code (e.g. authedFetch's
    // failed-refresh wipe) so the chrome flips to Reconnect automatically.
    const unsubscribe = subscribeAuth((state) => {
      setAuthed(state.status === 'connected');
      if (state.status === 'connected') {
        setEverConnected(true);
      }
      if (state.status === 'disconnected' && state.reason) {
        setAuthError(state.reason);
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
  // signed-in label with a retryable inline error surfaced on Home.
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

  const handleConnect = (): void => {
    beginLogin().catch((err: unknown) => setAuthError(String(err)));
  };

  // Log out: wipe all session state (tokens, PKCE keys, refresh flight) so
  // the next visit starts a fresh login. The subscribeAuth listener flips
  // the chrome back to the Connect entry point.
  const handleLogout = (): void => {
    logout();
    setAuthed(false);
    setEverConnected(false);
    setDisplayName(null);
  };

  const route = parseRoute(path);

  let content: JSX.Element;
  switch (route.name) {
    case 'callback':
      content = <Callback />;
      break;
    case 'playlist':
      content = <PlaylistTracks id={route.id} />;
      break;
    case 'setup':
      content = <GameSetup id={route.id} />;
      break;
    case 'game':
      content = <MockGame />;
      break;
    default:
      content = (
        <Home
          authed={authed}
          everConnected={everConnected}
          authError={authError}
          profileError={profileError}
          onRetryProfile={() => setProfileRetryCount((n) => n + 1)}
          onConnect={handleConnect}
        />
      );
  }

  return (
    <>
      <Header
        authed={authed}
        displayName={displayName}
        everConnected={everConnected}
        onConnect={handleConnect}
        onLogout={handleLogout}
      />
      <PageShell>{content}</PageShell>
    </>
  );
}
