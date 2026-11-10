import { useEffect, useState } from 'react';
import { completeLogin, AuthError } from '../auth/spotifyAuth';

/**
 * Callback view: Spotify redirects here with ?code&state (success),
 * ?error (denied/error), or ?code&state that fails verification.
 * Surfaces any error in the UI (slice verification requirement),
 * then routes home on success.
 */
export default function Callback(): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const status = 'Completing Spotify login…';

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('error');
    const code = params.get('code');
    const state = params.get('state');

    if (authError) {
      setError(
        `Spotify authorization failed: ${authError}${
          authError === 'access_denied' ? ' (you denied the request).' : '.'
        }`,
      );
      return;
    }
    if (!code || !state) {
      setError('Missing code or state in the OAuth redirect.');
      return;
    }

    completeLogin(code, state)
      .then(() => {
        window.history.replaceState({}, '', '/');
        window.location.replace('/');
      })
      .catch((err: unknown) => {
        if (err instanceof AuthError) {
          setError(err.message);
        } else {
          setError(`Unexpected error during login: ${String(err)}`);
        }
      });
  }, []);

  return (
    <main className="page">
      {error ? (
        <section role="alert" className="alert">
          <h2>Login failed</h2>
          <p>{error}</p>
          <button className="btn" onClick={() => window.location.replace('/')}>
            Back to home
          </button>
        </section>
      ) : (
        <p aria-live="polite">{status}</p>
      )}
    </main>
  );
}
