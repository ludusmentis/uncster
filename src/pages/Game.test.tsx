/**
 * Tests for the game view (M007 / S02, T02) — replaces MockGame tests.
 *
 * renderToString runs no effects, so the deck-injection seam (`deck`
 * prop) drives the board: with a pending GameConfig + injected deck the
 * turn board renders (player name, start-card row, track-row styling);
 * the hidden song renders as a pulsating ? box carrying ZERO metadata —
 * its title/artist/year must not appear anywhere in the DOM. With no
 * pending config the friendly fallback renders. Rendering performs no
 * fetches when a deck is injected.
 *
 * Both Game and setupStore keep module-level caches (StrictMode
 * take-once), so every test imports fresh modules via vi.resetModules +
 * dynamic import.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ComponentType } from 'react';
import type { GameConfig } from '../game/setupLogic';
import type { TurnSong } from '../game/turnEngine';

interface GameProps {
  deck?: TurnSong[];
}

const sampleConfig: GameConfig = {
  playlistId: 'pl-1',
  playlistName: 'Mock Playlist One',
  players: [
    { id: 'p-1', name: 'Orlo' },
    { id: 'p-2', name: 'Zeta' },
  ],
  songsToWin: 15,
};

const deck: TurnSong[] = [
  { name: 'Start Card Song', releaseYear: '2001' },
  { name: 'Hidden Song XYZ', releaseYear: '1999' },
  { name: 'Deck Song C', releaseYear: '2010' },
  { name: 'Deck Song D', releaseYear: '1985' },
];

async function fresh(setConfig: boolean): Promise<ComponentType<GameProps>> {
  vi.resetModules();
  const { default: Game } = await import('./Game');
  const setupStore = await import('../game/setupStore');
  if (setConfig) setupStore.setPendingGameConfig(sampleConfig);
  return Game;
}

describe('Game view (S02-T02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('renders the current player turn board with the start card and ? box', async () => {
    const Game = await fresh(true);
    const html = renderToString(<Game deck={deck} />);
    // Player name above their list (React inserts a comment node and
    // HTML-escapes the apostrophe between the two text segments).
    expect(html).toMatch(/Orlo(<!-- -->)?&#x27;s turn/);
    expect(html).toContain('game-player-name');
    // Start card (first drawn song) is in the list with track-row styling.
    expect(html).toContain('Start Card Song');
    expect(html).toContain('track-item');
    // Hidden song as a pulsating ? box at position 1 (opaque handle only).
    expect(html).toContain('game-hidden-slot');
    expect(html).toContain('game-hidden-glyph');
    expect(html).toContain('?');
  });

  it('leaks ZERO hidden-song metadata in the DOM', async () => {
    const Game = await fresh(true);
    const html = renderToString(<Game deck={deck} />);
    expect(html).not.toContain('Hidden Song XYZ');
    expect(html).not.toContain('1999');
    // The slot exposes only the opaque handle id.
    expect(html).toMatch(/data-hidden-id="turn:0:0:\d+"/);
  });

  it('renders the friendly fallback with no pending config', async () => {
    const Game = await fresh(false);
    const html = renderToString(<Game deck={deck} />);
    expect(html).toContain('No game in progress');
    expect(html).toContain('Back home');
    expect(html).not.toContain("Orlo's turn");
  });

  it('performs no fetches while rendering with an injected deck', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('Game must not fetch when the deck is injected');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const Game = await fresh(true);
    renderToString(<Game deck={deck} />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/* ---- S02-T04: outcome overlays, reveals, and Continue rotation ---- */

import TestRenderer, { act } from 'react-test-renderer';

function findFirst(
  root: TestRenderer.ReactTestRenderer,
  pred: (n: TestRenderer.ReactTestInstance) => boolean,
): TestRenderer.ReactTestInstance {
  const found = root.root.findAll(pred);
  expect(found.length).toBeGreaterThanOrEqual(1);
  return found[0];
}

function pressKey(node: TestRenderer.ReactTestInstance, key: string): void {
  act(() => {
    (node.props as { onKeyDown: (e: { key: string; preventDefault: () => void }) => void }).onKeyDown({
      key,
      preventDefault: () => {},
    });
  });
}

