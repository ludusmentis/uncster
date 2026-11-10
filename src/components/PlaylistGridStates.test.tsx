/**
 * State tests for the polished PlaylistGrid (M003 / S03-3, T3):
 * - loading renders shimmer skeleton cards (8 of them, aria-labelled
 *   role="status") in the same .playlist-grid shape as loaded cards;
 * - empty renders the refined empty state (icon + friendly copy) instead
 *   of a bare text line;
 * - base.css defines the shimmer keyframes + .skeleton animation, disables
 *   it under prefers-reduced-motion, and carries the responsive
 *   breakpoints: 2-column grid at 480px and a denser tablet minmax.
 *
 * Rendering uses react-dom/server renderToString (node environment, same
 * pattern as PlaylistCard.test.tsx); the stylesheet is read via node:fs.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import PlaylistGrid from './PlaylistGrid';
import type { SpotifyPlaylist } from '../api/playlists';

const pl: SpotifyPlaylist = {
  id: 'pl-1',
  name: 'Neon Nights',
  images: [],
  tracks: { total: 12 },
};

describe('PlaylistGrid states (03-3-T3)', () => {
  it('renders shimmer skeleton cards while loading', () => {
    const html = renderToString(
      <PlaylistGrid
        playlists={[]}
        loading
        error={null}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading your playlists"');
    expect((html.match(/skeleton-card/g) ?? []).length).toBe(8);
    // Skeleton media box mirrors the card's aspect-ratio cover shape.
    expect(html).toContain('skeleton-media');
    expect(html).toContain('skeleton-line--short');
    // No bare "Loading your playlists…" text line anymore.
    expect(html).not.toContain('Loading your playlists…');
  });

  it('renders the refined empty state with icon and copy', () => {
    const html = renderToString(
      <PlaylistGrid
        playlists={[]}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );
    expect(html).toContain('empty-state');
    expect(html).toContain('empty-icon');
    expect(html).toContain('empty-title');
    // Friendly copy replaces the old bare line.
    expect(html).not.toContain(
      'No playlists yet — create one in Spotify',
    );
  });

  it('still renders real cards on success (T1 polish untouched)', () => {
    const html = renderToString(
      <PlaylistGrid
        playlists={[pl]}
        loading={false}
        error={null}
        onRetry={() => undefined}
        onOpenPlaylist={() => undefined}
      />,
    );
    expect(html).toContain('Neon Nights');
    expect(html).toContain('playlist-grid');
    expect(html).not.toContain('skeleton-card');
  });
});

describe('base.css skeletons + breakpoints (03-3-T3)', () => {
  const css = readFileSync('src/styles/base.css', 'utf8');

  it('defines shimmer animation for .skeleton and disables it on reduced motion', () => {
    expect(css).toContain('@keyframes shimmer');
    expect(css).toMatch(/\.skeleton\s*{[^}]*animation:\s*shimmer/);
    // Reduced-motion guard covers the skeleton shimmer too.
    const reduced = css.indexOf('(prefers-reduced-motion: reduce)');
    expect(reduced).toBeGreaterThan(-1);
    expect(css.slice(reduced).startsWith(
      '(prefers-reduced-motion: reduce)',
    )).toBe(true);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.skeleton\s*{[^}]*animation:\s*none/,
    );
  });

  it('collapses the grid to 2 columns and folds track rows at 480px', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(mobile).toContain(
      'grid-template-columns: repeat(2, minmax(0, 1fr))',
    );
    expect(mobile).toContain('display: none'); // .track-index folds away
    // Container padding shrinks on mobile.
    expect(mobile).toMatch(/\.page,\s*\.container\s*{[^}]*padding:\s*var\(--space-m\)/);
  });

  it('relaxes the grid minmax between 481px and 900px', () => {
    expect(css).toContain(
      '@media (min-width: 481px) and (max-width: 900px)',
    );
    expect(css).toContain('minmax(150px, 1fr)');
  });
});
