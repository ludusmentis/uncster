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
