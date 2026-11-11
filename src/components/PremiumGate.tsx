/**
 * Premium gate (M005 / S02-T4, D014).
 *
 * Uncster plays audio through Spotify's Web Playback SDK, which only works
 * with Premium accounts. Two gates route here:
 *
 * 1. Primary: GET /v1/me `product` field (App.tsx) — checked right after
 *    login; anything other than 'premium' (including a missing field)
 *    blocks the whole app.
 * 2. Backstop: the SDK's `account_error` listener (T2 categorises it as
 *    kind 'account') — raced logins or mid-session downgrades land here
 *    even if the profile check passed.
 *
 * The gate is fully blocking: it replaces the app's routes and chrome with
 * a single full-screen message and a Log out button — no further access.
 */

import { useEffect } from 'react';
import { usePlayer } from '../playback/PlayerProvider';
import PageShell from './PageShell';

/** Full-app blocking screen. Log out is the only way out. */
export function PremiumGate({ onLogout }: { onLogout: () => void }): JSX.Element {
  return (
    <PageShell>
      <section
        aria-labelledby="premium-gate-heading"
        style={{ textAlign: 'center', padding: 'var(--space-6, 3rem) 0' }}
      >
        <h1 id="premium-gate-heading" className="neon-heading">
          Premium required
        </h1>
        <p>
          Uncster only works with Spotify Premium accounts. Spotify&apos;s
          Web Playback SDK — which powers playback here — is available to
          Premium subscribers only.
        </p>
        <p>
          Log out and connect a Premium account to keep going.
        </p>
        <button type="button" onClick={onLogout}>
          Log out
        </button>
      </section>
    </PageShell>
  );
}

/**
 * Backstop watcher (must render inside <PlayerProvider>): bridges the SDK
 * player's categorised `account_error` (kind 'account', D014) to App-level
 * state so the gate can take over even after a passed profile check.
 */
export function AccountErrorWatcher({
  onAccountError,
}: {
  onAccountError: (message: string) => void;
}): null {
  const { error } = usePlayer();
  useEffect(() => {
    if (error?.kind === 'account') {
      console.error('[premium-gate] SDK account_error:', error.message);
      onAccountError(error.message);
    }
  }, [error, onAccountError]);
  return null;
}