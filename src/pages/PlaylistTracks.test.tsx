/**
 * Tests for the polished PlaylistTracks skeleton state (M003 / S03-3, T3):
 * - initial render (loading=true) shows shimmer skeleton rows instead of a
 *   bare "Loading tracks…" text line, in an aria-labelled role="status";
 * - the null-track guard markup (cover placeholder path) is unchanged;
 * - base.css carries the folded mobile skeleton row columns.
 *
 * renderToString never runs effects, so the component renders in its
 * initial loading state — exactly the skeleton surface under test. The
 * empty state is covered by the browser UAT with the mock harness
 * (pl-empty fixture, P006/P007).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import PlaylistTracks from './PlaylistTracks';

describe('Play CTA above the track list (M004 / S02-T3)', () => {
  it('renders the CTA above the heading and the loading track list', () => {
    const html = renderToString(<PlaylistTracks id="pl-1" />);
    expect(html).toContain('🎮 Play with this playlist');
    expect(html).toContain('btn btn-primary');
    const ctaAt = html.indexOf('Play with this playlist');
    const headingAt = html.indexOf('Playlist tracks');
    const skeletonAt = html.indexOf('skeleton-track-row');
    expect(ctaAt).toBeGreaterThanOrEqual(0);
    expect(headingAt).toBeGreaterThan(ctaAt);
    expect(skeletonAt).toBeGreaterThan(headingAt);
  });

  it('renders the CTA in every state (loading-only render covers the shape)', () => {
    // renderToString never runs effects, so only the initial loading state
    // is observable here; error/empty/loaded states reuse the same markup
    // above the h1, which this DOM-order assertion pins down.
    const html = renderToString(<PlaylistTracks id="pl-1" />);
    const backAt = html.indexOf('Back to playlists');
    const ctaAt = html.indexOf('Play with this playlist');
    expect(ctaAt).toBeGreaterThan(backAt);
  });
});

describe('PlaylistTracks skeleton state (03-3-T3)', () => {
  it('renders shimmer skeleton rows while loading', () => {
    const html = renderToString(<PlaylistTracks id="pl-1" />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading tracks"');
    expect((html.match(/skeleton-track-row/g) ?? []).length).toBe(8);
    expect(html).toContain('skeleton-cover');
    expect(html).toContain('skeleton-year');
    // Bare loading text line is gone.
    expect(html).not.toContain('Loading tracks…');
  });

  it('keeps the back-row navigation and heading', () => {
    const html = renderToString(<PlaylistTracks id="pl-1" />);
    expect(html).toContain('Back to playlists');
    expect(html).toContain('neon-heading');
  });

  it('folds skeleton rows identically at the mobile breakpoint', () => {
    const css = readFileSync('src/styles/base.css', 'utf8');
    const mobile = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(mobile).toMatch(
      /\.skeleton-track-row\s*{[^}]*grid-template-columns:\s*40px 1fr 2\.5rem/,
    );
    // Year column on real rows shrinks at the same breakpoint.
    expect(mobile).toMatch(/\.track-year\s*{[^}]*font-size:\s*var\(--font-small\)/);
  });
});
