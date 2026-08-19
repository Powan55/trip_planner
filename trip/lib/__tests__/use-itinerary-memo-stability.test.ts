// @vitest-environment jsdom
//
// V6-1 (C-6/C-7) — the hook's returned store object must be referentially stable across a
// re-render that does NOT change `plans` (e.g. a parent re-render triggered by unrelated
// state). Before this slice, `useItinerary()` built a fresh object literal (and a fresh
// `exposedPlans` array via `visiblePlans(plans)`) on every render, so every consumer effect/
// memo keyed on the store object re-ran on every unrelated re-render. This test renders the
// REAL hook and forces a re-render via unrelated state, then asserts `Object.is` on both the
// whole store and `store.plans`.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { ItineraryStore } from '@/hooks/use-itinerary';

const state = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/itinerary-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/itinerary-ports')>();
  return {
    ...orig,
    itinerarySyncPort: {
      push: async () => {},
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useItinerary } from '@/hooks/use-itinerary';
import { savePlans } from '@/lib/itinerary-storage';

// Renders the real hook inside a Probe that ALSO carries unrelated state, so we can force a
// re-render (via that unrelated state) without touching `plans` — proving stability isn't just
// "called the hook function once and compared it to itself".
function renderWithUnrelatedState() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: ItineraryStore } = { current: null as unknown as ItineraryStore };
  let bumpUnrelated: () => void = () => {};

  function Probe() {
    const [, setTick] = useState(0);
    bumpUnrelated = () => setTick((t) => t + 1);
    ref.current = useItinerary();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    get current() {
      return ref.current;
    },
    async rerenderUnrelated() {
      await act(async () => {
        bumpUnrelated();
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  savePlans([]); // key present → the store loads [] and never reseeds the sample.
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('useItinerary() memo stability (V6-1 / C-6, C-7)', () => {
  it('returns the SAME store object (and the same plans array) across a re-render triggered by unrelated state', async () => {
    const h = renderWithUnrelatedState();
    const before = h.current;
    const beforePlans = h.current.plans;

    await h.rerenderUnrelated();

    expect(h.current).toBe(before);
    expect(h.current.plans).toBe(beforePlans);
    h.unmount();
  });

  it('still returns a NEW store (with new plans) when `plans` actually changes', async () => {
    const h = renderWithUnrelatedState();
    const before = h.current;

    await act(async () => {
      h.current.addItem('2027-01-05', { id: 'a', title: 'Temple', category: 'cultural' });
      await Promise.resolve();
    });

    expect(h.current).not.toBe(before);
    expect(h.current.plans).not.toBe(before.plans);
    h.unmount();
  });
});
