// @vitest-environment jsdom
//
// S329 — TARGETED integration proof of the concierge write path, end to end through the REAL
// hooks (no network): `useConciergeChat` parses a stubbed `{reply, ops}`, `validateOps` runs
// against the LIVE `useItinerary().plans`, and an explicit Confirm executes the op through the
// real itinerary store and PERSISTS to localStorage (the client "hard guarantee"), while an
// invalid op is dropped and the reply still renders. `showUndoToast` is spied (no Toaster mount).
//
// This composes the exact code path `components/concierge-chat.tsx` runs (same helpers, same
// hooks) in a lightweight harness — the strongest honest proof without driving Radix's Sheet.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, Fragment } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { TRIP_DATES } from '@/core/dates';
import { joinTrip } from '@/core/trips/registry';

// React 18 gates async act() DOM flushing on this global — without it a state update inside act
// commits but the query below reads a stale DOM ("not configured to support act(...)").
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const undoSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/undo-toast', () => ({ showUndoToast: undoSpy }));

// The concierge is dormant by default (NEXT_PUBLIC_CONCIERGE_URL unset) — mock a URL so `send()`
// actually fetches instead of short-circuiting to the "not configured" error.
vi.mock('@/lib/concierge-config', () => ({
  CONCIERGE_URL: 'https://concierge.example.workers.dev',
  isConciergeConfigured: () => true,
}));

// S389-A: a controllable remote gate so this suite can exercise the SYNC-ON store branch — the only
// branch where the move-undo defect existed (sync is on in production, D-248). Default `false`
// keeps every pre-existing test in this file on the dormant path it was written against.
const remote = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => remote.on,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => remote.on,
  getTripId: () => 'nepal-japan-2026',
}));
// …and never let the sync fan-out touch firebase from here: stub only the SyncPort (the real
// StoragePort is left alone — `readStored()` below is the reload-grade read this suite asserts on).
vi.mock('@/lib/itinerary-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/itinerary-ports')>();
  return {
    ...orig,
    itinerarySyncPort: {
      push: async () => {},
      subscribe: () => () => {},
      isConfigured: () => remote.on,
    },
  };
});

import { useConciergeChat } from '@/hooks/use-concierge-chat';
import { useItinerary, type ItineraryStore } from '@/hooks/use-itinerary';
import { validateOps, applyOp, describeOp } from '@/lib/concierge-ops';
import { showUndoToast } from '@/lib/undo-toast';
import { ITINERARY_STORAGE_KEY } from '../itinerary-storage';
import { itineraryStoragePort } from '@/lib/itinerary-ports';
import type { DayPlan } from '../trip-data';

const TARGET_DATE = TRIP_DATES[5];
const MOVE_TO_DATE = TRIP_DATES[6];

/** LIVE (non-tombstoned) items on `date` as a FRESH read would see them after a reload. */
function liveStoredOn(date: string) {
  return (readStored().find((d) => d.date === date)?.items ?? []).filter((i) => i.deleted !== true);
}

function jsonFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

// The persistence "hard guarantee": what a FRESH mount would read back from disk. itinerary
// StoragePort.load() is exactly the read path a reload runs (it parses the Vault envelope the
// commit wrote), so asserting through it proves the item survives a reload.
function readStored(): DayPlan[] {
  return itineraryStoragePort.load();
}

interface Handle {
  send: () => Promise<void>;
  /** Drive the REAL store directly (seeding a fixture item), act-wrapped. */
  run: (fn: (store: ItineraryStore) => void) => Promise<void>;
  confirm: (index: number) => Promise<void>;
  replyText: () => string;
  chipCount: () => number;
  livePlans: () => DayPlan[];
  unmount: () => void;
}

