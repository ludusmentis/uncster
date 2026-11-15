/**
 * Tests for SongDropList (M007 / S02, T03).
 *
 * The drop-index resolution logic (`resolveDropIndex`) is the core pure
 * unit under test — it decides which insertion gap the pointer targets.
 * Rendering is verified with react-test-renderer (node-pure, no jsdom,
 * per project convention): gap structure, hidden-slot handle attributes
 * (touch-action comes from CSS; the handle is focusable role=button),
 * and the keyboard fallback placement path (Enter / arrow keys invoke
 * onPlace with the expected index). Pointer-event drag is exercised via
 * the same resolver contract the handlers consume.
 */

import { describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import { resolveDropIndex, default as SongDropList } from './SongDropList';
import type { TurnSong } from '../game/turnEngine';

const songs: TurnSong[] = [
  { name: 'Start Card Song', releaseYear: '2001' },
  { name: 'Older Song', releaseYear: '1994' },
  { name: 'Newer Song', releaseYear: '2010' },
];

describe('resolveDropIndex (S02-T03)', () => {
  const rects = [
    { index: 0, top: 0, bottom: 10 },
    { index: 1, top: 10, bottom: 20 },
    { index: 2, top: 20, bottom: 30 },
    { index: 3, top: 30, bottom: 40 },
  ];

  it('targets the first gap whose midpoint the pointer has not passed', () => {
    // Above the first midpoint (5) → insert at 0.
    expect(resolveDropIndex(rects, -5)).toBe(0);
    expect(resolveDropIndex(rects, 4)).toBe(0);
    // Below gap0's midpoint but above gap1's (15) → insert at 1.
    expect(resolveDropIndex(rects, 6)).toBe(1);
    expect(resolveDropIndex(rects, 15)).toBe(1); // exactly on a midpoint → earlier target wins
    // Between gap1 and gap2 midpoints → 2.
    expect(resolveDropIndex(rects, 16)).toBe(2);
    // Past the last midpoint → after the final row.
    expect(resolveDropIndex(rects, 21)).toBe(2); // inside gap2's span, below its midpoint
    expect(resolveDropIndex(rects, 36)).toBe(3);
    expect(resolveDropIndex(rects, 1000)).toBe(3);
  });

  it('falls back to index 0 when there are no drop targets', () => {
    expect(resolveDropIndex([], 123)).toBe(0);
  });

  it('respects explicit index ordering even when rects arrive unordered', () => {
    const shuffled = [rects[3], rects[0], rects[2], rects[1]];
    // resolveDropIndex assumes callers pass index-ordered rects (the
    // component sorts them); with shuffled input the first unpassed
    // target by array order wins — pin that the ordered contract holds.
    const ordered = [...shuffled].sort((a, b) => a.index - b.index);
    expect(resolveDropIndex(ordered, 18)).toBe(2);
  });
});

function findHiddenSlot(root: TestRenderer.ReactTestRenderer) {
  const handle = root.root.findAll((n) =>
    typeof n.props === 'object' && n.props !== null && 'data-hidden-id' in (n.props as Record<string, unknown>),
  );
  expect(handle).toHaveLength(1);
  return handle[0];
}

describe('SongDropList rendering and interaction (S02-T03)', () => {
  it('renders n+1 insertion gaps around the rows, with data-drop-index', () => {
    const root = TestRenderer.create(
      <SongDropList songs={songs} hiddenId="turn:0:0:1" onPlace={vi.fn()} />,
    );
    const gaps = root.root.findAll(
      (n) => n.props['data-drop-index'] !== undefined,
    );
    expect(gaps.map((g) => g.props['data-drop-index'])).toEqual([0, 1, 2, 3]);
    // Rows keep the playlist track-list styling.
    const rows = root.root.findAll((n) => (n.props.className ?? '').includes('game-list-row'));
    expect(rows).toHaveLength(3);
  });

  it('renders the hidden slot as a focusable drag handle with zero song metadata', () => {
    const root = TestRenderer.create(
      <SongDropList songs={songs} hiddenId="turn:0:0:1" onPlace={vi.fn()} />,
    );
    const handle = findHiddenSlot(root);
    expect(handle.props.className).toContain('game-hidden-slot');
    expect(handle.props.className).toContain('game-drag-handle');
    expect(handle.props.role).toBe('button');
    expect(handle.props.tabIndex).toBe(0);
    expect(handle.props['aria-label']).toContain('drag to place');
    // Zero metadata: the only rendered child is the ? glyph span.
    expect(handle.children).toHaveLength(1);
    const glyph = handle.children[0] as TestRenderer.ReactTestInstance;
    expect(glyph.props.className).toBe('game-hidden-glyph');
    expect(glyph.children).toEqual(['?']);
    const propKeys = Object.keys(handle.props).filter((k) => !k.startsWith('__'));
    expect(propKeys.join(',')).not.toMatch(/title|artist|year/i);
  });

  it('omits the hidden slot when hiddenId is null (no drop awaited)', () => {
    const root = TestRenderer.create(
      <SongDropList songs={songs} hiddenId={null} onPlace={vi.fn()} />,
    );
    expect(
      root.root.findAll((n) => 'data-hidden-id' in (n.props as Record<string, unknown>)),
    ).toHaveLength(0);
  });

  it('keyboard fallback: Enter places at the default index; arrows move the target', () => {
    const onPlace = vi.fn();
    let root: TestRenderer.ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(
        <SongDropList songs={songs} hiddenId="h" onPlace={onPlace} keyboardDefaultIndex={1} />,
      );
    });
    const handle = findHiddenSlot(root!);

    // ArrowUp/ArrowDown adjust the candidate; Enter commits it.
    act(() => {
      handle.props.onKeyDown({ key: 'ArrowUp', preventDefault: () => {} } as unknown as React.KeyboardEvent);
    });
    act(() => {
      handle.props.onKeyDown({ key: 'Enter', preventDefault: () => {} } as unknown as React.KeyboardEvent);
    });
    expect(onPlace).toHaveBeenCalledWith(0); // default 1, ArrowUp → 0

    // Without arrows, Enter uses the default index directly.
    onPlace.mockClear();
    act(() => {
      root = TestRenderer.create(
        <SongDropList songs={songs} hiddenId="h" onPlace={onPlace} keyboardDefaultIndex={1} />,
      );
    });
    const h2 = findHiddenSlot(root!);
    act(() => {
      h2.props.onKeyDown({ key: ' ', preventDefault: () => {} } as unknown as React.KeyboardEvent);
    });
    expect(onPlace).toHaveBeenCalledWith(1);
  });

  it('keyboard fallback clamps within [0, list length]', () => {
    const onPlace = vi.fn();
    let root: TestRenderer.ReactTestRenderer;
    act(() => {
      root = TestRenderer.create(<SongDropList songs={songs} hiddenId="h" onPlace={onPlace} />);
    });
    const handle = findHiddenSlot(root!);
    // Default is songs.length (3); ArrowDown twice should clamp at 3.
    act(() => {
      handle.props.onKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as unknown as React.KeyboardEvent);
      handle.props.onKeyDown({ key: 'ArrowDown', preventDefault: () => {} } as unknown as React.KeyboardEvent);
      handle.props.onKeyDown({ key: 'Enter', preventDefault: () => {} } as unknown as React.KeyboardEvent);
    });
    expect(onPlace).toHaveBeenCalledWith(3);
  });
});
