import { navigate } from '../routing';

/**
 * Uncster application chrome header (M003 / S03-2, T1).
 *
 * Pulsing Monoton 'Uncster' neon wordmark (clickable to Home via existing
 * navigate()) on the left; identity area on the right. The header itself
 * does NOT own auth state — it consumes it via props so the parent (App /
 * Home, wired in T2) keeps the existing subscribeAuth / displayName
 * fetching contract intact. No new data fetching here.
 */
export interface HeaderProps {
  /** True when a usable access token session exists. */
  authed: boolean;
  /** Signed-in display name (null while loading / unavailable). */
  displayName: string | null;
  /** True once the user has connected before — flips label to "Reconnect". */
  everConnected?: boolean;
  onConnect: () => void;
  onLogout: () => void;
}

export default function Header({
  authed,
  displayName,
  everConnected = false,
  onConnect,
  onLogout,
}: HeaderProps): JSX.Element {
  const connectLabel = everConnected ? 'Reconnect Spotify' : 'Connect Spotify';

  return (
    <header className="app-header container">
      <button
        type="button"
        className="header-wordmark neon-title neon-pulse"
        onClick={() => navigate('/')}
        aria-label="Uncster — back to home"
      >
        Uncster
      </button>
      <div className="header-actions">
        {authed ? (
          <>
            <span className="header-user text-body-small">
              Signed in as <strong>{displayName ?? 'a Spotify user'}</strong>
            </span>
            <button type="button" className="btn" onClick={onLogout}>
              Log out
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onConnect}>
            {connectLabel}
          </button>
        )}
      </div>
    </header>
  );
}
