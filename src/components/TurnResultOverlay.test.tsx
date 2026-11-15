/**
 * Tests for TurnResultOverlay (M007 / S02, T04).
 *
 * node-pure react-test-renderer (project convention, no jsdom): the
 * success overlay reveals the song title + year above a Continue
 * button; the symmetric fail overlay reveals the correct position
 * (human 1-based) and the actual year; both use role="alertdialog" +
 * aria-modal; Continue invokes the callback.
 */

import { describe, expect, it, vi } from 'vitest';
import TestRenderer, { act } from 'react-test-renderer';
import TurnResultOverlay from './TurnResultOverlay';
import type { TurnOutcome } from '../game/useGameEngine';
import type { TurnSong } from '../game/turnEngine';

const song: TurnSong = { name: 'Hidden Song XYZ', releaseYear: '1999' };

const successOutcome: TurnOutcome = {
  correct: true,
  song,
  correctPosition: 0,
};

const failOutcome: TurnOutcome = {
  correct: false,
  song,
  correctPosition: 1, // 0-based insertion index → human position 2
};

function textOf(root: TestRenderer.ReactTestRenderer): string {
  return JSON.stringify(root.toJSON());
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

/** The hint paragraph's text ("It should have gone at position N."). */
function hintText(root: TestRenderer.ReactTestRenderer): string {
  const hints = root.root.findAll(
    (n) => String((n.props as { className?: string }).className ?? '').includes('turn-result-hint'),
  );
  expect(hints).toHaveLength(1);
  return allText(hints[0].children);
}

function findContinueButton(root: TestRenderer.ReactTestRenderer) {
  const buttons = root.root.findAll(
    (n) => typeof n.props === 'object' && n.props !== null
      && 'onClick' in (n.props as Record<string, unknown>)
      && String((n.props as { className?: string }).className ?? '').includes('btn'),
  );
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

describe('TurnResultOverlay (S02-T04)', () => {
  it('success overlay reveals song title and year above a Continue button', () => {
    const onContinue = vi.fn();
    const root = TestRenderer.create(
      <TurnResultOverlay outcome={successOutcome} onContinue={onContinue} />,
    );
    const text = textOf(root);
    expect(text).toContain('Correct!');
    expect(text).toContain('Hidden Song XYZ');
    expect(text).toContain('1999');
    expect(text).toContain('Continue');
    // Accessibility contract: alertdialog + aria-modal.
    const dialog = root.root.findAll((n) => n.props.role === 'alertdialog');
    expect(dialog).toHaveLength(1);
    expect((dialog[0].props as Record<string, unknown>)['aria-modal']).toBe(true);
    // No correct-position hint on success (the list itself already reveals it).
    expect(text).not.toContain('should have gone at position');
  });

  it('fail overlay reveals the correct position and the actual year', () => {
    const onContinue = vi.fn();
    const root = TestRenderer.create(
      <TurnResultOverlay outcome={failOutcome} onContinue={onContinue} />,
    );
    const text = textOf(root);
    expect(text).toContain('Wrong!');
    // Correct position is spoken in human 1-based terms.
    expect(hintText(root)).toContain('position 2');
    // The actual year is revealed even on a fail.
    expect(text).toContain('Hidden Song XYZ');
    expect(text).toContain('1999');
    expect(root.root.findAll((n) => n.props.role === 'alertdialog')).toHaveLength(1);
  });

  it('Continue button invokes the callback', () => {
    const onContinue = vi.fn();
    const root = TestRenderer.create(
      <TurnResultOverlay outcome={successOutcome} onContinue={onContinue} />,
    );
    const button = findContinueButton(root);
    act(() => {
      (button.props as { onClick: (e: unknown) => void }).onClick({});
    });
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});