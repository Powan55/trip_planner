// @vitest-environment jsdom
//
// One Escape press closed BOTH the add-to-plan dialog and the place-detail sheet under it, so
// the user lost the place they were reading. Both layers register on `document`, and
// `preventDefault()` in the deeper handler cannot stop the shallower one from also running; the
// sheet's `disableEscape` prop could not be wired for this path either, because `AddToPlanButton`
// owns the dialog's `open` privately. The fix is in the layer stack every modal already registers
// with (`hooks/use-dialog-open-flag.ts`): a covered sheet takes its own Escape listener down.
//
// Real components end to end — PlaceDetailSheet -> AddToPlanButton -> AddToItineraryDialog — on
// the same act/createRoot shim as lib/__tests__/import-place-sheet.test.ts (no @testing-library
// dep in this repo); framer-motion and sonner are passthrough-mocked and `useItineraryContext` is
// stubbed, since none of the three is what is under test here.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('sonner', () => {
  const toast: any = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast };
});

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({
    findPlacements: () => [],
    addItem: vi.fn(),
    updateItem: vi.fn(),
    removeItem: vi.fn(),
    restoreItem: vi.fn(),
    getDayPlan: () => ({ items: [] }),
  }),
}));

vi.mock('@/hooks/use-expenses', () => ({
  useExpenses: () => ({ addExpense: vi.fn(), updateExpense: vi.fn(), expenses: [] }),
}));

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: null }),
}));

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = (p: any) => {
    const {
      initial, animate, exit, whileHover, whileInView, whileTap, viewport,
      transition, layout, onExitComplete, ...rest
    } = p;
    return rest;
  };
  return {
    m: { div: (props: any) => React.createElement('div', strip(props)) },
    AnimatePresence: ({ children }: any) => children,
    useReducedMotion: () => false,
  };
});

// Imported AFTER the mocks are registered.
import PlaceDetailSheet, { type PlaceDetailData } from '@/components/place-detail-sheet';
import Sheet from '@/components/ui/sheet-dark';
import ExpenseDialog from '@/components/expense-dialog';
import { LEGS } from '@/core/budget/model';
import { FOCUSABLE } from '@/hooks/use-modal-keys';
import type { Recommendation } from '@/lib/nepal-data';

const PLACE: PlaceDetailData = {
  id: 'boudhanath',
  name: 'Boudhanath Stupa',
  country: 'Nepal',
  location: 'Kathmandu',
  description: 'One of the largest stupas in the world.',
};

const SOURCE: Recommendation = {
  id: 'boudhanath',
  name: 'Boudhanath Stupa',
  category: 'Temple',
  description: 'One of the largest stupas in the world.',
  bestTime: 'Sunset',
  duration: '2 hours',
  photoRating: 5,
  notes: '',
  location: 'Kathmandu',
};

function q(testId: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

function must(testId: string): HTMLElement {
  const el = q(testId);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

async function flush(ms = 60): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let teardown: (() => void) | null = null;

function renderSheet(onClose: () => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(PlaceDetailSheet, {
        open: true,
        place: PLACE,
        onClose,
        addSource: SOURCE,
        addSourceType: 'recommendation',
      }),
    );
  });
  teardown = () => {
    act(() => root.unmount());
    container.remove();
  };
}

afterEach(() => {
  teardown?.();
  teardown = null;
});