/** Concatenated text content (children joined) — immune to JSON splitting. */
function allText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(allText).join('');
  if (node !== null && typeof node === 'object' && 'children' in (node as Record<string, unknown>)) {
    return allText((node as { children?: unknown }).children);
  }
  return '';
}

describe('Game outcome overlays and Continue rotation (S02-T04)', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('renders no overlay while awaiting a drop', async () => {
    const Game = await fresh(true);
    const root = TestRenderer.create(<Game deck={deck} />);
    expect(root.root.findAll((n) => n.props.role === 'alertdialog')).toHaveLength(0);
  });

  it('wrong drop shows the fail overlay revealing correct position and year; Continue rotates to the next player', async () => {
    const Game = await fresh(true);
    const root = TestRenderer.create(<Game deck={deck} />);
    // Orlo's list: [Start Card Song 2001]; hidden: Hidden Song XYZ (1999).
    // Placing at index 1 (after 2001) is wrong — 1999 belongs before it.
    const handle = findFirst(root, (n) => 'data-hidden-id' in (n.props as Record<string, unknown>));
    pressKey(handle, 'Enter'); // keyboard default index 1 → wrong drop
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Wrong!');
    expect(text).toContain('Hidden Song XYZ');
    expect(text).toContain('1999');
    expect(allText(root.toJSON())).toContain('position 1'); // correct spot: before the 2001 card
    // The song is LOST — it never joined the list (only the start card).
    expect(text.match(/Start Card Song/g)?.length).toBe(1);
    // Overlay reveal only — no list row for the lost song.
    expect(text.match(/Hidden Song XYZ/g)?.length).toBe(1);
    // Accessibility contract on the overlay.
    expect(root.root.findAll((n) => n.props.role === 'alertdialog')).toHaveLength(1);

    // Continue rotates to Zeta (next player in creation order).
    const continueBtn = findFirst(
      root,
      (n) => typeof (n.props as { onClick?: unknown }).onClick === 'function'
        && String((n.props as { className?: string }).className ?? '').includes('btn'),
    );
    act(() => {
      (continueBtn.props as { onClick: (e: unknown) => void }).onClick({});
    });
    const after = JSON.stringify(root.toJSON());
    expect(allText(root.toJSON())).toContain("Zeta's turn");
    expect(after).not.toContain('alertdialog');
  });

  it('correct drop reveals the song in the list; Continue rotates; a single-player quick win reaches game over', async () => {
    vi.resetModules();
    const { default: Game } = await import('./Game');
    const setupStore = await import('../game/setupStore');
    setupStore.setPendingGameConfig({
      playlistId: 'pl-solo',
      playlistName: 'Solo Playlist',
      players: [{ id: 's-1', name: 'Solo' }],
      songsToWin: 1,
    });
    // Start card 2001; hidden 2010 → placing at index 1 (after) is correct.
    const soloDeck: TurnSong[] = [
      { name: 'Solo Start', releaseYear: '2001' },
      { name: 'Solo Hidden', releaseYear: '2010' },
      { name: 'Solo Filler', releaseYear: '1994' },
    ];
    const root = TestRenderer.create(<Game deck={soloDeck} />);
    const handle = findFirst(root, (n) => 'data-hidden-id' in (n.props as Record<string, unknown>));
    pressKey(handle, 'Enter'); // default index 1 → chronologically correct
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Correct!');
    expect(text).toContain('Solo Hidden');
    expect(text).toContain('2010');
    // The song JOINED the list (start card + revealed song) AND the overlay.
    expect(text.match(/Solo Start/g)?.length).toBe(1);
    expect(text.match(/Solo Hidden/g)?.length).toBe(2);

    // Continue: the solo player wins (2 >= 1) → every player has won → game over.
    const continueBtn = findFirst(
      root,
      (n) => typeof (n.props as { onClick?: unknown }).onClick === 'function'
        && String((n.props as { className?: string }).className ?? '').includes('btn'),
    );
    act(() => {
      (continueBtn.props as { onClick: (e: unknown) => void }).onClick({});
    });
    const after = JSON.stringify(root.toJSON());
    expect(after).toContain('Game over');
    expect(after).not.toContain("Solo's turn");
    expect(after).not.toContain('alertdialog');
  });
});

