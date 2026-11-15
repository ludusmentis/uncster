/**
 * SongDropList (M007 / S02, T03) — hand-rolled pointer-based drag-and-drop.
 *
 * Zero new dependencies; built on Pointer Events (mouse + touch + pen),
 * NOT HTML5 DnD. The hidden song's ? box is the drag handle (touch-action:
 * none so touch drag isn't hijacked by scrolling); the insertion gaps of
 * the player's vertical list are the drop targets, with visible
 * drop-target feedback. On drop at an index, `onPlace(index)` fires —
 * the controller's place action, which runs the correctness judgment.
 *
 * The drop-index resolution logic lives in the pure exported
 * `resolveDropIndex` so it is unit-testable in isolation.
 */

import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { TurnSong } from '../game/turnEngine';
import { songKey } from '../game/deck';

/**
 * Resolve the drop index from the drop-target rects and the pointer's
 * vertical position: the first target whose vertical midpoint the
 * pointer has not yet passed is the active target; past the last one,
 * the index is "after the final row".
 *
 * `rects` are ordered by drop index; entries carry their insertion
 * index and DOMRect-like bounds.
 */
export function resolveDropIndex(
  rects: ReadonlyArray<{ index: number; top: number; bottom: number }>,
  pointerY: number,
): number {
  let result = rects.length > 0 ? rects[rects.length - 1].index : 0;
  for (const r of rects) {
    const mid = (r.top + r.bottom) / 2;
    if (pointerY <= mid) {
      result = r.index;
      break;
    }
  }
  return result;
}

interface SongDropListProps {
  /** The player's ordered songs (including the start card, if any). */
  songs: TurnSong[];
  /** Opaque handle id for the hidden song (null when not awaiting a drop). */
  hiddenId: string | null;
  /** Drop callback: insert the hidden song at `index` (runs the judgment). */
  onPlace: (index: number) => void;
  /** Fallback target index for keyboard placement (default: end of list). */
  keyboardDefaultIndex?: number;
}

export default function SongDropList({
  songs,
  hiddenId,
  onPlace,
  keyboardDefaultIndex,
}: SongDropListProps): JSX.Element {
  const [dragging, setDragging] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  /** Snapshot the insertion-gap rects from the live DOM. */
  const gapRects = useCallback((): Array<{ index: number; top: number; bottom: number }> => {
    const list = listRef.current;
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLElement>('[data-drop-index]'))
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return { index: Number(el.dataset.dropIndex), top: rect.top, bottom: rect.bottom };
      })
      .sort((a, b) => a.index - b.index);
  }, []);

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLLIElement>) => {
      // Capture so we keep receiving moves even when the pointer leaves
      // the element (mouse) or moves quickly (touch).
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
      setActiveIndex(resolveDropIndex(gapRects(), e.clientY));
    },
    [gapRects],
  );

  const onHandlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLLIElement>) => {
      if (!dragging) return;
      setActiveIndex(resolveDropIndex(gapRects(), e.clientY));
    },
    [dragging, gapRects],
  );

  const onHandlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLLIElement>) => {
      if (!dragging) return;
      const index = resolveDropIndex(gapRects(), e.clientY);
      setDragging(false);
      setActiveIndex(null);
      onPlace(index);
    },
    [dragging, gapRects, onPlace],
  );

  const onHandleLostPointerCapture = useCallback(() => {
    // Drag interrupted (pointercancel / escape) — reset without judging.
    setDragging(false);
    setActiveIndex(null);
  }, []);

  // Cheap keyboard fallback: the handle is focusable; Enter/Space places
  // at the default index (end of the list); ArrowUp/ArrowDown move the
  // candidate placement index while focused.
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);

  const onHandleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const max = songs.length;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const base = keyboardIndex ?? keyboardDefaultIndex ?? max;
        const next = e.key === 'ArrowUp' ? Math.max(0, base - 1) : Math.min(max, base + 1);
        setKeyboardIndex(next);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const index = keyboardIndex ?? keyboardDefaultIndex ?? max;
        setKeyboardIndex(null);
        onPlace(index);
      }
    },
    [keyboardIndex, keyboardDefaultIndex, onPlace, songs.length],
  );

  const gap = (index: number): ReactNode => (
    <li
      key={`gap-${index}`}
      aria-hidden="true"
      data-drop-index={index}
      className={
        (dragging && activeIndex === index) || (!dragging && keyboardIndex === index)
          ? 'game-drop-gap drop-target-active'
          : 'game-drop-gap'
      }
    />
  );

  const row = (song: TurnSong, index: number): ReactNode => (
    <li key={`${songKey(song)}-${index}`} className="track-item game-list-row">
      <span className="track-index" aria-hidden="true">{index + 1}</span>
      <span aria-hidden="true" className="track-cover-placeholder">🎵</span>
      <div className="track-info">
        <p className="track-title">{song.name}</p>
        <p className="track-artist">—</p>
      </div>
      <span className="track-year">{song.releaseYear ?? '—'}</span>
    </li>
  );

  const hiddenSlot = (
    <li
      key="hidden-slot"
      className="game-hidden-slot game-drag-handle"
      data-hidden-id={hiddenId ?? undefined}
      role="button"
      tabIndex={0}
      aria-label="Hidden song — drag to place"
      aria-grabbed={dragging}
      onPointerDown={onHandlePointerDown}
      onPointerMove={onHandlePointerMove}
      onPointerUp={onHandlePointerUp}
      onLostPointerCapture={onHandleLostPointerCapture}
      onKeyDown={onHandleKeyDown}
    >
      <span className="game-hidden-glyph" aria-hidden="true">?</span>
    </li>
  );

  // Interleave: gap0, row0, gap1, row1, …, hidden slot (only while a
  // hidden song awaits a drop), final gap. The hidden slot itself lives
  // outside the gap ordering so gap indices always equal list insertion
  // indices (place(index) inserts at index in `songs`).
  const children: ReactNode[] = [];
  songs.forEach((song, i) => {
    children.push(gap(i), row(song, i));
  });
  children.push(gap(songs.length));
  if (hiddenId !== null) {
    // Inserted after the final gap visually sits at position 1 of the
    // list for the first turn (start card is row 0). Rendered last so it
    // can be dragged across all gaps.
    children.push(hiddenSlot);
  }

  return (
    <ol className="track-list game-list song-drop-list" ref={listRef}>
      {children}
    </ol>
  );
}
