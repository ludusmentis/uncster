/**
 * Turn controller hook (M007 / S02, T01).
 *
 * Owns the S01 turn state machine (src/game/turnEngine.ts) for the game
 * view: executes deck draws and correctness judgments, persists every
 * transition to the S01 store (src/game/gameStateStore.ts), and exposes
 * pure view state to React. The hidden song is exposed as an opaque
 * handle — its metadata NEVER reaches the view before the drop is judged
 * (D: "all data of the song to guess should be hidden").
 *
 * StrictMode safety (dev double-invoke): the pending GameConfig is taken
 * from the module slot through a module-level take-once cache (the exact
 * pattern from setupStore/MockGame), and all machine transitions happen
 * inside the reducer (pure, idempotent given an input state) — never in
 * effects — so a StrictMode double-mount replays identically.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { GameConfig } from './setupLogic';
import type { TurnSong, TurnState, TurnPlayer } from './turnEngine';
import { playTrack } from '../playback/playTrack';
import {
  createTurnState,
  startTurn,
  drawHidden,
  drop,
  resolveTurn,
} from './turnEngine';
import {
  loadGameState,
  saveGameState,
  resumeGame,
  clearGameState,
} from './gameStateStore';
import { takePendingGameConfig } from './setupStore';
import { RELEASE_YEAR_PLACEHOLDER } from '../api/tracks';

/**
 * Playback controller seam (M007 / S04-T2): the game view supplies the
 * live player surface (via PlayerProvider's usePlayerOptional); passing
 * null disables per-turn playback entirely (SSR / provider-less tests).
 * Audio is a HINT, never a gate: playback failures must not block drops.
 */
export interface TurnPlaybackController {
  /** Our Connect device id; null while not connected. */
  deviceId: string | null;
  /** True once the SDK device is ready to accept playback commands. */
  isReady: boolean;
  /** Deterministic pause (S04-T1) — never togglePlay (no restart race). */
  pause: () => void;
}

/** Opaque handle for the hidden song. Carries no song metadata. */
export interface HiddenSongHandle {
  /** Opaque token; changes whenever a new hidden song is drawn. */
  readonly id: string;
}

/** Reveal payload available only after the drop has been judged. */
export interface TurnOutcome {
  correct: boolean;
  /** The hidden song that was judged (full metadata — reveal only). */
  song: TurnSong | null;
  /** The correct insertion index for the song (0..list.length). */
  correctPosition: number;
}

export type EngineStatus = 'no-config' | 'playing';

/** One podium row: a player's completed chronology plus their rank. */
export interface PodiumEntry {
  id: string;
  name: string;
  songs: TurnSong[];
  /** 1 = first winner. */
  rank: number;
}

export interface GameEngineView {
  status: EngineStatus;
  config: GameConfig | null;
  /** Player whose turn it is (null once the game is over). */
  currentPlayer: TurnPlayer | null;
  /** The current player's chronologically ordered list. */
  list: TurnSong[];
  phase: TurnState['phase'];
  /** Opaque handle for the hidden song — no metadata leaks pre-drop. */
  hidden: HiddenSongHandle | null;
  /** Reveal payload while a reveal phase is showing; null otherwise. */
  outcome: TurnOutcome | null;
  /** Ids of winners so far, in win order. */
  winners: string[];
  /** Every player with their chronology: winners in win order (rank 1 first),
   *  then remaining players in creation order. Fully populated at game over. */
  podium: PodiumEntry[];
  /** Drop the hidden song at `dropIndex` (runs the judgment). */
  place: (dropIndex: number) => void;
  /** Resolve the reveal and rotate to the next player's turn. */
  continueTurn: () => void;
}

// ---- StrictMode-safe take-once (MockGame pattern) ----
// React 18 StrictMode double-invokes useState lazy initializers. The
// first invocation drains the module slot and caches the value so the
// replay reuses it instead of seeing null.
let lastTakenConfig: { value: GameConfig | null } | null = null;

function takeConfig(injected: GameConfig | null | undefined): GameConfig | null {
  if (injected !== undefined) return injected;
  if (lastTakenConfig === null) {
    lastTakenConfig = { value: takePendingGameConfig() };
  }
  return lastTakenConfig.value;
}