function renderHarness(fetchImpl: typeof fetch): Handle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  // Capture the live render state per commit (the SAME values the DOM renders from). We assert on
  // these rather than the DOM because react-dom/client's async-act DOM flush is flaky under vitest;
  // the sibling use-concierge-chat.test.ts reads hook state the same way. The chips ARE rendered to
  // `container` (proving the render path), and confirm runs the real chip onClick logic.
  const ref: {
    chat: ReturnType<typeof useConciergeChat> | null;
    store: ReturnType<typeof useItinerary> | null;
    validated: ReturnType<typeof validateOps>;
    plansAtRender: DayPlan[];
  } = { chat: null, store: null, validated: [], plansAtRender: [] };

  function Harness() {
    const chat = useConciergeChat(fetchImpl);
    const store = useItinerary();
    const plans = store.plans;
    const last = chat.messages[chat.messages.length - 1];
    const ops = last && last.role === 'assistant' && last.ops ? validateOps(last.ops, plans) : [];
    ref.chat = chat;
    ref.store = store;
    ref.validated = ops;
    ref.plansAtRender = plans;
    return createElement(
      'div',
      null,
      createElement('div', { 'data-testid': 'reply' }, last && last.role === 'assistant' ? last.content : ''),
      ...ops.map((op, j) =>
        createElement(
          'div',
          { key: j, role: 'group', 'data-testid': 'concierge-op-chip' },
          createElement('span', null, describeOp(op, plans)),
          createElement(
            'button',
            {
              'data-testid': `chip-${j}`,
              onClick: () => {
                const { message, undo } = applyOp(op, store, plans);
                showUndoToast(message, undo);
              },
            },
            'Confirm',
          ),
        ),
      ),
    );
  }

  act(() => {
    root.render(createElement(Fragment, null, createElement(Harness)));
  });

  return {
    async send() {
      await act(async () => {
        await ref.chat!.send('do it');
      });
    },
    async run(fn) {
      await act(async () => {
        fn(ref.store!);
        await Promise.resolve();
      });
    },
    async confirm(index: number) {
      // Run the real chip onClick path (applyOp → showUndoToast) inside act.
      await act(async () => {
        const op = ref.validated[index];
        const { message, undo } = applyOp(op, ref.store!, ref.plansAtRender);
        showUndoToast(message, undo);
      });
    },
    replyText: () => {
      const last = ref.chat!.messages[ref.chat!.messages.length - 1];
      return last && last.role === 'assistant' ? last.content : '';
    },
    chipCount: () => ref.validated.length,
    livePlans: () => ref.store!.plans,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  } as Handle;
}

