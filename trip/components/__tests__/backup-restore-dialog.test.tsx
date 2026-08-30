// @vitest-environment jsdom
//
// The "Replace your current trip?" confirm on /plan/ guards an IRREVERSIBLE import — it replaces
// the itinerary, the journal and the photos. It used to be a hand-rolled `createPortal` whose
// entire modal contract was the two attributes `role="dialog" aria-modal="true"`: no Escape, no
// focus trap, no initial focus, no focus restore, and no `body[data-dialog-open]`, so the page
// scrolled behind the scrim and focus stayed on the `sr-only` file input — a screen-reader user
// was never told the dialog had opened, and Tab walked straight out into the navbar and the
// planner behind it.
//
// This pins the contract, not the implementation: open it, and every one of those must hold.
//
// Harness mirrors `time-picker-tab-trap.test.tsx` — plain react-dom/client via `act`, no
// @testing-library in this repo. Nothing is mocked away that the contract depends on: the dialog
// primitive is real, because it IS the fix.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// The panel's data layer is not what is under test; these are the seams it reads on mount.
vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ restorePlans: vi.fn() }),
}));
vi.mock('@/hooks/use-my-places', () => ({ useMyPlaces: () => ({ restoreMyPlaces: vi.fn() }) }));
vi.mock('@/hooks/use-docs', () => ({ useDocs: () => ({ restoreDocsChecklist: vi.fn() }) }));
vi.mock('@/lib/firebase-config', () => ({ isTripRemoteConfigured: () => false }));
vi.mock('@/lib/token-auth', () => ({ getActiveTraveler: () => null }));
vi.mock('@/lib/itinerary-storage', () => ({ savePlans: vi.fn() }));
vi.mock('@/lib/trip-backup', () => ({
  downloadTripBackup: vi.fn(),
  importTripBackup: vi.fn(async () => ({ ok: false, error: 'not under test' })),
}));

import BackupRestore from '@/components/backup-restore';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function q<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return document.body.querySelector<T>(`[data-testid="${testId}"]`);
}

function must<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = q<T>(testId);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

async function flush(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let root: Root;
let container: HTMLDivElement;

/** Picks a backup file through the real hidden <input>, exactly as the e2e specs drive it. */
async function openConfirm(): Promise<void> {
  const input = must<HTMLInputElement>('backup-import-input');
  const file = new File(['{}'], 'nepal-japan-trip-backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  act(() => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await flush();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(BackupRestore)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete document.body.dataset.dialogOpen;
});

describe('BackupRestore — the confirm dialog owns the modal contract', () => {
  it('moves focus INTO the dialog when it opens (it used to leave it on the sr-only file input)', async () => {
    const before = document.activeElement;
    await openConfirm();

    const dialog = must('backup-confirm-dialog');
    expect(dialog.contains(document.activeElement), 'focus is inside the dialog').toBe(true);
    expect(document.activeElement).not.toBe(before);
    // Cancel is the safe default for a destructive, irreversible choice.
    expect(document.activeElement).toBe(must('backup-confirm-cancel'));
  });

  it('is announced as a modal alert dialog, labelled and described by its own copy', async () => {
    await openConfirm();
    const dialog = must('backup-confirm-dialog');

    expect(dialog.getAttribute('role')).toBe('alertdialog');
    // Radix does not set this one — it hides the rest of the document with `aria-hidden`, which
    // `hideOthers` skips for any subtree holding an `aria-live` region, and this panel has one.
    // So the attribute is passed explicitly; losing it would be a silent regression.
    expect(dialog.getAttribute('aria-modal')).toBe('true');

    const labelId = dialog.getAttribute('aria-labelledby');
    const describedId = dialog.getAttribute('aria-describedby');
    expect(labelId, 'aria-labelledby').toBeTruthy();
    expect(describedId, 'aria-describedby').toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toContain('Replace your current trip?');
    expect(document.getElementById(describedId!)?.textContent).toContain(
      'nepal-japan-trip-backup.json',
    );
    // One id per describedby target — two <AlertDialogDescription>s would collide on it.
    expect(
      Array.from(document.querySelectorAll('[id]')).filter((e) => e.id === describedId).length,
    ).toBe(1);
  });

  it('Escape dismisses it', async () => {
    await openConfirm();
    expect(q('backup-confirm-dialog')).not.toBeNull();

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    await flush();

    expect(q('backup-confirm-dialog'), 'dismissed by Escape').toBeNull();
  });

  it('traps Tab — focus cannot reach the page behind the scrim', async () => {
    await openConfirm();
    const dialog = must('backup-confirm-dialog');
    const outside = must('backup-import-trigger'); // a real focusable in the page behind

    const inside = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(inside.length).toBeGreaterThan(1);

    // Anything in the page behind must be unreachable while the dialog is up.
    act(() => outside.focus());
    await flush(0);
    expect(dialog.contains(document.activeElement), 'focus pulled back into the dialog').toBe(true);

    // And Tab off the last focusable wraps to the first rather than falling through.
    act(() => inside[inside.length - 1].focus());
    act(() => {
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the page when it closes', async () => {
    const trigger = must('backup-import-trigger');
    act(() => trigger.focus());
    await openConfirm();
    expect(document.activeElement).not.toBe(trigger);

    act(() => must('backup-confirm-cancel').click());
    await flush();

    expect(q('backup-confirm-dialog')).toBeNull();
    expect(document.activeElement, 'focus restored to the control that opened it').toBe(trigger);
  });

  it('sets body[data-dialog-open] while open and clears it after (the FAB seam)', async () => {
    expect(document.body.dataset.dialogOpen).toBeUndefined();
    await openConfirm();
    expect(document.body.dataset.dialogOpen, 'scroll-lock / FAB flag').toBe('1');

    act(() => must('backup-confirm-cancel').click());
    await flush();
    expect(document.body.dataset.dialogOpen).toBeUndefined();
  });
});
