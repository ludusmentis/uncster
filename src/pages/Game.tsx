/**
 * Game view (M007 / S02, T02) at /game — replaces the M004 MockGame.
 *
 * Shell responsibilities:
 * - Take the pending GameConfig from the shared module slot exactly once
 *   (StrictMode-safe take-once cache, the setupStore/MockGame pattern).
 * - With a config: load the playlist's tracks, build the shuffled deck
 *   (createDeck + release years), and mount the turn board driven by
 *   useGameEngine (S02-T01 controller).
 * - No config: friendly fallback pointing back to setup.
 *
 * The turn board renders the current player's chronological list exactly
 * like the playlist track list (track row styling), and the hidden song
 * as a pulsating ? box at position 1 — carrying ZERO song metadata in the
 * DOM (opaque handle id only; the ? glyph is the sole rendered content).
 *
 * Deck injection (`deck` prop) is a test seam: tests pass a deterministic
 * deck so renderToString can assert the board without effects/fetches.
 */

import { useEffect, useState } from 'react';
import { navigate } from '../routing';
import { takePendingGameConfig } from '../game/setupStore';
import type { GameConfig } from '../game/setupLogic';
import { loadActiveGameState, resumeGame, clearGameState } from '../game/gameStateStore';
import { createDeck, songKey, type DeckSong } from '../game/deck';
import { fetchAllPlaylistTracks, releaseYear } from '../api/tracks';
import { usePlayerOptional } from '../playback/PlayerProvider';
import type { PodiumEntry, TurnPlaybackController } from '../game/useGameEngine';
import { useGameEngine } from '../game/useGameEngine';
import SongDropList from '../components/SongDropList';
import TurnResultOverlay from '../components/TurnResultOverlay';
import PodiumSummary from '../components/PodiumSummary';
import type { TurnSong } from '../game/turnEngine';

// ---- StrictMode-safe resolve-once (MockGame pattern) ----
// React 18 StrictMode double-invokes useState lazy initializers. The
// first invocation drains the pending-config module slot AND resolves the
// active-game pointer; the module-level cache keeps that first result so
// the replay reuses it instead of seeing a drained slot / cleared pointer.
//
// Start resolution order (S03-T02):
// 1. pending GameConfig from Start Game navigation (fresh game);
// 2. `harlequin.game.active` -> persisted snapshot -> resume reconstruction
//    (mid-game refresh-resume). The snapshot's own deck/list/hidden-song are
//    authoritative — the resume path performs NO fetch;
// 3. nothing resolvable -> friendly fallback (back to setup / home).
// A stale-version, corrupt, or already-finished snapshot is discarded
// (clearGameState) so it cannot trap the route, and the fallback renders.

interface PendingEntry {
  source: 'pending';
  config: GameConfig;
}
interface ResumeEntry {
  source: 'resume';
  config: GameConfig;
  /** The persisted deck — authoritative on resume (no re-fetch). */
  deck: TurnSong[];
}
interface NoneEntry {
  source: 'none';
}
type StartEntry = PendingEntry | ResumeEntry | NoneEntry;

let lastResolvedStart: { value: StartEntry } | null = null;

function resolveStart(): StartEntry {
  if (lastResolvedStart === null) {
    const pending = takePendingGameConfig();
    if (pending) {
      lastResolvedStart = { value: { source: 'pending', config: pending } };
    } else {
      const snapshot = loadActiveGameState();
      const resumed = snapshot ? resumeGame(snapshot) : null;
      if (snapshot && resumed && !resumed.finished) {
        lastResolvedStart = { value: { source: 'resume', config: snapshot.config, deck: resumed.deck } };
      } else {
        // Stale/corrupt/finished snapshot: discard it so a fresh game can be
        // started, then fall back gracefully.
        if (snapshot) clearGameState(snapshot.config.playlistId);
        lastResolvedStart = { value: { source: 'none' } };
      }
    }
  }
  return lastResolvedStart.value;
}

/** Enriched per-song metadata stamped onto the deck next to releaseYear. */
interface SongMeta {
  year: string;
  artist: string;
  coverUrl: string | undefined;
}

/** Build the TurnSong deck: shuffled tracks, each stamped with its year/artist/cover. */
export function buildDeck(items: Awaited<ReturnType<typeof fetchAllPlaylistTracks>>): TurnSong[] {
  // Metadata lookup keyed on the same identity the deck uses (songKey).
  const metaByKey = new Map<string, SongMeta>();
  for (const item of items) {
    const track = item.item;
    if (track) {
      metaByKey.set(
        songKey({ name: track.name, uri: track.uri, linked_from: (track as DeckSong).linked_from }),
        {
          year: releaseYear(item),
          artist: track.artists.map((a) => a.name).join(', '),
          coverUrl: track.album.images.find((img) => img.url)?.url ?? undefined,
        },
      );
    }
  }
  const tracks = items
    .map((item) => item.item)
    .filter((t): t is NonNullable<typeof t> => t !== null);
  const deck = createDeck(tracks, Date.now());
  return deck.map((song) => {
    const meta = metaByKey.get(songKey(song));
    return {
      ...song,
      releaseYear: meta?.year,
      artist: meta?.artist,
      coverUrl: meta?.coverUrl,
    };
  });
}

