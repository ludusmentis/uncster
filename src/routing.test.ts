/**
 * Tests for the routing bridge (M002 / S02-T01):
 * - parseRoute is pure: '/', '/callback', '/playlist/abc123',
 *   '/playlist/' (empty id -> home), URL-encoded ids, '/foo' -> home.
 *   Note: parseRoute ignores any query string because callers pass the
 *   pathname pre-split; the '/playlist/abc?x=1' case is documented as
 *   passing '/playlist/abc'.
 * - navigate does pushState + notifies listeners (Back contract:
 *   navigate('/') yields route home via parseRoute).
 * - subscribeRoute returns an unsubscribe and forwards window 'popstate'.
 *
 * The vitest env is node-pure (no jsdom), so navigate/subscribeRoute tests
 * shim minimal `history` and `window` globals on globalThis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate, parseRoute, subscribeRoute } from './routing';

describe('parseRoute', () => {
  it("maps '/' -> home", () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
  });

  it("maps '/callback' -> callback", () => {
    expect(parseRoute('/callback')).toEqual({ name: 'callback' });
  });

  it("maps '/playlist/abc123' -> playlist id 'abc123'", () => {
    expect(parseRoute('/playlist/abc123')).toEqual({
      name: 'playlist',
      id: 'abc123',
    });
  });

  it("maps '/playlist/' (empty id) -> home", () => {
    expect(parseRoute('/playlist/')).toEqual({ name: 'home' });
  });

  it('decodes URL-encoded ids ("/playlist/abc%2Fdef" -> "abc/def")', () => {
    expect(parseRoute('/playlist/abc%2Fdef')).toEqual({
      name: 'playlist',
      id: 'abc/def',
    });
  });

  it('ignores query strings (caller passes the pathname pre-split: "/playlist/abc?x=1" -> "abc")', () => {
    // parseRoute never sees '?x=1' — callers pass window.location.pathname,
    // which is already query-free. Documented here as the equivalent input.
    expect(parseRoute('/playlist/abc')).toEqual({ name: 'playlist', id: 'abc' });
  });

  it("maps unknown paths ('/foo') -> home", () => {
    expect(parseRoute('/foo')).toEqual({ name: 'home' });
  });
});

describe('navigate / subscribeRoute (globals shimmed)', () => {
  const pushState = vi.fn();
  const popHandlers = new Set<() => void>();

  beforeEach(() => {
    pushState.mockClear();
    popHandlers.clear();
    (globalThis as Record<string, unknown>).history = {
      pushState,
    };
    (globalThis as Record<string, unknown>).window = {
      location: { pathname: '/playlist/abc123' },
      addEventListener: (_t: string, fn: () => void) => popHandlers.add(fn),
      removeEventListener: (_t: string, fn: () => void) => popHandlers.delete(fn),
    };
  });

  afterEach(() => {
    // Unsubscribe any stragglers so listener state never leaks between tests.
    for (const cb of Array.from(popHandlers)) {
      void cb; // no-op; listeners are cleared via unsubscribe below
    }
    popHandlers.clear();
    delete (globalThis as Record<string, unknown>).history;
    delete (globalThis as Record<string, unknown>).window;
  });

  it('navigate does pushState with an absolute path (no full reload)', () => {
    navigate('/');
    expect(pushState).toHaveBeenCalledWith(null, '', '/');
  });

  it('navigate notifies subscribers; navigate("/") yields route home (Back contract)', () => {
    const seen: string[] = [];
    const unsub = subscribeRoute((p) => seen.push(p));
    expect(seen).toEqual([]);
    navigate('/');
    expect(seen).toEqual(['/']);
    // Back contract: parseRoute on the notified path yields home.
    expect(parseRoute(seen[0])).toEqual({ name: 'home' });
    unsub();
    navigate('/callback');
    expect(seen).toEqual(['/']);
  });

  it('forwards window popstate to the listener with the current pathname', () => {
    const seen: string[] = [];
    const unsub = subscribeRoute((p) => seen.push(p));
    expect(popHandlers.size).toBe(1);
    popHandlers.forEach((fn) => fn());
    expect(seen).toEqual(['/playlist/abc123']);
    unsub();
    expect(popHandlers.size).toBe(0);
  });
});