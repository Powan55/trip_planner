// @vitest-environment jsdom
//
// Issue #19 — "the assistant should refuse to double-book you". Two halves, both here:
//
// 1. `clashForOp` — the DETECTION, pure over `(op, plans)`, one case per verb plus the
//    grandfathering `removeItem`/no-span/footprint-unchanged escapes. It shares D-316 Slice A's
//    single predicate (`firstClashWith` + `timeFootprintChanged`), so these cases are the same
//    rule the five authoring surfaces enforce, reached through the ops layer.
//
// 2. The REAL `ConciergeChat` panel, driven end to end in jsdom against a stubbed Worker: a
//    conflicting Confirm applies NOTHING — asserted on the STORE (the localStorage bytes a
//    reload would read) and on `showUndoToast` never firing, not merely on the copy — and leaves
//    the chip on screen, unresolved and still confirmable. A clear one still applies and still
//    consumes its chip.
//
// Everything below the component is real: `useConciergeChat`, `useItinerary`, `validateOps`,
// `clashForOp`, `applyOp`. Only the network, the traveler/config gates and the undo toast are
// stubbed — the same harness shape `concierge-op-feedback.test.ts` established.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { TRIP_DATES } from '@/core/dates';
import { clashForOp, type Op } from '@/lib/concierge-ops';
import { ITINERARY_STORAGE_KEY, loadPlans } from '../itinerary-storage';
import type { DayPlan, ItineraryItem } from '../trip-data';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const undoSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/undo-toast', () => ({ showUndoToast: undoSpy }));
vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));
vi.mock('@/lib/concierge-config', () => ({
  CONCIERGE_URL: 'https://mock.example.workers.dev',
  isConciergeConfigured: () => true,
}));

import { ConciergeChat } from '@/components/concierge-chat';

const DAY = TRIP_DATES[3]; // Nepal leg → +345, and both sides of a same-day compare share it
const OTHER = TRIP_DATES[4];

// 19:00–20:30. The blocker in nearly every case below.
const DINNER: ItineraryItem = {
  id: 'dinner',
  title: 'Dinner',
  category: 'food',
  startMinutes: 1140,
  durationMinutes: 90,
};
// 19:30–19:45, deliberately INSIDE Dinner — a stand-in for the seed's three intentional
// containments (D-316 Part 3). It must stay editable through the concierge.
const TOAST: ItineraryItem = {
  id: 'toast',
  title: 'Countdown toast',
  category: 'nightlife',
  startMinutes: 1170,
  durationMinutes: 15,
};
// 15:00–16:00, clear of everything.
const WALK: ItineraryItem = {
  id: 'walk',
  title: 'Thamel walk',
  category: 'sightseeing',
  startMinutes: 900,
  durationMinutes: 60,
};
// The shape all 158 seed items actually have: free text, no structured minutes at all. 19:30–21:00.
const SEED_SHAPED: ItineraryItem = {
  id: 'legacy-1',
  title: 'Momo crawl',
  category: 'food',
  time: '7:30 PM',
  duration: '1h 30m',
};
// On OTHER, so a moveItem has somewhere to come from.
const ONSEN: ItineraryItem = {
  id: 'onsen',
  title: 'Onsen',
  category: 'free',
  startMinutes: 1170,
  durationMinutes: 60,
};
const UNTIMED: ItineraryItem = { id: 'gift', title: 'Buy gifts', category: 'shopping' };

const PLANS: DayPlan[] = [
  { date: DAY, city: 'Kathmandu', country: 'nepal', items: [DINNER, TOAST, WALK] },
  { date: OTHER, city: 'Kathmandu', country: 'nepal', items: [ONSEN, UNTIMED] },
];