function GameFallback(): JSX.Element {
  return (
    <main className="page">
      <h1 className="neon-heading">No game in progress</h1>
      <p>Start a game from a playlist to see it here.</p>
      <p className="back-row">
        <button className="btn" onClick={() => navigate('/')}>
          ← Back home
        </button>
      </p>
    </main>
  );
}

/**
 * Game-over view (S05-T02): full podium via PodiumSummary — every
 * player's completed chronology in win order, plus Play again /
 * Back to playlist options. The sr-only winners list stays for
 * UAT-walk DOM observability (rendered inside PodiumSummary).
 */
function GameOverView({ podium, winners, playlistId }: {
  podium: PodiumEntry[];
  winners: string[];
  playlistId: string;
}): JSX.Element {
  return <PodiumSummary podium={podium} winners={winners} playlistId={playlistId} />;
}

/**
 * The turn board: the current player's name above their vertical
 * chronological list (track-row styling), with the hidden song as a
 * pulsating ? box at position 1. Outcome overlays (S02-T04) render over
 * the board during reveal phases; Continue rotates via the controller.
 */
function TurnBoard({ deck, config }: { deck: TurnSong[]; config: GameConfig }): JSX.Element {
  // S04-T2: bridge the PlayerProvider surface into the engine's per-turn
  // playback wiring. Null (no provider mounted, e.g. SSR / tests) disables
  // audio entirely; a not-ready device logs inside the engine and waits.
  const playerSurface = usePlayerOptional();
  const playback: TurnPlaybackController | null = playerSurface
    ? { deviceId: playerSurface.deviceId, isReady: playerSurface.isReady, pause: playerSurface.pause }
    : null;
  const engine = useGameEngine(deck, config, playback);

  if (engine.status === 'no-config') {
    return <GameFallback />;
  }
  if (engine.phase === 'game-over' || engine.currentPlayer === null) {
    return (
      <GameOverView
        podium={engine.podium}
        winners={engine.winners}
        playlistId={config.playlistId}
      />
    );
  }

  const player = engine.currentPlayer;
  const awaitingDrop = engine.phase === 'awaiting-drop' && engine.hidden !== null;

  return (
    <section className="game-board" aria-label={`Turn: ${player.name}`}>
      <h2 className="game-player-name">{player.name}&apos;s turn</h2>
      <SongDropList
        songs={engine.list}
        hiddenId={awaitingDrop ? engine.hidden!.id : null}
        onPlace={engine.place}
        keyboardDefaultIndex={1}
      />
      {engine.outcome !== null && (
        <TurnResultOverlay outcome={engine.outcome} onContinue={engine.continueTurn} />
      )}
    </section>
  );
}

/** Loads the deck for the config's playlist, then renders the board. */
function GameWithConfig({ config }: { config: GameConfig }): JSX.Element {
  const [deck, setDeck] = useState<TurnSong[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchAllPlaylistTracks(config.playlistId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setDeck(buildDeck(items));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('[game] failed to load deck tracks', err);
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load game songs.');
        }
      });
    return () => controller.abort();
  }, [config.playlistId]);

  if (error) {
    return (
      <main className="page">
        <section role="alert" className="alert">
          <p>{error}</p>
          <button className="btn" onClick={() => navigate('/')}>
            ← Back to playlists
          </button>
        </section>
      </main>
    );
  }
  if (!deck) {
    return (
      <main className="page" role="status" aria-label="Loading game">
        <p className="game-loading">Shuffling the deck…</p>
      </main>
    );
  }
  return (
    <main className="page game-page">
      <h1 className="neon-heading">{config.playlistName}</h1>
      <TurnBoard deck={deck} config={config} />
    </main>
  );
}

interface GameProps {
  /** Test seam: inject a deterministic deck (default: fetch + shuffle). */
  deck?: TurnSong[];
}

export default function Game({ deck }: GameProps = {}): JSX.Element {
  const [entry] = useState<StartEntry>(() => resolveStart());

  if (entry.source === 'none') return <GameFallback />;
  if (entry.source === 'resume') {
    // Refresh-resume: the persisted deck/list/hidden song are authoritative —
    // no fetch, straight to the board at the saved mid-turn position.
    return (
      <main className="page game-page">
        <h1 className="neon-heading">{entry.config.playlistName}</h1>
        <TurnBoard deck={entry.deck} config={entry.config} />
      </main>
    );
  }
  const config = entry.config;
  if (deck) {
    return (
      <main className="page game-page">
        <h1 className="neon-heading">{config.playlistName}</h1>
        <TurnBoard deck={deck} config={config} />
      </main>
    );
  }
  return <GameWithConfig config={config} />;
}