/* ---- S03-T02: bare /game refresh-resume via the active-game pointer ---- */

import {
  createTurnState,
  startTurn,
  drawHidden,
  drop,
  resolveTurn,
} from '../game/turnEngine';
import { saveGameState } from '../game/gameStateStore';

class MemoryLocalStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

const RESUME_CONFIG: GameConfig = {
  playlistId: 'pl-resume',
  playlistName: 'Resume Playlist',
  players: [
    { id: 'p-1', name: 'Orlo' },
    { id: 'p-2', name: 'Zeta' },
  ],
  songsToWin: 15,
};

const RESUME_DECK: TurnSong[] = [
  { name: 'Start Card Song', releaseYear: '2001' },
  { name: 'Hidden Song XYZ', releaseYear: '1999' },
  { name: 'Deck Song C', releaseYear: '2010' },
  { name: 'Deck Song D', releaseYear: '1985' },
];

/** Orlo's first turn resolved: Orlo keeps the start card + a won song;
 *  persist mid-turn with Zeta at awaiting-drop. */
function seedMidTurnSnapshot(): void {
  let state = createTurnState(
    RESUME_CONFIG.players.map((p) => ({ ...p, songs: [] })),
    RESUME_DECK,
    RESUME_CONFIG.songsToWin,
  );
  state = startTurn(state); // Orlo's start card dealt
  state = drawHidden(state); // Orlo's hidden song drawn
  state = drop(state, 0); // correct drop → Orlo keeps the song
  state = resolveTurn(state); // rotate to Zeta, phase start-card
  state = startTurn(state); // Zeta's start card dealt
  state = drawHidden(state); // Zeta's hidden song drawn → awaiting-drop
  saveGameState(RESUME_CONFIG.playlistId, RESUME_CONFIG, state);
}

