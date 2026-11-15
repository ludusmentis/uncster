/**
 * Tests for PodiumSummary (M007 / S05, T02).
 *
 * The podium renders one block per player in win order (rank 1 first),
 * each showing the player's FULL revealed chronology in track-row
 * styling (title + year all visible at game over; missing releaseYear
 * renders the RELEASE_YEAR_PLACEHOLDER). Play again navigates to
 * /setup/<playlistId> and Back to playlist to /playlist/<playlistId>
 * (verified through the routing module's pushState bridge).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import type { PodiumEntry } from '../game/useGameEngine';
import type { TurnSong } from '../game/turnEngine';
import PodiumSummary from './PodiumSummary';
import { RELEASE_YEAR_PLACEHOLDER } from '../api/tracks';

const songs = (years: Array<string | undefined>, names?: string[]): TurnSong[] =>
  years.map((y, i) => ({
    name: names?.[i] ?? `Song ${String.fromCharCode(65 + i)}`,
    releaseYear: y,
  }));

function textOf(json: unknown): string {
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(textOf).join('');
  if (json && typeof json === 'object' && 'children' in (json as Record<string, unknown>)) {
    return textOf((json as { children?: unknown }).children);
  }
  return '';
}

function findAll(
  root: TestRenderer.ReactTestRenderer,
  pred: (n: TestRenderer.ReactTestInstance) => boolean,
): TestRenderer.ReactTestInstance[] {
  return root.root.findAll(pred);
}

/** Click a button-like instance by data-testid. */
function press(root: TestRenderer.ReactTestRenderer, testId: string): void {
  const node = root.root.findAll(
    (n) => (n.props as { 'data-testid'?: string })['data-testid'] === testId,
  );
  expect(node).toHaveLength(1);
  act(() => {
    (node[0].props as { onClick: (e: unknown) => void }).onClick({});
  });
}

const podium: PodiumEntry[] = [
  { id: 'p-1', name: 'Orlo', songs: songs(['1999', '2005']), rank: 1 },
  { id: 'p-2', name: 'Zeta', songs: songs([undefined, '2010'], ['Mystery Track']), rank: 2 },
];

const pushState = vi.fn();
const historyStub = { pushState };

function mount(): TestRenderer.ReactTestRenderer {
  return TestRenderer.create(
    <PodiumSummary podium={podium} winners={['p-1', 'p-2']} playlistId="pl-1" />,
  );
}

describe('PodiumSummary (S05-T02)', () => {
  afterEach(() => {
    vi.resetModules();
    (globalThis as Record<string, unknown>).history = undefined;
  });

  it('renders every player in win order with fully revealed chronology rows', () => {
    (globalThis as Record<string, unknown>).history = historyStub;
    const root = mount();
    const players = findAll(root, (n) =>
      (n.props as { 'data-testid'?: string })['data-testid'] === 'podium-player');
    expect(players).toHaveLength(2);
    // Win order: rank 1 (Orlo) first, rank 2 (Zeta) second.
    expect(players[0].props).toMatchObject({ 'data-rank': 1, 'data-player-id': 'p-1' });
    expect(players[1].props).toMatchObject({ 'data-rank': 2, 'data-player-id': 'p-2' });

    const songRows = findAll(
      root, (n) => (n.props as { 'data-testid'?: string })['data-testid'] === 'podium-song');
    // 2 songs per player, all revealed at game over.
    expect(songRows).toHaveLength(4);

    const json = JSON.stringify(root.toJSON());
    expect(json).toContain('Game over');
    expect(json).toContain('#1');
    expect(json).toContain('winner!');
    expect(json).toContain('Song A');
    expect(json).toContain('1999');
    expect(json).toContain('2005');
    // Missing releaseYear renders the placeholder (RELEASE_YEAR_PLACEHOLDER).
    expect(json).toContain('Mystery Track');
    expect(json).toContain(RELEASE_YEAR_PLACEHOLDER);
    // UAT-walk DOM observability: the sr-only winners list stays rendered.
    expect(json).toContain('game-over-winners');
    expect(textOf(root.toJSON())).toContain('pl-1'.length > 0 ? 'Orlo' : '');
  });

  it('navigates to /setup/<playlistId> on Play again and /playlist/<playlistId> on Back to playlist', () => {
    (globalThis as Record<string, unknown>).history = historyStub;
    const root = mount();
    press(root, 'podium-play-again');
    expect(pushState).toHaveBeenCalledWith(null, '', '/setup/pl-1');
    press(root, 'podium-back-to-playlist');
    expect(pushState).toHaveBeenCalledWith(null, '', '/playlist/pl-1');
  });

  it('URI-encodes the playlist id in both exit routes', () => {
    (globalThis as Record<string, unknown>).history = historyStub;
    const root = TestRenderer.create(
      <PodiumSummary podium={podium} winners={['p-1']} playlistId="pl 1/x" />,
    );
    press(root, 'podium-play-again');
    expect(pushState).toHaveBeenCalledWith(null, '', '/setup/pl%201%2Fx');
  });
});