describe('issue #19 — clashForOp detects the collision a confirmed op would create', () => {
  it('addItem — blocked by the item its window lands on, and clear when it does not', () => {
    const blocked = clashForOp(
      { type: 'addItem', date: DAY, title: 'Ramen', category: 'food', startMinutes: 1170, durationMinutes: 60 },
      PLANS,
    );
    expect(blocked?.id).toBe('dinner'); // 19:30–20:30 lands inside 19:00–20:30

    const clear = clashForOp(
      { type: 'addItem', date: DAY, title: 'Ramen', category: 'food', startMinutes: 1260, durationMinutes: 60 },
      PLANS,
    );
    expect(clear).toBeUndefined(); // 21:00–22:00
  });

  it('addItem — half-open: a start exactly on another item’s end never collides', () => {
    expect(
      clashForOp(
        { type: 'addItem', date: DAY, title: 'Nightcap', category: 'nightlife', startMinutes: 1230, durationMinutes: 60 },
        PLANS,
      ),
    ).toBeUndefined(); // 20:30–21:30 begins exactly where Dinner ends
  });

  it('addItem — an op with no duration (or no time) has no span and can never be blocked', () => {
    expect(
      clashForOp({ type: 'addItem', date: DAY, title: 'Ramen', category: 'food', startMinutes: 1170 }, PLANS),
    ).toBeUndefined();
    expect(
      clashForOp({ type: 'addItem', date: DAY, title: 'Ramen', category: 'food', durationMinutes: 60 }, PLANS),
    ).toBeUndefined();
  });

  it('addItem — a day the traveller has never touched has nothing to collide with', () => {
    expect(
      clashForOp(
        { type: 'addItem', date: TRIP_DATES[9], title: 'Ramen', category: 'food', startMinutes: 1170, durationMinutes: 60 },
        PLANS,
      ),
    ).toBeUndefined();
  });

  it('addItem — collides with a FREE-TEXT seed item, which is the shape the real content has', () => {
    const seeded: DayPlan[] = [{ date: DAY, city: 'Kathmandu', country: 'nepal', items: [SEED_SHAPED] }];
    expect(
      clashForOp(
        { type: 'addItem', date: DAY, title: 'Ramen', category: 'food', startMinutes: 1200, durationMinutes: 30 },
        seeded,
      )?.id,
    ).toBe('legacy-1'); // 20:00–20:30 inside the parsed 19:30–21:00
  });

  it('updateItem — a time patch is checked MERGED over the live item, on the item’s real day', () => {
    // Walk (15:00–16:00) retimed to 19:00 lands on Dinner.
    expect(clashForOp({ type: 'updateItem', itemId: 'walk', startMinutes: 1140 }, PLANS)?.id).toBe('dinner');
    // …and to 21:00 does not.
    expect(clashForOp({ type: 'updateItem', itemId: 'walk', startMinutes: 1260 }, PLANS)).toBeUndefined();
    // A duration-only stretch is equally a footprint move: 15:00 + 5h runs to 20:00.
    expect(clashForOp({ type: 'updateItem', itemId: 'walk', durationMinutes: 300 }, PLANS)?.id).toBe('dinner');
  });

  it('updateItem — never self-blocks: retiming an item onto its OWN stored window is clear', () => {
    expect(clashForOp({ type: 'updateItem', itemId: 'walk', startMinutes: 901 }, PLANS)).toBeUndefined();
  });

  it('updateItem — footprint-scoped: an already-overlapping item stays editable', () => {
    // The containment case. A notes/title/category patch on an item that ALREADY overlaps must
    // not be refused, or the seed's deliberate containments become uneditable via the concierge.
    expect(clashForOp({ type: 'updateItem', itemId: 'toast', notes: 'bring the flag' }, PLANS)).toBeUndefined();
    expect(clashForOp({ type: 'updateItem', itemId: 'toast', title: 'Midnight toast' }, PLANS)).toBeUndefined();
    // …and neither is a patch that merely RE-STATES the time the item already has.
    expect(clashForOp({ type: 'updateItem', itemId: 'toast', startMinutes: 1170 }, PLANS)).toBeUndefined();
    // But moving it — even by a minute — is a footprint change and is guarded again.
    expect(clashForOp({ type: 'updateItem', itemId: 'toast', startMinutes: 1171 }, PLANS)?.id).toBe('dinner');
  });

  it('moveItem — checked against toDate, and clear when the target day has room', () => {
    // Onsen 19:30–20:30 moved onto DAY lands on Dinner.
    expect(clashForOp({ type: 'moveItem', itemId: 'onsen', fromDate: OTHER, toDate: DAY }, PLANS)?.id).toBe('dinner');
    // The untimed item has no span, so it can move anywhere.
    expect(clashForOp({ type: 'moveItem', itemId: 'gift', fromDate: OTHER, toDate: DAY }, PLANS)).toBeUndefined();
    // And an empty day takes anything.
    expect(
      clashForOp({ type: 'moveItem', itemId: 'onsen', fromDate: OTHER, toDate: TRIP_DATES[9] }, PLANS),
    ).toBeUndefined();
  });

  it('removeItem is NEVER blocked — deleting cannot create an overlap', () => {
    // 'toast' is inside 'dinner': the day it sits on is already overlapping, and removing either
    // of them must still go through.
    expect(clashForOp({ type: 'removeItem', itemId: 'toast', date: DAY }, PLANS)).toBeUndefined();
    expect(clashForOp({ type: 'removeItem', itemId: 'dinner', date: DAY }, PLANS)).toBeUndefined();
  });

  it('an op whose target has since vanished resolves to no clash (the chip re-validates away)', () => {
    expect(clashForOp({ type: 'updateItem', itemId: 'ghost', startMinutes: 1140 }, PLANS)).toBeUndefined();
    expect(clashForOp({ type: 'moveItem', itemId: 'ghost', fromDate: OTHER, toDate: DAY }, PLANS)).toBeUndefined();
  });
});

// ── The panel ────────────────────────────────────────────────────────────────────────────────

const PANEL_SEED: DayPlan[] = [{ date: DAY, city: 'Kathmandu', country: 'nepal', items: [DINNER] }];

const CONFLICTING: Op = {
  type: 'addItem',
  date: DAY,
  title: 'Ramen',
  category: 'food',
  startMinutes: 1170, // 19:30–20:30, straight through Dinner
  durationMinutes: 60,
};
const CLEAR: Op = { ...CONFLICTING, startMinutes: 1260 }; // 21:00–22:00