describe('Game bare /game refresh-resume path (S03-T02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    (globalThis as Record<string, unknown>).localStorage = undefined;
  });

  it('resumes the persisted mid-turn snapshot without fetching: same player, same ? box at position 1, same lists', async () => {
    vi.resetModules();
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const store = await import('../game/gameStateStore');
    const { default: Game } = await import('./Game');
    seedMidTurnSnapshot(); // via the SAME module registry Game uses

    const fetchSpy = vi.fn(() => {
      throw new Error('Resume must not fetch — the snapshot deck is authoritative');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const html = renderToString(<Game />);
    // Zeta's turn reopens (rotation preserved through the refresh).
    expect(html).toMatch(/Zeta(<!-- -->)?&#x27;s turn/);
    // Zeta's start card (drawn pre-refresh) is in the list.
    expect(html).toContain('track-item');
    // The hidden song renders as the ? box at position 1 — ZERO metadata in the DOM:
    // Zeta's hidden song this turn is 'Deck Song D' (1985) — it must not appear,
    // while her start card 'Deck Song C' (drawn pre-refresh) does.
    expect(html).toContain('game-hidden-slot');
    expect(html).toMatch(/data-hidden-id="turn:1:0:\d+"/);
    expect(html).toContain('Deck Song C');
    expect(html).not.toContain('Deck Song D');
    expect(html).not.toContain('1985');
    expect(html).not.toContain('Hidden Song XYZ');
    expect(html).not.toContain('1999');
    expect(fetchSpy).not.toHaveBeenCalled();
    // The active-game pointer survives the resume render (game still in progress).
    expect(store.getActivePlaylistId()).toBe(RESUME_CONFIG.playlistId);
  });

  it('re-uses the resolve-once cache across a StrictMode double-invocation (same board both renders)', async () => {
    vi.resetModules();
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { default: Game } = await import('./Game');
    seedMidTurnSnapshot();

    const first = renderToString(<Game />);
    // Second render of the SAME module instance (StrictMode replay of the
    // lazy initializer): the module cache hands back the resolved entry
    // instead of re-reading a drained slot / cleared pointer.
    const second = renderToString(<Game />);
    expect(second).toMatch(/Zeta(<!-- -->)?&#x27;s turn/);
    expect(first).toContain('game-hidden-slot');
    expect(second).toContain('game-hidden-slot');
  });

  it('renders the graceful fallback and discards a stale-version snapshot', async () => {
    vi.resetModules();
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const store = await import('../game/gameStateStore');
    const { default: Game } = await import('./Game');
    storage.setItem('harlequin.game.active', RESUME_CONFIG.playlistId);
    storage.setItem(`harlequin.game.${RESUME_CONFIG.playlistId}`, JSON.stringify({
      version: 999, // stale envelope: version mismatch → discarded
      config: RESUME_CONFIG,
      state: {},
    }));

    const html = renderToString(<Game />);
    expect(html).toContain('No game in progress');
    expect(html).toContain('Back home');
    expect(html).not.toContain("Zeta's turn");
    // The stale game and its dangling pointer were discarded.
    expect(storage.getItem(`harlequin.game.${RESUME_CONFIG.playlistId}`)).toBeNull();
    expect(store.getActivePlaylistId()).toBeNull();
  });

  it('renders the graceful fallback on corrupt snapshot JSON without crashing', async () => {
    vi.resetModules();
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { default: Game } = await import('./Game');
    storage.setItem('harlequin.game.active', RESUME_CONFIG.playlistId);
    storage.setItem(`harlequin.game.${RESUME_CONFIG.playlistId}`, '{not json');

    const html = renderToString(<Game />);
    expect(html).toContain('No game in progress');
    expect(storage.getItem(`harlequin.game.${RESUME_CONFIG.playlistId}`)).toBeNull();
    expect(storage.getItem('harlequin.game.active')).toBeNull();
  });

  it('renders the graceful fallback when the pointer targets a missing snapshot', async () => {
    vi.resetModules();
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { default: Game } = await import('./Game');
    storage.setItem('harlequin.game.active', 'pl-ghost'); // dangling pointer

    const html = renderToString(<Game />);
    expect(html).toContain('No game in progress');
    expect(storage.getItem('harlequin.game.active')).toBeNull();
  });

  it('falls back when the only persisted game is already finished (game-over snapshot discarded)', async () => {
    vi.resetModules();
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const store = await import('../game/gameStateStore');
    const { default: Game } = await import('./Game');
    const finished = {
      ...createTurnState(
        RESUME_CONFIG.players.map((p) => ({ ...p, songs: [] })),
        RESUME_DECK,
        RESUME_CONFIG.songsToWin,
      ),
      finished: true,
      phase: 'game-over' as const,
      hiddenSong: null,
    };
    store.saveGameState(RESUME_CONFIG.playlistId, RESUME_CONFIG, finished);

    const html = renderToString(<Game />);
    expect(html).toContain('No game in progress');
    expect(store.getActivePlaylistId()).toBeNull();
    expect(storage.getItem(`harlequin.game.${RESUME_CONFIG.playlistId}`)).toBeNull();
  });
});

/* ---- S04-T2: per-turn playback — play at turn start, pause on drop ---- */

import type { UseSpotifyPlayerResult } from '../playback/useSpotifyPlayer';

const pb = vi.hoisted(() => ({
  state: {
    deviceId: 'dev-1',
    isReady: true,
    isPaused: true,
    currentTrack: null,
    error: null,
    activateElement: vi.fn(),
    togglePlay: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as UseSpotifyPlayerResult,
}));
vi.mock('../playback/useSpotifyPlayer', () => ({
  useSpotifyPlayer: () => pb.state,
}));
vi.mock('../playback/playTrack', () => ({
  playTrack: vi.fn(async () => undefined),
  PlayerNotReadyError: class PlayerNotReadyError extends Error {},
  PlayTrackError: class PlayTrackError extends Error {},
}));

const PB_CONFIG: GameConfig = {
  playlistId: 'pl-pb',
  playlistName: 'Playback Playlist',
  players: [
    { id: 'pb-1', name: 'Orlo' },
    { id: 'pb-2', name: 'Zeta' },
  ],
  songsToWin: 15,
};

// Start card drawn first, then the hidden song (engine draw order).
// The hidden song is relinked: linked_from-aware wiring must play the
// canonical URI, not the local-file URI.
const PB_DECK: TurnSong[] = [
  { name: 'PB Start', uri: 'spotify:track:pb-start', releaseYear: '2001' },
  {
    name: 'PB Hidden',
    uri: 'spotify:track:pb-hidden-local',
    linked_from: { uri: 'spotify:track:pb-hidden-canonical' },
    releaseYear: '1999',
  },
  { name: 'PB C', uri: 'spotify:track:pb-c', releaseYear: '2010' },
  { name: 'PB D', uri: 'spotify:track:pb-d', releaseYear: '1985' },
];

interface PbGameProps {
  deck?: TurnSong[];
}

async function freshPlayback(): Promise<{
  Game: ComponentType<PbGameProps>;
  PlayerProvider: (p: { authed: boolean; children: React.ReactNode }) => JSX.Element;
  playTrackMock: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  pb.state = {
    deviceId: 'dev-1',
    isReady: true,
    isPaused: true,
    currentTrack: null,
    error: null,
    activateElement: vi.fn(),
    togglePlay: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  } as unknown as UseSpotifyPlayerResult;
  const { PlayerProvider } = await import('../playback/PlayerProvider');
  const { default: Game } = await import('./Game');
  const setupStore = await import('../game/setupStore');
  const { playTrack } = await import('../playback/playTrack');
  // The vi.mock factory's spy survives vi.resetModules — reset call
  // history and restore the default resolve implementation per test.
  const playTrackMock = vi.mocked(playTrack);
  playTrackMock.mockReset();
  playTrackMock.mockImplementation(async () => undefined);
  setupStore.setPendingGameConfig(PB_CONFIG);
  return { Game, PlayerProvider, playTrackMock };
}

describe('Game per-turn playback wiring (S04-T2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    (globalThis as Record<string, unknown>).localStorage = undefined;
  });

  it('plays the full hidden track at turn start with the linked_from URI on the provider device', async () => {
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { Game, PlayerProvider, playTrackMock } = await freshPlayback();

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PlayerProvider authed>
          <Game deck={PB_DECK} />
        </PlayerProvider>,
      );
    });

    // Turn start → awaiting-drop: one playTrack with the canonical
    // (linked_from-aware) URI on the provider's device id.
    await act(async () => {});
    expect(playTrackMock).toHaveBeenCalledTimes(1);
    expect(playTrackMock).toHaveBeenCalledWith('spotify:track:pb-hidden-canonical', 'dev-1');
    expect(pb.state.togglePlay).not.toHaveBeenCalled();
    expect(pb.state.pause).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('pauses (never togglePlay) on every drop outcome and plays fresh from the beginning on the next turn', async () => {
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { Game, PlayerProvider, playTrackMock } = await freshPlayback();

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PlayerProvider authed>
          <Game deck={PB_DECK} />
        </PlayerProvider>,
      );
    });
    await act(async () => {});
    expect(playTrackMock).toHaveBeenCalledTimes(1);

    // WRONG drop (1999 placed after 2001): pause() fires — never togglePlay,
    // so a track that already ended naturally cannot restart under the overlay.
    const handle = findFirst(renderer, (n) => 'data-hidden-id' in (n.props as Record<string, unknown>));
    pressKey(handle, 'Enter'); // default index 1 → wrong
    expect(pb.state.pause).toHaveBeenCalledTimes(1);
    expect(pb.state.togglePlay).not.toHaveBeenCalled();
    expect(playTrackMock).toHaveBeenCalledTimes(1); // no replay on drop
    expect(JSON.stringify(renderer.toJSON())).toContain('Wrong!');

    // Continue rotates to Zeta: her turn gets a FRESH playTrack call —
    // playback restarts from the beginning, never a resume-after-pause.
    const continueBtn = findFirst(
      renderer,
      (n) => typeof (n.props as { onClick?: unknown }).onClick === 'function'
        && String((n.props as { className?: string }).className ?? '').includes('btn'),
    );
    await act(async () => {
      (continueBtn.props as { onClick: (e: unknown) => void }).onClick({});
    });
    expect(playTrackMock).toHaveBeenCalledTimes(2);
    // Zeta's hidden song is the 4th deck card (deck cycled past start+hidden).
    expect(playTrackMock).toHaveBeenLastCalledWith('spotify:track:pb-d', 'dev-1');
    renderer.unmount();
  });

  it('device not ready: log-and-wait (no playTrack yet); drop stays available; plays once the device becomes ready', async () => {
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { Game, PlayerProvider, playTrackMock } = await freshPlayback();
    pb.state = { ...pb.state, deviceId: null, isReady: false } as unknown as UseSpotifyPlayerResult;

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PlayerProvider authed>
          <Game deck={PB_DECK} />
        </PlayerProvider>,
      );
    });
    await act(async () => {});
    // D013 log-and-wait: no playTrack call while not ready — and no click
    // queueing: the drop stays fully available.
    expect(playTrackMock).not.toHaveBeenCalled();
    const handle = findFirst(renderer, (n) => 'data-hidden-id' in (n.props as Record<string, unknown>));
    pressKey(handle, 'Enter');
    expect(JSON.stringify(renderer.toJSON())).toContain('Wrong!'); // drop judged fine

    // Continue to the next turn: device still not ready → still waiting.
    const continueBtn = findFirst(
      renderer,
      (n) => typeof (n.props as { onClick?: unknown }).onClick === 'function'
        && String((n.props as { className?: string }).className ?? '').includes('btn'),
    );
    await act(async () => {
      (continueBtn.props as { onClick: (e: unknown) => void }).onClick({});
    });
    expect(playTrackMock).not.toHaveBeenCalled();

    // Once ready flips, the pending turn plays (single playTrack, from the beginning).
    pb.state = { ...pb.state, deviceId: 'dev-1', isReady: true } as unknown as UseSpotifyPlayerResult;
    await act(async () => {
      renderer.update(
        <PlayerProvider authed>
          <Game deck={PB_DECK} />
        </PlayerProvider>,
      );
    });
    expect(playTrackMock).toHaveBeenCalledTimes(1);
    renderer.unmount();
  });

  it('an unplayable hidden track (no track URI) never blocks the drop', async () => {
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { Game, PlayerProvider, playTrackMock } = await freshPlayback();

    const unplayableDeck: TurnSong[] = [
      { name: 'PB Start', uri: 'spotify:track:pb-start', releaseYear: '2001' },
      { name: 'Local Episode', uri: 'spotify:episode:pb-ep', releaseYear: '1999' }, // not a track URI
      { name: 'PB C', uri: 'spotify:track:pb-c', releaseYear: '2010' },
    ];
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PlayerProvider authed>
          <Game deck={unplayableDeck} />
        </PlayerProvider>,
      );
    });
    await act(async () => {});
    // Audio hint skipped — no playTrack attempt for an unplayable item.
    expect(playTrackMock).not.toHaveBeenCalled();
    // ...and the drop is still fully allowed (audio is a hint, never a gate).
    const handle = findFirst(renderer, (n) => 'data-hidden-id' in (n.props as Record<string, unknown>));
    pressKey(handle, 'Enter');
    expect(JSON.stringify(renderer.toJSON())).toContain('Wrong!');
    renderer.unmount();
  });

  it('a failed playTrack (network/error) is logged and the turn stays playable', async () => {
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { Game, PlayerProvider, playTrackMock } = await freshPlayback();
    playTrackMock.mockRejectedValueOnce(new Error('boom'));

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PlayerProvider authed>
          <Game deck={PB_DECK} />
        </PlayerProvider>,
      );
    });
    await act(async () => {});
    expect(playTrackMock).toHaveBeenCalledTimes(1); // attempted, failed
    const handle = findFirst(renderer, (n) => 'data-hidden-id' in (n.props as Record<string, unknown>));
    pressKey(handle, 'Enter');
    expect(JSON.stringify(renderer.toJSON())).toContain('Wrong!'); // drop unaffected
    renderer.unmount();
  });

  it('a resumed mid-turn game plays the hidden track from the beginning', async () => {
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { PlayerProvider, playTrackMock } = await freshPlayback();
    const store = await import('../game/gameStateStore');
    const { createTurnState, startTurn, drawHidden } = await import('../game/turnEngine');
    const { takePendingGameConfig } = await import('../game/setupStore');
    takePendingGameConfig(); // drain the slot so /game resolves via resume

    let state = createTurnState(
      PB_CONFIG.players.map((p) => ({ ...p, songs: [] })),
      PB_DECK,
      PB_CONFIG.songsToWin,
    );
    state = startTurn(state);
    state = drawHidden(state); // awaiting-drop with 'PB Hidden' as hidden song
    store.saveGameState(PB_CONFIG.playlistId, PB_CONFIG, state);

    const { default: Game } = await import('./Game');
    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        <PlayerProvider authed>
          <Game />
        </PlayerProvider>,
      );
    });
    await act(async () => {});
    // Resume lands at awaiting-drop and starts the turn's track fresh.
    expect(playTrackMock).toHaveBeenCalledTimes(1);
    expect(playTrackMock).toHaveBeenCalledWith('spotify:track:pb-hidden-canonical', 'dev-1');
    expect(allText(renderer.toJSON())).toContain("Orlo's turn");
    renderer.unmount();
  });
});

