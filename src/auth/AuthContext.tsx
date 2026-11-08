/**
 * Auth state event surface (D003 / R009).
 *
 * A tiny pub/sub rather than a React context tree: the app is a 2-page SPA
 * and the emitter must be callable from non-React code (authedFetch) when a
 * silent refresh fails. React components subscribe via subscribeAuth().
 */

export type AuthStatus = 'connected' | 'disconnected';

export interface AuthState {
  status: AuthStatus;
  /** Present when we were connected and silently lost the session. */
  reason?: string;
}

type Listener = (state: AuthState) => void;

const listeners = new Set<Listener>();

let currentState: AuthState = { status: 'disconnected' };

export function getAuthState(): AuthState {
  return currentState;
}

export function subscribeAuth(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(state: AuthState): void {
  currentState = state;
  for (const listener of listeners) {
    listener(state);
  }
}

/** Called on login success (and initial load with usable tokens). */
export function emitAuthConnected(): void {
  emit({ status: 'connected' });
}

/**
 * Called when tokens are wiped after a failed silent refresh (or when a
 * request arrives with no stored tokens). UI should offer Reconnect Spotify.
 */
export function emitAuthDisconnected(reason?: string): void {
  emit({ status: 'disconnected', reason });
}