/** Mount the panel, open the Sheet, and send one message through the real hook. */
async function drive(ops: unknown[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ reply: 'Here you go.', ops }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );

  await act(async () => {
    root.render(createElement(ConciergeChat));
  });
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="concierge-trigger"]')!.click();
  });

  const input = document.querySelector<HTMLInputElement>('[data-testid="concierge-input"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, 'add ramen at 7:30');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  return {
    chips: () => Array.from(document.querySelectorAll('[data-testid="concierge-op-chip"]')),
    alerts: () => Array.from(document.querySelectorAll('[data-testid="concierge-op-clash"]')),
    async confirm(index = 0) {
      await act(async () => {
        document.querySelectorAll<HTMLButtonElement>('[data-testid="concierge-op-confirm"]')[index].click();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** The raw persisted bytes. */
const storedBytes = () => localStorage.getItem(ITINERARY_STORAGE_KEY);
/**
 * Live (non-tombstoned) titles on `DAY` as a FRESH MOUNT would read them back — `loadPlans()`
 * is exactly the read path a reload runs (it unwraps the v3 Vault envelope a commit writes, and
 * the bare array this suite seeds), so this asserts on disk, not on render state.
 */
function storedTitlesOnDay(): string[] {
  return (loadPlans().find((d) => d.date === DAY)?.items ?? [])
    .filter((i) => i.deleted !== true)
    .map((i) => i.title);
}

describe('issue #19 — the concierge Confirm refuses to double-book', () => {
  beforeEach(() => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(PANEL_SEED));
    undoSpy.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('a conflicting Confirm writes NOTHING and leaves the chip unresolved', async () => {
    const h = await drive([CONFLICTING]);
    expect(h.chips()).toHaveLength(1);
    const before = storedBytes(); // post-hydration, pre-confirm

    await h.confirm();

    // THE load-bearing assertion: the store is byte-for-byte what it was.
    expect(storedBytes()).toBe(before);
    expect(storedTitlesOnDay()).toEqual(['Dinner']); // no Ramen, on disk
    expect(undoSpy).not.toHaveBeenCalled(); // applyOp never ran — there is nothing to undo
    // …and the proposal is still on screen, still confirmable once the clash is settled.
    expect(h.chips()).toHaveLength(1);
    h.unmount();
  });

  it('…and says what it collides with, in an assertive live region on that chip', async () => {
    const h = await drive([CONFLICTING]);
    expect(h.alerts()[0].textContent).toBe('');

    await h.confirm();

    const alert = h.alerts()[0];
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('overlaps “Dinner”, 7:00 PM–8:30 PM');
    expect(alert.textContent).toContain('Ask me for a different time, or change that plan first');
    // The live region is mounted (and one line height-reserved) BEFORE it has anything to say, so
    // the announcement is a text change, not a node insertion — which is what makes it reliably
    // announced. The chip still grows if the message wraps past that reserved line.
    expect(alert.className).toContain('min-h-[1rem]');
    h.unmount();
  });

  it('a NON-conflicting op still applies and still consumes its chip', async () => {
    const h = await drive([CLEAR]);
    expect(h.chips()).toHaveLength(1);

    await h.confirm();

    expect(storedTitlesOnDay()).toEqual(['Dinner', 'Ramen']);
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(h.chips()).toHaveLength(0);
    h.unmount();
  });

  it('refusing one chip does not block the others in the same turn', async () => {
    const h = await drive([CONFLICTING, CLEAR]);
    expect(h.chips()).toHaveLength(2);

    await h.confirm(0); // the conflicting one — refused
    expect(h.chips()).toHaveLength(2);
    expect(h.alerts()[0].textContent).toContain('overlaps “Dinner”');
    expect(h.alerts()[1].textContent).toBe(''); // and the sibling chip says nothing

    await h.confirm(1); // the clear one — applies
    expect(storedTitlesOnDay()).toEqual(['Dinner', 'Ramen']);
    expect(h.chips()).toHaveLength(1); // only the refused proposal is left
    h.unmount();
  });

  it('the same chip goes through once the conflict is gone', async () => {
    const h = await drive([CONFLICTING]);
    await h.confirm();
    expect(storedTitlesOnDay()).toEqual(['Dinner']);

    // Resolve it the way the copy suggests — change the existing plan — from another surface,
    // then press the SAME chip again. The check re-runs against live plans, so it now passes.
    await act(async () => {
      localStorage.setItem(
        ITINERARY_STORAGE_KEY,
        JSON.stringify([{ ...PANEL_SEED[0], items: [{ ...DINNER, durationMinutes: 30 }] }]),
      );
      window.dispatchEvent(new Event('itinerary:changed'));
    });

    await h.confirm();
    expect(storedTitlesOnDay()).toEqual(['Dinner', 'Ramen']);
    expect(h.chips()).toHaveLength(0);
    h.unmount();
  });
});
