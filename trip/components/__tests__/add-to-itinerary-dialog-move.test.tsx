// @vitest-environment jsdom
//
// #540: moving an item to another day from the edit dialog re-keyed it via
// removeItem + addItem, which drops everything the patch doesn't carry — the pin
// (lat/lng), the done tick, tzOffsetMin, ord, etc. This pins the fix: a cross-day
// edit must go through moveItem (preserves content, mints the sync-safe id) then
// updateItem on the landed id (applies only the edited fields).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { TRIP_DATES } from '@/lib/trip-data';

vi.mock('sonner', () => {
  const toast: any = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() });
  return { toast };
});

vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = (p: any) => {
    const { initial, animate, exit, whileHover, whileInView, whileTap, viewport, transition, layout, onExitComplete, ...rest } = p;
    return rest;
  };
  return {
    m: { div: (props: any) => React.createElement('div', strip(props)) },
    AnimatePresence: ({ children }: any) => children,
    useReducedMotion: () => false,
  };
});

const addItem = vi.fn();
const removeItem = vi.fn();
const updateItem = vi.fn();
const moveItem = vi.fn((_itemId: string, _from: string, _to: string) => 'landed-fresh-id');

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({
    addItem,
    updateItem,
    removeItem,
    restoreItem: vi.fn(),
    getDayPlan: () => ({ items: [] }),
    moveItem,
  }),
}));

import AddToItineraryDialog from '@/components/add-to-itinerary-dialog';

function q(testId: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
}

let teardown: (() => void) | null = null;
afterEach(() => {
  teardown?.();
  teardown = null;
  addItem.mockClear();
  removeItem.mockClear();
  updateItem.mockClear();
  moveItem.mockClear();
});

async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

describe('editing then changing day moves via moveItem, not remove+add', () => {
  it('calls moveItem + updateItem, never removeItem/addItem, on a cross-day edit', async () => {
    const fromDate = TRIP_DATES[0];
    const toDate = TRIP_DATES[1];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    teardown = () => {
      act(() => root.unmount());
      container.remove();
    };

    act(() => {
      root.render(
        createElement(AddToItineraryDialog, {
          open: true,
          draft: {
            title: 'Boudhanath Stupa',
            location: 'Kathmandu',
            category: 'sightseeing',
            sourceId: 'boudhanath',
            sourceType: 'recommendation',
          },
          existingPlacements: [{ date: fromDate, item: { id: 'existing-1', title: 'Boudhanath Stupa', category: 'sightseeing' } as any }],
          onClose: vi.fn(),
        }),
      );
    });
    await flush();

    // Enter modify mode for the existing placement.
    const modifyButton = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="add-item-dialog"] button',
    );
    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button'));
    const modify = buttons.find((b) => b.textContent === 'Modify');
    expect(modify).toBeTruthy();
    act(() => modify!.click());
    await flush();

    // Change the day select to a different trip date.
    const select = q('add-item-day-select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
      setter.call(select, toDate);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    const confirm = q('add-item-confirm') as HTMLButtonElement;
    act(() => confirm.click());
    await flush();

    expect(moveItem).toHaveBeenCalledWith('existing-1', fromDate, toDate);
    expect(updateItem).toHaveBeenCalledWith(toDate, 'landed-fresh-id', expect.any(Object));
    expect(removeItem).not.toHaveBeenCalled();
    expect(addItem).not.toHaveBeenCalled();
  });
});
