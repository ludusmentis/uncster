/**
 * Tests for the app chrome components (M003 / S03-2, T1):
 * - Header renders the Monoton 'Uncster' wordmark as a keyboard-navigable
 *   button, showing display name + Log out when authed, and Connect /
 *   Reconnect Spotify when unauthed (props-driven, no new data fetching).
 * - HeroTagline renders the fixed tagline copy with the neon-heading class.
 * - PageShell wraps children in the shared .container shell.
 * - base.css defines the glow-pulse keyframes and the prefers-reduced-motion
 *   guard, so the pulse is visible but reduced-motion-safe.
 *
 * Rendering uses react-dom/server renderToString (node environment — no
 * jsdom dependency needed for markup assertions; event wiring goes through
 * navigate(), already covered by routing.test.ts). The stylesheet is read
 * via node:fs (minimally declared in src/types/raw-css.d.ts, as the project
 * ships without @types/node); Vitest's default CSS handling stubs ?raw
 * imports to empty strings, so raw fs reading is the reliable route.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import Header from './Header';
import HeroTagline from './HeroTagline';
import PageShell from './PageShell';

const noop = (): void => {};

function renderHeader(overrides: Partial<Parameters<typeof Header>[0]> = {}) {
  return renderToString(
    <Header
      authed={false}
      displayName={null}
      onConnect={noop}
      onLogout={noop}
      {...overrides}
    />,
  );
}

describe('Header (app chrome)', () => {
  it('renders the pulsing Monoton wordmark as a home-navigable button', () => {
    const html = renderHeader({ authed: false });
    expect(html).toContain('<header');
    expect(html).toContain('app-header container');
    // Wordmark: real button (keyboard-navigable), pulse + neon-title classes.
    expect(html).toMatch(/<button[^>]*header-wordmark neon-title neon-pulse/);
    expect(html).toContain('>Uncster</button>');
    expect(html).toContain('aria-label="Uncster — back to home"');
  });

  it('shows display name + Log out pill when authed', () => {
    const html = renderHeader({
      authed: true,
      displayName: 'Mock User',
    });
    expect(html).toContain('Signed in as <strong>Mock User</strong>');
    expect(html).toContain('Log out');
    expect(html).not.toContain('Connect Spotify');
    expect(html).not.toContain('Reconnect Spotify');
  });

  it('falls back to the generic signed-in label when displayName is null', () => {
    const html = renderHeader({ authed: true, displayName: null });
    expect(html).toContain('Signed in as <strong>a Spotify user</strong>');
  });

  it('shows Connect Spotify when unauthed and never connected', () => {
    const html = renderHeader({ authed: false });
    expect(html).toContain('Connect Spotify');
    expect(html).not.toContain('Log out');
  });

  it('flips the label to Reconnect Spotify once everConnected is true', () => {
    const html = renderHeader({ authed: false, everConnected: true });
    expect(html).toContain('Reconnect Spotify');
    expect(html).not.toContain('>Connect Spotify<');
  });

  it('marks the connect button as the primary pill action', () => {
    const html = renderHeader({ authed: false });
    expect(html).toMatch(/<button[^>]*btn btn-primary[^>]*>Connect Spotify</);
  });
});

describe('HeroTagline', () => {
  it('renders the fixed tagline copy with the neon-heading glow class', () => {
    const html = renderToString(<HeroTagline />);
    expect(html).toContain('neon-heading hero-tagline');
    expect(html).toContain('Your playlists called. They want receipts.');
  });
});

describe('PageShell', () => {
  it('wraps children in the shared container shell', () => {
    const html = renderToString(
      <PageShell>
        <p>route content</p>
      </PageShell>,
    );
    expect(html).toContain('container page-shell');
    expect(html).toContain('route content');
  });
});

describe('glow-pulse CSS (pulse visible, reduced-motion safe)', () => {
  const css = readFileSync(
    new URL('../styles/base.css', import.meta.url).pathname,
    'utf8',
  );

  it('defines a single glow-pulse keyframe animating text-shadow intensity', () => {
    expect(css).toMatch(/@keyframes glow-pulse\s*{/);
    const keyframeStart = css.indexOf('@keyframes glow-pulse');
    const keyframeBlock = css.slice(keyframeStart, keyframeStart + 800);
    expect(keyframeBlock).toContain('0%');
    expect(keyframeBlock).toContain('50%');
    expect((keyframeBlock.match(/text-shadow/g) ?? []).length).toBe(2);
    // Exactly two keyframe blocks in the stylesheet: glow-pulse (header wordmark)
    // and shimmer (03-3-T3 skeleton placeholders). Neither animates anything
    // else, so the pulse stays the only text-shadow animation.
    expect((css.match(/@keyframes/g) ?? []).length).toBe(2);
    expect((css.match(/@keyframes glow-pulse/g) ?? []).length).toBe(1);
    expect((css.match(/@keyframes shimmer/g) ?? []).length).toBe(1);
    // shimmer animates background-position only — never a text-shadow.
    const shimmerBlock = css.slice(
      css.indexOf('@keyframes shimmer'),
      css.indexOf('@keyframes shimmer') + 300,
    );
    expect(shimmerBlock).toContain('background-position');
    expect(shimmerBlock).not.toContain('text-shadow');
  });

  it('applies the pulse via the .neon-pulse class on the wordmark stack', () => {
    expect(css).toMatch(/\.neon-pulse\s*{[^}]*animation:\s*glow-pulse/);
  });

  it('respects prefers-reduced-motion by disabling the animation', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*{[^@]*\.neon-pulse\s*{[^}]*animation:\s*none/,
    );
  });

  it('keeps the wordmark Monoton-sized at the 44px token', () => {
    expect(css).toMatch(/\.neon-title\s*{[^}]*font-size:\s*var\(--font-wordmark\)/);
  });
});
