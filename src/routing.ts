/**
 * Tiny pushState-aware routing bridge (M002 / S02):
 * - parseRoute(path) is pure: '/callback' -> callback, '/playlist/<id>' ->
 *   playlist and '/setup/<id>' -> setup, each with a URI-decoded id;
 *   everything else (including empty ids) falls back to home (so we never
 *   fetch '/v1/playlists//tracks' or render a setup view for no playlist).
 * - navigate(path) does history.pushState + notifies listeners (absolute
 *   paths only, no full reloads).
 * - subscribeRoute(cb) registers a listener and forwards window 'popstate';
 *   returns an unsubscribe function.
 */
export type Route =
  | { name: 'home' }
  | { name: 'callback' }
  | { name: 'playlist'; id: string }
  | { name: 'setup'; id: string }
  | { name: 'game' };

/** Parse a path string (pathname only — callers split off any query). */
export function parseRoute(path: string): Route {
  if (path === '/callback') {
    return { name: 'callback' };
  }
  if (path === '/game') {
    return { name: 'game' };
  }
  if (path.startsWith('/playlist/')) {
    const raw = path.slice('/playlist/'.length);
    if (raw.length > 0) {
      return { name: 'playlist', id: decodeURIComponent(raw) };
    }
  }
  if (path.startsWith('/setup/')) {
    const raw = path.slice('/setup/'.length);
    if (raw.length > 0) {
      return { name: 'setup', id: decodeURIComponent(raw) };
    }
  }
  return { name: 'home' };
}

type RouteListener = (path: string) => void;

const listeners = new Set<RouteListener>();

/** Navigate with pushState (absolute path, no full reload) and notify. */
export function navigate(path: string): void {
  const history = (globalThis as { history?: History }).history;
  if (history?.pushState) {
    history.pushState(null, '', path);
  }
  for (const cb of listeners) {
    cb(path);
  }
}

/** Subscribe to route changes; also forwards window 'popstate'. Returns unsubscribe. */
export function subscribeRoute(cb: RouteListener): () => void {
  listeners.add(cb);
  const onPopState = () => cb(window.location.pathname);
  window.addEventListener('popstate', onPopState);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('popstate', onPopState);
  };
}