/**
 * Tests for the polished playlist card + grid (M003 / S03-3, T1):
 * - Card renders cover art (lazy loaded, aspect-ratio media box) or the
 *   placeholder when Spotify returned no image.
 * - Card shows the playlist name plus a track-count subtitle in the solid
 *   neon small-text class (.playlist-subtitle / .text-small) when
 *   tracks.total is present, and omits the subtitle when it is not.
 * - With onOpen the card is a real <button> (P005 click-through); without
 *   it the card degrades to a static <article>.
 * - base.css defines the polished card interaction language: CSS grid
 *   auto-fill minmax columns (not flex-wrap), hover lift + neon pink
 *   border glow, :focus-visible ring, and a solid-neon subtitle with no
 *   glow shadow stack on small text (D008).
 *
 * Rendering uses react-dom/server renderToString (node environment, same
 * pattern as Header.test.tsx); the stylesheet is read via node:fs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import PlaylistCard from './PlaylistCard';
import PlaylistGrid from './PlaylistGrid';
import type { SpotifyPlaylist } from '../api/playlists';

const pl = (overrides: Partial<SpotifyPlaylist> = {}): SpotifyPlaylist => ({
  id: 'pl-1',
  name: 'Neon Nights',
  images: [{ url: 'https://img.example/cover.jpg', height: 300, width: 300 }],
  tracks: { total: 12 },
  ...overrides,
});

describe('PlaylistCard', () => {
  it('renders cover art inside the aspect-ratio media box with lazy loading', () => {
    const html = renderToString(<PlaylistCard playlist={pl()} />);
    expect(html).toMatch(/<div[^>]*playlist-card-media/);
    expect(html).toMatch(
      /<img[^>]*src="https:\/\/img\.example\/cover\.jpg"[^>]*>/,
    );
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain('alt="Neon Nights cover art"');
    expect(html).toContain('class="cover-img"');
  });

  it('falls back to the placeholder when no image URL exists', () => {
    const html = renderToString(
      <PlaylistCard playlist={pl({ images: [] })} />,
    );
    expect(html).not.toContain('<img');
    expect(html).toMatch(/<div[^>]*cover-placeholder/);
    expect(html).toContain('aria-label="Neon Nights has no cover art"');
  });

  it('shows the playlist name and a track-count subtitle', () => {
    const html = renderToString(<PlaylistCard playlist={pl()} />);
    expect(html).toMatch(/<p[^>]*playlist-name[^>]*>Neon Nights<\/p>/);
    expect(html).toMatch(/<p[^>]*playlist-subtitle text-small[^>]*>12 tracks<\/p>/);
  });

  it('singularises the subtitle for a one-track playlist', () => {
    const html = renderToString(
      <PlaylistCard playlist={pl({ tracks: { total: 1 } })} />,
    );
    expect(html).toContain('>1 track</p>');
  });

  it('omits the subtitle when the playlist has no tracks.total', () => {
    const html = renderToString(
      <PlaylistCard playlist={pl({ tracks: undefined })} />,
    );
    expect(html).not.toContain('playlist-subtitle');
  });

  it('renders as a button with onOpen and as a static article without', () => {
    const withClick = renderToString(
      <PlaylistCard playlist={pl()} onOpen={() => {}} />,
    );
    expect(withClick).toMatch(/<button[^>]*playlist-card-btn/);
    expect(withClick).not.toContain('<article');

    const bare = renderToString(<PlaylistCard playlist={pl()} />);
    expect(bare).toMatch(/<article[^>]*playlist-card/);
    expect(bare).not.toContain('<button');
  });
});

describe('PlaylistGrid', () => {
  it('renders one card per playlist inside the grid container', () => {
    const html = renderToString(
      <PlaylistGrid
        playlists={[pl({ id: 'pl-1' }), pl({ id: 'pl-2', name: 'Second' })]}
        loading={false}
        error={null}
        onRetry={() => {}}
        onOpenPlaylist={() => {}}
      />,
    );
    expect(html).toMatch(/<div[^>]*playlist-grid/);
    expect(html).toContain('>Neon Nights<');
    expect(html).toContain('>Second<');
    expect((html.match(/playlist-card-btn/g) ?? []).length).toBe(2);
    // Without onOpenPlaylist the cards degrade to static <article>s (P005).
    const bare = renderToString(
      <PlaylistGrid
        playlists={[pl()]}
        loading={false}
        error={null}
        onRetry={() => {}}
      />,
    );
    expect(bare).not.toContain('playlist-card-btn');
  });

  it('keeps the loading, error, and empty states', () => {
    const loading = renderToString(
      <PlaylistGrid playlists={[]} loading error={null} onRetry={() => {}} />,
    );
    expect(loading).toContain('role="status"');

    const error = renderToString(
      <PlaylistGrid
        playlists={[]}
        loading={false}
        error="Spotify hiccuped"
        onRetry={() => {}}
      />,
    );
    expect(error).toContain('role="alert"');
    expect(error).toContain('Try again');

    const empty = renderToString(
      <PlaylistGrid playlists={[]} loading={false} error={null} onRetry={() => {}} />,
    );
    expect(empty).toContain('role="status"');
  });
});

describe('playlist card + grid CSS (polished interaction language)', () => {
  const css = readFileSync(
    new URL('../styles/base.css', import.meta.url).pathname,
    'utf8',
  );

  it('uses a CSS grid with auto-fill minmax columns, not flex-wrap', () => {
    const gridBlock = css.slice(
      css.indexOf('.playlist-grid {'),
      css.indexOf('.playlist-card-btn,'),
    );
    expect(gridBlock).toContain('display: grid');
    expect(gridBlock).toContain('repeat(auto-fill, minmax(180px, 1fr))');
    expect(gridBlock).not.toContain('flex-wrap');
  });

  it('defines hover lift + neon pink border glow with smooth transitions', () => {
    expect(css).toContain('.playlist-card-btn:hover {');
    const hoverBlock = css.slice(
      css.indexOf('.playlist-card-btn:hover {'),
      css.indexOf('.playlist-card-btn:active'),
    );
    expect(hoverBlock).toContain('border-color: var(--neon-pink)');
    expect(hoverBlock).toContain('box-shadow: var(--shadow-glow-pink)');
    expect(hoverBlock).toContain('transform: translateY(-3px)');
    // Smooth colour+scale transitions live on the shared card block (D009).
    const sharedBlock = css.slice(
      css.indexOf('.playlist-card-btn,\n.playlist-card {'),
      css.indexOf('.playlist-card-btn {'),
    );
    expect(sharedBlock).toContain('transition: transform 0.18s ease');
    expect(sharedBlock).toContain('background-color 0.18s ease');
  });

  it('defines a :focus-visible neon ring on the interactive card', () => {
    const focusBlock = css.slice(css.indexOf('.playlist-card-btn:focus-visible'));
    expect(focusBlock).toContain('box-shadow: var(--shadow-focus)');
  });

  it('keeps the cover in an aspect-ratio box and the subtitle solid neon', () => {
    expect(css).toContain('.playlist-card-media {');
    expect(css).toContain('aspect-ratio: 1 / 1');

    const subtitleBlock = css.slice(css.indexOf('.playlist-subtitle {'));
    expect(subtitleBlock).toContain('color: var(--neon-pink)');
    expect(subtitleBlock).not.toContain('text-shadow');
  });
});
