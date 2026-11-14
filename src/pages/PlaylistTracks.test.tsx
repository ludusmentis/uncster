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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactTestInstance } from 'react-test-renderer';
import { renderToString } from 'react-dom/server';
import TestRenderer, { act } from 'react-test-renderer';
import { PlayerProvider } from '../playback/PlayerProvider';
import type { UseSpotifyPlayerResult } from '../playback/useSpotifyPlayer';
import PlaylistTracks from './PlaylistTracks';
import { playTrack } from '../playback/playTrack';
import { fetchAllPlaylistTracks, type SpotifyTrackItem } from '../api/tracks';

/* ------------------------------------------------------------------ */
/* S03-T3: interaction mocks.                                          */
/*                                                                      */
/* useSpotifyPlayer is mocked at module level so the real PlayerProvider */
/* stays in the tree (D012 surface) while tests drive the player state */
/* via the mutable object below; playTrack and fetchAllPlaylistTracks  */
/* are stubbed so the component logic — not network — is what's tested. */
/* ------------------------------------------------------------------ */

/** Mutable player state the mocked hook hands to PlayerProvider. */
const playerState: UseSpotifyPlayerResult = {
  deviceId: 'dev-1',
  isReady: true,
  isPaused: true,
  currentTrack: null,
  error: null,
  activateElement: vi.fn(),
  togglePlay: vi.fn(),
};

vi.mock('../playback/useSpotifyPlayer', () => ({
  useSpotifyPlayer: vi.fn((): UseSpotifyPlayerResult => playerState),
}));

vi.mock('../playback/playTrack', () => ({
  playTrack: vi.fn(async () => undefined),
}));

vi.mock('../api/tracks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/tracks')>();
  return {
    ...actual,
    // Populated per-test below (the vi.mock factory is hoisted above the
    // fixture definitions, so it must not close over them).
    fetchAllPlaylistTracks: vi.fn(async () => [] as SpotifyTrackItem[]),
  };
});

function makeTrack(id: string, name: string, uri?: string): NonNullable<SpotifyTrackItem['item']> {
  return {
    id,
    name,
    ...(uri ? { uri } : {}),
    artists: [{ id: `${id}-artist`, name: 'Artist' }],
    album: {
      images: [{ url: `https://img.example/${id}`, height: 300, width: 300 }],
      release_date: '2024-05-01',
      release_date_precision: 'day' as const,
    },
    type: 'track' as const,
  };
}

const trackOne = makeTrack('t1', 'Neon Nights', 'spotify:track:t1');
const trackTwo = makeTrack('t2', 'Laser Dreams', 'spotify:track:t2');
const noUriTrack = makeTrack('t3', 'Missing URI');

const fixtureItems: SpotifyTrackItem[] = [
  { item: trackOne },
  { item: trackTwo },
  { item: noUriTrack },
  { item: null },
];

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

interface CoverButton {
  label: string;
  overlay: string;
  disabled: boolean;
  title: string | undefined;
  click(): void;
}

/**
 * Render PlaylistTracks interactively (S03-T3). The harness exposes the
 * cover-art buttons in row order; state changes are driven by mutating
 * `playerState` and calling rerender() so the component recomputes its
 * overlay state from the context (D012).
 */
async function renderTracksInteractive(): Promise<{
  buttons(): CoverButton[];
  rerender(): Promise<void>;
  unmount(): Promise<void>;
}> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <PlayerProvider authed>
        <PlaylistTracks id="pl-1" />
      </PlayerProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });

  const buttons = (): CoverButton[] =>
    renderer.root
      .findAll(
        (node) =>
          typeof node.type === 'string' &&
          String((node as ReactTestInstance).props?.className ?? '').startsWith('track-cover-btn'),
      )
      .map((node) => ({
        label: String(node.props['aria-label']),
        overlay: String(
          (node.children[1] as ReactTestInstance | undefined)?.props?.children ?? '',
        ),
        disabled: Boolean(node.props['aria-disabled']),
        title: node.props.title as string | undefined,
        click: () => {
          node.props.onClick();
        },
      }));

  return {
    buttons,
    async rerender(): Promise<void> {
      await act(async () => {
        renderer.update(
          <PlayerProvider authed>
            <PlaylistTracks id="pl-1" />
          </PlayerProvider>,
        );
      });
    },
    async unmount(): Promise<void> {
      await act(async () => {
        renderer.unmount();
      });
    },
  };
}

/** Reset the mutable player state and call spies between tests. */
function resetPlayerState(): void {
  vi.mocked(fetchAllPlaylistTracks).mockResolvedValue(fixtureItems);
  Object.assign(playerState, {
    deviceId: 'dev-1',
    isReady: true,
    isPaused: true,
    currentTrack: null,
    error: null,
  });
  vi.mocked(playerState.activateElement).mockClear();
  vi.mocked(playerState.togglePlay).mockClear();
  vi.mocked(playTrack).mockClear();
  vi.mocked(fetchAllPlaylistTracks).mockClear();
}