describe('concierge write path (S329 integration)', () => {
  beforeEach(() => {
    // Full isolation (#10): the SYNC ON case below switches the active-trip pointer to a custom
    // trip, and localStorage persists across tests in one jsdom file — clear it so no test
    // inherits another's pointer/registry/scoped keys.
    localStorage.clear();
    // Key PRESENT with [] so loadPlans does not reseed SAMPLE_ITINERARY (D-018 key-presence) — a
    // clean, empty itinerary to add into.
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify([]));
    undoSpy.mockClear();
    remote.on = false;
  });

  it('renders the reply + ONE valid chip (the invalid op is dropped)', async () => {
    const h = renderHarness(
      jsonFetch({
        reply: 'Here is a plan idea.',
        ops: [
          { type: 'addItem', date: TARGET_DATE, title: 'Concierge Ramen', category: 'food', startMinutes: 1140 },
          { type: 'addItem', date: TARGET_DATE, title: 'Bad one', category: 'brunch' }, // dropped
        ],
      }),
    );
    await h.send();

    expect(h.replyText()).toBe('Here is a plan idea.');
    expect(h.chipCount()).toBe(1); // only the valid op survived
    h.unmount();
  });

  it('confirm executes through useItinerary → the item PERSISTS to localStorage and an undo toast shows', async () => {
    const h = renderHarness(
      jsonFetch({
        reply: 'Added it.',
        ops: [{ type: 'addItem', date: TARGET_DATE, title: 'Concierge Ramen', category: 'food', startMinutes: 1140 }],
      }),
    );
    await h.send();
    expect(h.chipCount()).toBe(1);

    await h.confirm(0);

    // (a) live store reflects the add
    const day = h.livePlans().find((d) => d.date === TARGET_DATE);
    const added = day?.items.find((i) => i.title === 'Concierge Ramen');
    expect(added).toBeTruthy();
    expect(added!.category).toBe('food');
    expect(added!.startMinutes).toBe(1140);
    expect(added!.id).toEqual(expect.any(String)); // minted client id

    // (b) PERSISTENCE hard-guarantee: the item is on disk (survives a reload — a fresh read of the
    // same localStorage key returns it).
    const stored = readStored().find((d) => d.date === TARGET_DATE);
    expect(stored?.items.some((i) => i.title === 'Concierge Ramen')).toBe(true);

    // (c) undo toast wired
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy.mock.calls[0][0]).toContain('Concierge Ramen'); // message
    expect(typeof undoSpy.mock.calls[0][1]).toBe('function'); // undo fn

    // (d) undo removes it again (proves pre-state capture)
    const undoFn = undoSpy.mock.calls[0][1] as () => void;
    await act(async () => undoFn());
    const afterUndo = readStored().find((d) => d.date === TARGET_DATE);
    expect(afterUndo?.items.some((i) => i.title === 'Concierge Ramen')).toBe(false);

    h.unmount();
  });

  // ── S389-A ────────────────────────────────────────────────────────────────────────────────
  // The discriminating proof for the Move undo. SYNC ON is the branch that matters (D-248: sync
  // is configured in production) because that is where `hooks/use-itinerary.ts` → `moveItem`
  // mints a FRESH id for the target copy via `freshCopyOf`. Inverting the move by the ORIGINAL
  // id therefore resolves nothing: the undo toast appears and the item stays where it was moved.
  //
  // This asserts RESULTING STATE, read back through the StoragePort (i.e. what a reload would
  // show), not call args — a call-args assertion against a stateless fake is exactly the
  // instrument that let the defect ship green.
  it('SYNC ON: undo of a confirmed moveItem actually moves the item BACK (S389-A)', async () => {
    remote.on = true;
    // #10 — sync-on now implies "not the default pack": the hook's send() refuses the default
    // trip on a configured build (guard b), and the default pack no longer syncs at all. So this
    // scenario runs where it is actually reachable in production: a REGISTERED custom trip
    // (registered via joinTrip, so guard a passes). The store branch under test is unchanged —
    // use-itinerary's fresh-id mint gates on isRemoteConfigured(), not on which trip is active.
    // validateOps' date fence is the module-level TRIP_DATES (loaded before the pointer switch),
    // so TARGET_DATE stays valid; the itinerary key is seeded in this trip's scoped namespace.
    joinTrip('sync-on-coverage-trip', 'Sync-on coverage');
    localStorage.setItem('trip:sync-on-coverage-trip:itinerary', JSON.stringify([]));
    const h = renderHarness(
      jsonFetch({
        reply: 'Moving it.',
        ops: [{ type: 'moveItem', itemId: 'seed-1', fromDate: TARGET_DATE, toDate: MOVE_TO_DATE }],
      }),
    );
    await h.run((s) =>
      s.addItem(TARGET_DATE, { id: 'seed-1', title: 'Boudhanath Stupa', category: 'sightseeing' }),
    );
    await h.send();
    expect(h.chipCount()).toBe(1);

    await h.confirm(0);

    // (a) the move landed, and it landed under a FRESH id — this is what makes the old inverse a
    //     no-op, asserted here so the test would still be meaningful if that mechanic changed.
    expect(liveStoredOn(TARGET_DATE)).toHaveLength(0);
    expect(liveStoredOn(MOVE_TO_DATE)).toHaveLength(1);
    expect(liveStoredOn(MOVE_TO_DATE)[0].id).not.toBe('seed-1');

    // (b) THE POINT: undo puts it back on the day it came from.
    const undoFn = undoSpy.mock.calls[0][1] as () => void;
    await act(async () => undoFn());

    expect(liveStoredOn(MOVE_TO_DATE)).toHaveLength(0);
    const back = liveStoredOn(TARGET_DATE);
    expect(back).toHaveLength(1);
    expect(back[0].title).toBe('Boudhanath Stupa');

    h.unmount();
  });

  // The dormant build keeps the item's id across a move, so the same undo must work there too —
  // the fix must not trade one broken branch for the other.
  it('DORMANT: undo of a confirmed moveItem also moves the item back (S389-A)', async () => {
    const h = renderHarness(
      jsonFetch({
        reply: 'Moving it.',
        ops: [{ type: 'moveItem', itemId: 'seed-1', fromDate: TARGET_DATE, toDate: MOVE_TO_DATE }],
      }),
    );
    await h.run((s) =>
      s.addItem(TARGET_DATE, { id: 'seed-1', title: 'Boudhanath Stupa', category: 'sightseeing' }),
    );
    await h.send();
    await h.confirm(0);

    expect(liveStoredOn(MOVE_TO_DATE).map((i) => i.id)).toEqual(['seed-1']); // same id, dormant
    const undoFn = undoSpy.mock.calls[0][1] as () => void;
    await act(async () => undoFn());

    expect(liveStoredOn(MOVE_TO_DATE)).toHaveLength(0);
    expect(liveStoredOn(TARGET_DATE).map((i) => i.id)).toEqual(['seed-1']);

    h.unmount();
  });
});