/* ---- S05-T02: game over renders the full podium summary ---- */

describe('Game game-over podium (S05-T02)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    (globalThis as Record<string, unknown>).localStorage = undefined;
    (globalThis as Record<string, unknown>).history = undefined;
  });

  it('renders PodiumSummary with every player fully revealed, in win order, plus exit options', async () => {
    vi.resetModules();
    const storage = new MemoryLocalStorage();
    (globalThis as Record<string, unknown>).localStorage = storage;
    const { default: Game } = await import('./Game');
    const setupStore = await import('../game/setupStore');
    setupStore.setPendingGameConfig({
      playlistId: 'pl-podium',
      playlistName: 'Podium Playlist',
      players: [
        { id: 'p-1', name: 'Orlo' },
        { id: 'p-2', name: 'Zeta' },
      ],
      songsToWin: 2,
    });
    // Each player wins with start card + one correct drop at index 1
    // (hidden year later than the start card year).
    const podiumDeck: TurnSong[] = [
      { name: 'Podium Start A', releaseYear: '2001' },
      { name: 'Podium Win A', releaseYear: '2005' },
      { name: 'Podium Start B', releaseYear: '2002' },
      { name: 'Podium Win B', releaseYear: '2006' },
    ];

    const root = TestRenderer.create(<Game deck={podiumDeck} />);
    const dropDefault = () => {
      const handle = findFirst(root, (n) => 'data-hidden-id' in (n.props as Record<string, unknown>));
      pressKey(handle, 'Enter'); // keyboard default index 1 → correct
    };
    const continueTurn = () => {
      const btn = findFirst(
        root,
        (n) => typeof (n.props as { onClick?: unknown }).onClick === 'function'
          && String((n.props as { className?: string }).className ?? '').includes('btn'),
      );
      act(() => {
        (btn.props as { onClick: (e: unknown) => void }).onClick({});
      });
    };

    // Orlo drops correctly → wins (2 >= 2); Continue → Zeta's turn.
    dropDefault();
    continueTurn();
    expect(allText(root.toJSON())).toContain("Zeta's turn");
    // Zeta drops correctly → wins → game over → podium renders.
    dropDefault();
    continueTurn();

    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('Game over');
    // Per-player podium rows in win order: Orlo (rank 1) before Zeta (rank 2).
    const players = root.root.findAll(
      (n) => (n.props as { 'data-testid'?: string })['data-testid'] === 'podium-player',
    );
    expect(players).toHaveLength(2);
    expect(players[0].props).toMatchObject({ 'data-player-id': 'p-1', 'data-rank': 1 });
    expect(players[1].props).toMatchObject({ 'data-player-id': 'p-2', 'data-rank': 2 });
    // Both chronologies fully revealed (2 songs per player).
    expect(root.root.findAll(
      (n) => (n.props as { 'data-testid'?: string })['data-testid'] === 'podium-song',
    )).toHaveLength(4);
    expect(json).toContain('Podium Win A');
    expect(json).toContain('2005');
    expect(json).toContain('Podium Win B');
    expect(json).toContain('2006');
    expect(json).toContain('winner!');
    // Exit options render (component tests assert the routes themselves).
    expect(json).toContain('Play again');
    expect(json).toContain('Back to playlist');
    // UAT-walk compatibility: the sr-only winners list stays observable.
    expect(root.root.findAll(
      (n) => (n.props as { 'data-testid'?: string })['data-testid'] === 'game-over-winners',
    )).toHaveLength(1);
    expect(allText(root.toJSON())).toContain('p-1');
    expect(allText(root.toJSON())).toContain('p-2');
  });
});