/** The game engine + view state bundle kept in useReducer. */
interface EngineState {
  status: EngineStatus;
  config: GameConfig | null;
  state: TurnState | null;
}

type EngineAction =
  | { type: 'place'; dropIndex: number }
  | { type: 'continue' };

/** Auto-advance the machine: start-card → draw. Pure/idempotent. */
function advance(state: TurnState): TurnState {
  let s = state;
  if (s.phase === 'start-card') s = startTurn(s);
  if (s.phase === 'draw-hidden') s = drawHidden(s);
  return s;
}

/** The correct insertion index for the hidden song in the player's list. */
function correctPositionFor(list: TurnSong[], song: TurnSong | null): number {
  if (!song) return 0;
  const year = Number(song.releaseYear ?? RELEASE_YEAR_PLACEHOLDER);
  if (!Number.isFinite(year) || song.releaseYear === undefined) return 0; // unknown year: any index is correct
  let i = 0;
  while (i < list.length) {
    const y = list[i].releaseYear;
    if (y !== undefined && Number.isFinite(Number(y)) && Number(y) > year) break;
    i += 1;
  }
  return i;
}

/** Podium rows: winners in win order, then remaining players in creation order. */
function podiumFor(state: TurnState): PodiumEntry[] {
  const byId = new Map(state.players.map((p) => [p.id, p] as const));
  const won: PodiumEntry[] = state.winners.map((id, i) => {
    const p = byId.get(id)!;
    return { id, name: p.name, songs: p.songs, rank: i + 1 };
  });
  const rest: PodiumEntry[] = state.players
    .filter((p) => !state.winners.includes(p.id))
    .map((p, i) => ({ id: p.id, name: p.name, songs: p.songs, rank: won.length + i + 1 }));
  return [...won, ...rest];
}

function init(deck: TurnSong[], injectedConfig: GameConfig | null | undefined): EngineState {
  const config = takeConfig(injectedConfig);
  if (!config) return { status: 'no-config', config: null, state: null };
  // Resume a persisted mid-game snapshot when one exists and is valid.
  const snapshot = loadGameState(config.playlistId);
  const resumed = snapshot && snapshot.config.playlistId === config.playlistId
    ? resumeGame(snapshot)
    : null;
  const base = resumed ?? createTurnState(
    config.players.map((p) => ({ id: p.id, name: p.name, songs: [] })),
    deck,
    config.songsToWin,
  );
  const state = advance(resumed ?? base);
  saveGameState(config.playlistId, config, state);
  return { status: 'playing', config, state };
}

function reducer(prev: EngineState, action: EngineAction): EngineState {
  if (prev.status !== 'playing' || !prev.state || !prev.config) return prev;
  let next: TurnState;
  switch (action.type) {
    case 'place': {
      // Guard: only valid while a hidden song awaits a drop.
      if (prev.state.phase !== 'awaiting-drop' || !prev.state.hiddenSong) return prev;
      if (!Number.isInteger(action.dropIndex)
        || action.dropIndex < 0
        || action.dropIndex > prev.state.players[prev.state.currentIndex].songs.length) {
        return prev;
      }
      next = drop(prev.state, action.dropIndex);
      break;
    }
    case 'continue': {
      if (prev.state.phase !== 'reveal-success' && prev.state.phase !== 'reveal-fail') return prev;
      next = advance(resolveTurn(prev.state));
      break;
    }
    default:
      return prev;
  }
  // Persist-on-change: every transition writes the full snapshot. A finished
  // game is no longer active — drop the snapshot and the harlequin.game.active
  // pointer so the bare /game route falls back to setup instead of resuming
  // a completed game (abandon clears via the same store helper in T02).
  if (next.finished) {
    clearGameState(prev.config.playlistId);
  } else {
    saveGameState(prev.config.playlistId, prev.config, next);
  }
  return { ...prev, state: next };
}

/**
 * The turn controller hook. `deck` is the shuffled song pool for a fresh
 * game; `config` may be injected (tests / explicit callers) — when
 * omitted the hook drains the setupStore pending-config module slot
 * exactly once (StrictMode-safe). `playback` (S04-T2) wires per-turn
 * audio: the full hidden track plays via playTrack each time a turn
 * enters awaiting-drop (including the turn after a mid-game resume), and
 * pause() fires on every drop outcome / game-over — audio is a hint, so
 * an unplayable track or a not-ready device never blocks the drop.
 */