describe('PlaylistTracks cover-art playback interaction (M005 / S03-T3)', () => {
  beforeEach(() => {
    resetPlayerState();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders an idle ▶ overlay with a Play label for every playable track', async () => {
    const { buttons, unmount } = await renderTracksInteractive();
    // t1, t2 (with uris) and t3 (no uri — still a rendered button) are
    // playable rows; the null-track row renders no button at all.
    expect(buttons()).toHaveLength(3);
    for (const [i, name] of ['Neon Nights', 'Laser Dreams', 'Missing URI'].entries()) {
      expect(buttons()[i]).toMatchObject({
        overlay: '▶',
        label: `Play ${name}`,
        disabled: false,
      });
    }
    await unmount();
  });

  it('shows ⏸/Pause only on the playing track; paused current track reverts to ▶', async () => {
    const { buttons, rerender, unmount } = await renderTracksInteractive();
    playerState.currentTrack = { uri: 'spotify:track:t1', name: 'Neon Nights' } as Spotify.WebPlaybackTrack;
    playerState.isPaused = false;
    await rerender();

    expect(buttons()[0]).toMatchObject({ overlay: '⏸', label: 'Pause Neon Nights' });
    expect(buttons()[1]).toMatchObject({ overlay: '▶', label: 'Play Laser Dreams' });

    // Paused: the current track is no longer "playing", so its overlay
    // reverts to play.
    playerState.isPaused = true;
    await rerender();
    expect(buttons()[0]).toMatchObject({ overlay: '▶', label: 'Play Neon Nights' });
    await unmount();
  });

  it('clicking a non-playing track activates the element and calls playTrack with the single-uri payload', async () => {
    const { buttons, unmount } = await renderTracksInteractive();
    await act(async () => {
      buttons()[1].click();
    });

    // Autoplay unlock happens in the click handler before the API call.
    expect(playerState.activateElement).toHaveBeenCalledTimes(1);
    expect(playTrack).toHaveBeenCalledWith('spotify:track:t2', 'dev-1');
    expect(playTrack).toHaveBeenCalledTimes(1);
    // Exactly one request: the previous track was never started here, and
    // the payload is a single uris array (D011) asserted in playTrack's own
    // tests; here we pin the (trackUri, deviceId) contract.
    expect(playerState.togglePlay).not.toHaveBeenCalled();
    await unmount();
  });

  it('matches the playing track via linked_from when Spotify relinked it to a variant URI', async () => {
    // Live bug (M005 validation): playback of a relinked track reports a
    // different current_track.uri than the playlist row's track.uri, so the
    // overlay stayed ▶ and re-clicks restarted the song. The SDK hands back
    // the original URI via linked_from.
    const { buttons, rerender, unmount } = await renderTracksInteractive();
    playerState.currentTrack = {
      uri: 'spotify:track:RELINKED_VARIANT',
      linked_from: { uri: 'spotify:track:t1' },
      name: 'Neon Nights',
    } as Spotify.WebPlaybackTrack;
    playerState.isPaused = false;
    await rerender();

    expect(buttons()[0]).toMatchObject({ overlay: '⏸', label: 'Pause Neon Nights' });
    await act(async () => {
      buttons()[0].click();
    });
    expect(playerState.togglePlay).toHaveBeenCalledTimes(1);
    expect(playTrack).not.toHaveBeenCalled();
    await unmount();
  });

  it('clicking the playing track toggles pause/resume instead of calling playTrack', async () => {
    const { buttons, rerender, unmount } = await renderTracksInteractive();
    playerState.currentTrack = { uri: 'spotify:track:t1', name: 'Neon Nights' } as Spotify.WebPlaybackTrack;
    playerState.isPaused = false;
    await rerender();

    await act(async () => {
      buttons()[0].click();
    });
    expect(playerState.togglePlay).toHaveBeenCalledTimes(1);
    expect(playTrack).not.toHaveBeenCalled();
    await unmount();
  });

  it('clicking another track while one plays calls playTrack for the new track only', async () => {
    const { buttons, rerender, unmount } = await renderTracksInteractive();
    playerState.currentTrack = { uri: 'spotify:track:t1', name: 'Neon Nights' } as Spotify.WebPlaybackTrack;
    playerState.isPaused = false;
    await rerender();

    await act(async () => {
      buttons()[1].click();
    });
    expect(playTrack).toHaveBeenCalledTimes(1);
    expect(playTrack).toHaveBeenCalledWith('spotify:track:t2', 'dev-1');
    expect(playerState.togglePlay).not.toHaveBeenCalled();
    await unmount();
  });

  it('is a logged no-op with a connecting hint while the device is not ready', async () => {
    const { buttons, rerender, unmount } = await renderTracksInteractive();
    playerState.isReady = false;
    playerState.deviceId = null;
    await rerender();

    const first = buttons()[0];
    expect(first.disabled).toBe(true);
    expect(first.title).toBe('Connecting to Spotify…');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await act(async () => {
      first.click();
    });
    expect(infoSpy).toHaveBeenCalledWith(
      '[tracks] playback click ignored — player not ready',
    );
    expect(playTrack).not.toHaveBeenCalled();
    expect(playerState.togglePlay).not.toHaveBeenCalled();
    expect(playerState.activateElement).not.toHaveBeenCalled();
    infoSpy.mockRestore();
    await unmount();
  });

  it('clicking a track without a uri activates the element but never calls playTrack', async () => {
    const { buttons, unmount } = await renderTracksInteractive();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      buttons()[2].click(); // t3 — 'Missing URI'
    });
    expect(playerState.activateElement).toHaveBeenCalledTimes(1);
    expect(playTrack).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[tracks] track has no uri — cannot start playback',
      't3',
    );
    warnSpy.mockRestore();
    await unmount();
  });

  it('renders null-track rows as non-interactive placeholders, not buttons', async () => {
    // Re-render the fixture tree with the provider so usePlayer resolves;
    // the null-track row must have an aria-labelled role="img" placeholder
    // and no Play/Pause surface for it anywhere in the tree.
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <PlayerProvider authed>
          <PlaylistTracks id="pl-1" />
        </PlayerProvider>,
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    const nullPlaceholder = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        (node as ReactTestInstance).props?.['aria-label'] === 'Unavailable track',
    );
    expect(nullPlaceholder).toHaveLength(1);
    expect(nullPlaceholder[0].props.role).toBe('img');
    // No playable surface anywhere references the unavailable row.
    const coverButtons = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '').startsWith('track-cover-btn'),
    );
    expect(coverButtons).toHaveLength(3); // t1, t2, t3 only
    await act(async () => {
      r.unmount();
    });
  });
});

