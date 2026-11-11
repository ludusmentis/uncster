/**
 * Tests for the GameSetup view (M004 / S03, T5):
 * - the back-row button renders with its playlist path intent;
 * - the neon heading renders;
 * - no fetch happens at render time (renderToString runs no effects — the
 *   mount fetch happens in useEffect — but we keep the throwing-fetch spy
 *   so any render-time fetch leak fails loudly).
 *
 * Hydration/persistence and start-click behavior are covered by the T1/T2
 * unit tests and the T6 browser UAT; renderToString cannot run effects, so
 * this file does not attempt event simulation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import GameSetup from './GameSetup';

/** Minimal in-memory localStorage shim (mirrors src/routing.test.ts). */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

describe('GameSetup (S03-T5)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the back-row button and the heading', () => {
    const html = renderToString(<GameSetup id="pl-1" />);
    expect(html).toContain('Back to playlist');
    expect(html).toContain('neon-heading');
    expect(html).toContain('Game setup');
  });

  it('renders the loading state (fetch lives in useEffect, not render)', () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('GameSetup must not fetch during render');
    }));
    const html = renderToString(<GameSetup id="pl-1" />);
    expect(html).toContain('Loading playlist');
  });

  it('renders the setup form surface: players, win condition, start', () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('GameSetup must not fetch during render');
    }));
    const html = renderToString(<GameSetup id="pl-1" />);
    expect(html).toContain('Players');
    expect(html).toContain('Win condition');
    expect(html).toContain('songs-to-win');
    expect(html).toContain('player-name');
    expect(html).toContain('Start Game');
  });

  it('renders for URI-decoded ids without leaking them into fetches', () => {
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('GameSetup must not fetch during render');
    }));
    const html = renderToString(<GameSetup id="a b" />);
    expect(html).toContain('Game setup');
  });

  it('hydrates persisted players from localStorage per playlist', () => {
    localStorage.setItem(
      'harlequin.setup.pl-1',
      JSON.stringify({
        players: [{ id: 'p-1', name: 'Orlo' }],
        songsToWin: 10,
      }),
    );
    const html = renderToString(<GameSetup id="pl-1" />);
    expect(html).toContain('Orlo');
    // A different playlist hydrates its own (empty) state.
    const html2 = renderToString(<GameSetup id="pl-2" />);
    expect(html2).not.toContain('Orlo');
  });
});