describe('Escape closes the topmost layer only', () => {
  it('leaves the sheet open when one press closes the dialog above it', async () => {
    const onClose = vi.fn();
    renderSheet(onClose);
    await flush();

    expect(q('place-detail-sheet')).not.toBeNull();

    // The source-linked path: AddToPlanButton renders its own dialog and owns `open`.
    const trigger = must('place-detail-add-to-plan').querySelector('button');
    expect(trigger).not.toBeNull();
    act(() => trigger!.click());
    await flush();
    expect(q('add-item-dialog')).not.toBeNull();

    pressEscape();
    await flush();

    // The dialog is gone; the sheet is untouched and was never asked to close.
    expect(q('add-item-dialog')).toBeNull();
    expect(q('place-detail-sheet')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // …and the sheet takes its own Escape back: the SECOND press closes it.
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still closes the sheet on Escape when nothing is open over it', async () => {
    const onClose = vi.fn();
    renderSheet(onClose);
    await flush();

    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('releases body[data-dialog-open] only when the last layer goes', async () => {
    const onClose = vi.fn();
    renderSheet(onClose);
    await flush();
    expect(document.body.dataset.dialogOpen).toBe('1');

    const trigger = must('place-detail-add-to-plan').querySelector('button');
    act(() => trigger!.click());
    await flush();
    expect(document.body.dataset.dialogOpen).toBe('1');

    pressEscape();
    await flush();
    // The dialog closed on top of an open sheet — the flag is the sheet's to hold (#130).
    expect(document.body.dataset.dialogOpen).toBe('1');

    teardown?.();
    teardown = null;
    expect(document.body.dataset.dialogOpen).toBeUndefined();
  });
});

// The expense dialog reaches the same layer stack through `hooks/use-modal-keys.ts` rather than
// by registering itself, so this covers the OTHER dialog's route to the same guarantee. Its real
// host mounts it at app level, never inside a sheet — the sheet here is the general case the
// primitive has to survive, since nothing stops a future surface from doing exactly this.
function renderSheetThenExpense(onSheetClose: () => void, onDialogClose: () => void) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const draw = (dialogOpen: boolean) =>
    act(() => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(Sheet, {
            open: true,
            onClose: onSheetClose,
            testId: 'probe-sheet',
            children: createElement('button', { type: 'button' }, 'in the sheet'),
          }),
          dialogOpen
            ? createElement(ExpenseDialog, {
                open: true,
                presetLeg: LEGS[0],
                onClose: onDialogClose,
              })
            : null,
        ),
      );
    });
  teardown = () => {
    act(() => root.unmount());
    container.remove();
  };
  return draw;
}

describe('the expense dialog reaches the layer stack through the shared hook', () => {
  it('one Escape closes it and leaves the sheet under it open', async () => {
    const onSheetClose = vi.fn();
    const onDialogClose = vi.fn();
    const draw = renderSheetThenExpense(onSheetClose, onDialogClose);

    // The sheet registers first, exactly as it would in the product.
    draw(false);
    await flush();
    expect(q('probe-sheet')).not.toBeNull();

    draw(true);
    await flush();
    expect(q('expense-dialog')).not.toBeNull();

    pressEscape();
    expect(onDialogClose).toHaveBeenCalledTimes(1);
    expect(onSheetClose).not.toHaveBeenCalled();

    // The host would unmount it on that callback; the sheet then takes Escape back.
    draw(false);
    await flush();
    pressEscape();
    expect(onSheetClose).toHaveBeenCalledTimes(1);
  });

  it('traps Tab inside its own panel', async () => {
    // jsdom has no layout, so `offsetParent` is null for every element and the trap's
    // visibility filter would otherwise keep only the focused one. Stub it to "attached means
    // visible" — the filter exists to skip collapsed sections, not to be exercised here.
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
      configurable: true,
      get(this: HTMLElement) {
        return this.isConnected ? document.body : null;
      },
    });
    try {
      const draw = renderSheetThenExpense(vi.fn(), vi.fn());
      draw(false);
      await flush();
      draw(true);
      await flush();

      const panel = must('expense-dialog');
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      expect(focusable.length).toBeGreaterThan(1);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      act(() => last.focus());
      expect(document.activeElement).toBe(last);
      act(() => {
        panel.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        );
      });
      expect(document.activeElement).toBe(first);

      act(() => {
        panel.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
        );
      });
      expect(document.activeElement).toBe(last);
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'offsetParent', original);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetParent;
    }
  });
});