export function useGameEngine(
  deck: TurnSong[],
  config?: GameConfig | null,
  playback?: TurnPlaybackController | null,
): GameEngineView {
  const [engine, dispatch] = useReducer(
    reducer,
    undefined,
    () => init(deck, config),
  );

  const place = useCallback((dropIndex: number) => {
    dispatch({ type: 'place', dropIndex });
  }, []);

  const continueTurn = useCallback(() => {
    dispatch({ type: 'continue' });
  }, []);

  // ---- Per-turn playback wiring (M007 / S04-T2, D013/D017/R012) ----
  // Play the FULL hidden track once per turn via playTrack (a fresh call
  // every turn, so a resumed turn also restarts from the beginning), and
  // pause() deterministically on every drop outcome / game-over — never
  // togglePlay, so a naturally-ended track cannot restart under the
  // overlay. Audio is a hint, never a gate: a not-ready device logs and
  // waits (no click queueing), and playback failures never block drops.
  const playedRef = useRef<TurnSong | null>(null);
  const turnState = engine.state;
  const phase = turnState?.phase;
  const hiddenSong = turnState?.hiddenSong ?? null;
  useEffect(() => {
    if (!playback || !turnState) return;
    if (phase === 'reveal-success' || phase === 'reveal-fail' || phase === 'game-over') {
      playedRef.current = null;
      playback.pause();
      return;
    }
    if (phase !== 'awaiting-drop' || !hiddenSong) return;
    // One playTrack per turn: the hidden-song reference marks this turn as
    // already handled (StrictMode double-invoke safe).
    if (playedRef.current === hiddenSong) return;
    if (!playback.isReady || !playback.deviceId) {
      // D013 log-and-wait: no click queueing — the drop stays available; when
      // the device becomes ready this effect re-runs and plays this turn.
      console.info('[game:playback] device not ready — will play the turn track once ready');
      return;
    }
    playedRef.current = hiddenSong;
    // linked_from-aware: a relinked local file plays its canonical track.
    const uri = hiddenSong.linked_from?.uri ?? hiddenSong.uri;
    if (!uri || !uri.startsWith('spotify:track:')) {
      // Unplayable hidden song (local/episode): audio hint skipped —
      // the drop is still fully allowed.
      console.warn('[game:playback] hidden song has no playable track URI — audio hint skipped');
      return;
    }
    playTrack(uri, playback.deviceId).catch((err: unknown) => {
      // Hint, not a gate: log and keep the turn playable.
      console.error('[game:playback] could not start the turn track', err);
    });
  }, [playback, turnState, phase, hiddenSong]);

  return useMemo(() => {
    if (engine.status === 'no-config' || !engine.state) {
      return {
        status: 'no-config' as const,
        config: null,
        currentPlayer: null,
        list: [] as TurnSong[],
        phase: 'start-card' as const,
        hidden: null,
        outcome: null,
        winners: [] as string[],
        podium: [] as PodiumEntry[],
        place,
        continueTurn,
      };
    }
    const state = engine.state;
    const player = state.players[state.currentIndex];
    const inReveal = state.phase === 'reveal-success' || state.phase === 'reveal-fail';
    return {
      status: 'playing' as const,
      config: engine.config,
      currentPlayer: state.finished ? null : player,
      list: player.songs,
      phase: state.phase,
      // Opaque handle only — song metadata stays inside the engine until judged.
      hidden: state.phase === 'awaiting-drop' && state.hiddenSong
        ? {
            // Opaque token from non-revealing position bookkeeping only —
            // never derived from the song's name/uri/year.
            id: `turn:${state.currentIndex}:${state.winners.length}:${player.songs.length}`,
          }
        : null,
      outcome: inReveal
        ? {
            correct: state.phase === 'reveal-success',
            song: state.hiddenSong,
            correctPosition: correctPositionFor(
              state.players[state.currentIndex].songs,
              state.hiddenSong,
            ),
          }
        : null,
      winners: state.winners,
      podium: podiumFor(state),
      place,
      continueTurn,
    };
  }, [engine, place, continueTurn]);
}
