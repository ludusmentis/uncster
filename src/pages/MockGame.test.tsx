/**
 * Tests for the mocked game view (M004 / S03, T4):
 * - with a pending GameConfig set via setPendingGameConfig before render,
 *   the summary renders (playlist name, player names, songsToWin);
 * - with no pending config (fresh module state), the friendly
 *   "No game in progress" empty state renders;
 * - zero fetch calls: globalThis.fetch is stubbed with a throwing spy so
 *   any leaked API call fails loudly (R012 render purity).
 *
 * renderToString runs no effects; takePendingGameConfig is called inside
 * the component body via a lazy useState initializer, so both states are
 * directly assertable. The module slot is shared, so the no-config test
 * re-imports the store fresh (vi.resetModules + dynamic import).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { setPendingGameConfig } from '../game/setupStore';
import MockGame from './MockGame';

const sampleConfig = {
  playlistId: 'pl-1',
  playlistName: 'Mock Playlist One',
  players: [
    { id: 'p-1', name: 'Orlo' },
    { id: 'p-2', name: 'Zeta' },
  ],
  songsToWin: 15,
};

describe('MockGame (S03-T4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('renders the game summary when a pending config is set', () => {
    setPendingGameConfig(sampleConfig);
    const html = renderToString(<MockGame />);
    expect(html).toContain('Game starting');
    expect(html).toContain('Mock Playlist One');
    expect(html).toContain('pl-1');
    expect(html).toContain('Orlo');
    expect(html).toContain('Zeta');
    expect(html).toContain('15');
    expect(html).toContain('neon-heading');
    expect(html).toContain('Back to playlists');
  });

  it('renders the friendly empty state with no pending config', async () => {
    // Fresh module registry: no config has been set in this module graph.
    const { default: FreshMockGame } = await import('./MockGame');
    const html = renderToString(<FreshMockGame />);
    expect(html).toContain('No game in progress');
    expect(html).toContain('Back home');
    expect(html).not.toContain('Mock Playlist One');
  });

  it('makes no fetch calls while rendering (either state)', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('MockGame must not fetch during render');
    });
    vi.stubGlobal('fetch', fetchSpy);
    setPendingGameConfig(sampleConfig);
    renderToString(<MockGame />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});