/**
 * S03-T2: PlaylistTracks reads player state via usePlayer(), so it must
 * render inside <PlayerProvider>. renderToString never runs effects, so
 * the provider's SDK-loading effect is inert here and the component stays
 * in its initial loading state — the surface under test.
 */
function renderTracks(id: string): string {
  return renderToString(
    <PlayerProvider authed>
      <PlaylistTracks id={id} />
    </PlayerProvider>,
  );
}

describe('Play CTA above the track list (M004 / S02-T3)', () => {
  it('renders the CTA above the heading and the loading track list', () => {
    const html = renderTracks('pl-1');
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
    const html = renderTracks('pl-1');
    const backAt = html.indexOf('Back to playlists');
    const ctaAt = html.indexOf('Play with this playlist');
    expect(ctaAt).toBeGreaterThan(backAt);
  });
});

describe('PlaylistTracks skeleton state (03-3-T3)', () => {
  it('renders shimmer skeleton rows while loading', () => {
    const html = renderTracks('pl-1');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading tracks"');
    expect((html.match(/skeleton-track-row/g) ?? []).length).toBe(8);
    expect(html).toContain('skeleton-cover');
    expect(html).toContain('skeleton-year');
    // Bare loading text line is gone.
    expect(html).not.toContain('Loading tracks…');
  });

  it('keeps the back-row navigation and heading', () => {
    const html = renderTracks('pl-1');
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

/* ------------------------------------------------------------------ */
/* S02-T2: period histogram + balance assessment (D018/D019/D021).      */
/*                                                                     */
/* fixtureItems are all released 2024 → one decade bin, span 0 →       */
/* balancedness Excellent but period-length Bad → the combined         */
/* warning (D021) must fire (badge + banner). The evenSpread fixture    */
/* spans 1965–2020 across seven decades, all non-empty → Excellent     */
/* balance, Fair period (55y) → no warning. releaseYear is the real     */
/* implementation (vi.mock spreads importOriginal).                     */
/* ------------------------------------------------------------------ */

import PeriodHistogram from '../components/PeriodHistogram';

function makeDatedTrack(id: string, releaseDate: string): NonNullable<SpotifyTrackItem['item']> {
  return {
    id,
    name: `Track ${id}`,
    artists: [{ id: `${id}-a`, name: 'Artist' }],
    album: {
      images: [],
      release_date: releaseDate,
      release_date_precision: 'day' as const,
    },
    type: 'track' as const,
  };
}

/** 1965–2020, at least one track per decade → 7/7 bins covered, span 55. */
const evenSpreadYears = [
  '1965-03-01', '1972-06-01', '1975-09-01',
  '1981-02-01', '1985-05-01', '1989-08-01',
  '1992-04-01', '1996-07-01', '1999-10-01',
  '2003-01-01', '2007-06-01', '2010-09-01',
  '2013-03-01', '2017-11-01', '2020-02-01',
];

const evenSpreadItems: SpotifyTrackItem[] = evenSpreadYears.map((d, i) => ({
  item: makeDatedTrack(`ev-${i}`, d),
}));

/** All-years-missing fixture: release_year '—' only. */
const missingYearItems: SpotifyTrackItem[] = [1, 2].map((i) => ({
  item: makeDatedTrack(`mi-${i}`, ''),
}));

describe('PeriodHistogram component (S02-T2)', () => {
  it('renders the neutral unavailable note when no parseable years exist', () => {
    const html = renderToString(<PeriodHistogram items={missingYearItems} />);
    expect(html).toContain('Assessment unavailable');
    expect(html).toContain('period-histogram--unavailable');
    expect(html).not.toContain('histogram-bar');
  });

  it('renders bars per decade, span, and both verdicts for a good playlist', () => {
    const html = renderToString(<PeriodHistogram items={evenSpreadItems} />);
    expect((html.match(/histogram-bar/g) ?? []).length).toBe(7);
    expect(html).toContain('1960s');
    expect(html).toContain('2020s');
    // renderToString interleaves `<!-- -->` markers between expressions,
    // so assert the span pieces, not the contiguous string.
    expect(html).toContain('1965');
    expect(html).toContain('2020');
    expect(html).toContain('55');
    expect(html).toContain('years');
    expect(html).toContain('Excellent'); // balancedness
    expect(html).toContain('Fair'); // period length
    // No combined warning: balance Excellent, period Fair (D021).
    expect(html).not.toContain('alert--warning');
  });

  it('renders the non-blocking badly-balanced banner for a single-year playlist', () => {
    const html = renderToString(<PeriodHistogram items={fixtureItems} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('alert--warning');
    expect(html).toContain('badly balanced for the game');
    // Warn never blocks: no disabled surface in the banner.
    expect(html).not.toContain('disabled');
  });
});

describe('PlaylistTracks histogram + warning badge (M006 / S02-T2)', () => {
  it('shows histogram and verdicts in the loaded non-empty state, and the Start Game button stays enabled', async () => {
    vi.mocked(fetchAllPlaylistTracks).mockResolvedValue(fixtureItems);
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <PlayerProvider authed>
          <PlaylistTracks id="pl-1" />
        </PlayerProvider>,
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    const histogram = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '').startsWith('period-histogram'),
    );
    expect(histogram).toHaveLength(1);
    // fixtureItems are all 2024 → one decade bin (2020s) and a Bad period
    // verdict (span 0). Text nodes are symbol-typed instances here, so read
    // the labels off their element instances directly.
    const binLabels = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '') === 'histogram-bin-label',
    );
    expect(binLabels.map((n) => String(n.children[0]))).toEqual(['2020s']);
    const verdicts = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '').includes('verdict--'),
    );
    expect(verdicts.map((n) => String(n.children[0]))).toContain('Bad');

    // Badly balanced fixture (span 0 → period Bad) also shows the badge,
    // and the Start Game button is never disabled (D021).
    const badge = r.root.find(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '') === 'badge badge--warning',
    );
    expect(String(badge.children[0])).toContain('Badly balanced');
    const startBtn = r.root.find(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '') === 'btn btn-primary',
    );
    expect(startBtn.props.disabled).toBeUndefined();
    await act(async () => {
      r.unmount();
    });
  });

  it('omits the warning badge for an even-spread playlist but keeps the histogram', async () => {
    vi.mocked(fetchAllPlaylistTracks).mockResolvedValue(evenSpreadItems);
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <PlayerProvider authed>
          <PlaylistTracks id="pl-1" />
        </PlayerProvider>,
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    const badges = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '').includes('badge--warning'),
    );
    expect(badges).toHaveLength(0);
    const histogram = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '').startsWith('period-histogram'),
    );
    expect(histogram).toHaveLength(1);
    await act(async () => {
      r.unmount();
    });
  });

  it('renders no histogram in the empty state', async () => {
    vi.mocked(fetchAllPlaylistTracks).mockResolvedValue([]);
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = TestRenderer.create(
        <PlayerProvider authed>
          <PlaylistTracks id="pl-empty" />
        </PlayerProvider>,
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    const histogram = r.root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        String((node as ReactTestInstance).props?.className ?? '').startsWith('period-histogram'),
    );
    expect(histogram).toHaveLength(0);
    // Empty-state surface (role=status) renders instead — no crash.
    expect(
      r.root.findAll(
        (node) => typeof node.type === 'string' && (node as ReactTestInstance).props?.role === 'status',
      ).length,
    ).toBeGreaterThan(0);
    await act(async () => {
      r.unmount();
    });
  });
});
