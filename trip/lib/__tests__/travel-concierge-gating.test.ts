// @vitest-environment jsdom
//
// S343 — the Travel Mode concierge mount (`components/travel-concierge.tsx`).
//
// The built `out/` is DORMANT (`NEXT_PUBLIC_CONCIERGE_URL` unset → ConciergeChat renders null), so
// no E2E can see the panel on /travel — the e2e asserts the ABSENCE instead. This is the other
// half: the mount's OWN rule, `isConciergeAllowedForActiveTrip()` (lib/concierge-config.ts), which
// navbar.tsx calls too — D-265, ONE copy of the rule, so the two mounts cannot disagree.
//
// 2026-08-09: that rule is now OPEN on every trip. The trip-aware Worker is deployed (see the
// block above the last test), so `CONCIERGE_ON_CUSTOM_TRIPS === true` and the mount no longer
// depends on `isDefaultTrip()` at all. The two tests below therefore both expect a mount; the
// third pins the constant that makes that true.
//
// `next/dynamic` is mocked to a synchronous stub: this file is about the gate, not about React.lazy
// resolution, and ConciergeChat's own gates (configured + active traveler) already have their
// proofs in concierge-chat-gating.test.ts / concierge-chat-dormant.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const state = vi.hoisted(() => ({ isDefault: true }));

vi.mock('@/core/trips', () => ({
  isDefaultTrip: () => state.isDefault,
}));

// dynamic(loader, opts) → a stub standing in for the lazily-loaded ConciergeChat.
vi.mock('next/dynamic', () => ({
  default: () => () =>
    createElement('button', { type: 'button', 'data-testid': 'concierge-trigger' }, 'Concierge'),
}));

import TravelConcierge from '@/components/travel-concierge';
import {
  CONCIERGE_ON_CUSTOM_TRIPS,
  isConciergeAllowedForActiveTrip,
} from '@/lib/concierge-config';

function render(el: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  state.isDefault = true;
});

describe('TravelConcierge mount gating (S343)', () => {
  it('mounts the concierge on the default Nepal × Japan trip', () => {
    state.isDefault = true;
    const r = render(createElement(TravelConcierge));
    expect(r.container.querySelector('[data-testid="concierge-trigger"]')).not.toBeNull();
    r.unmount();
  });

  // Was: "renders nothing on a custom trip (the persona gate)". INVERTED on 2026-08-09.
  // The persona gate was lifted when the trip-aware Worker shipped, so a custom trip now gets
  // the concierge like any other. Kept (not deleted) because the mount is still the thing under
  // test: this goes red if anyone re-derives an `isDefaultTrip()` gate inside the component
  // instead of reading the one shared rule (D-265).
  it('mounts the concierge on a CUSTOM trip too (persona gate lifted, D-265 one rule)', () => {
    state.isDefault = false;
    const r = render(createElement(TravelConcierge));
    expect(r.container.querySelector('[data-testid="concierge-trigger"]')).not.toBeNull();
    r.unmount();
  });

  // S395 (owner ruling Q6 = YES) put the gate on ONE constant in lib/concierge-config.ts and
  // pinned its shipped value here, CLOSED, because opening it before the trip-aware Worker was
  // deployed would put a Nepal × Japan concierge on an Iceland trip AND silently drop every op it
  // proposed (validateOps checks TRIP_DATES membership). The flip had to fail a test first.
  //
  // ✅ THE PRECONDITION WAS MET, NOT BYPASSED. On **2026-08-09** the owner deployed
  // `trip-planner-concierge` **v1.8.0**, Version ID **157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6**, to
  // https://trip-planner-concierge.official-shadowverse.workers.dev with its predeploy gate green
  // (typecheck + 104/104 worker tests). The live prompt is trip-aware, so the constant was flipped
  // to `true` and this test was inverted with it.
  //
  // What it guards NOW: (a) the shipped value is `true` DELIBERATELY — the constant is a bare
  // literal that a stale branch or a well-meaning "restore the safe default" can revert in one
  // character, silently un-shipping the feature on every custom trip, and this makes that revert
  // fail loudly next to the deploy record it would have to contradict; and (b) that the constant
  // is the SOLE determinant of the trip rule — while it is open,
  // `isConciergeAllowedForActiveTrip()` must not consult trip identity, which is what lets one
  // flip move BOTH mounts (navbar.tsx + travel-concierge.tsx, D-265). Re-closing it is legitimate
  // only if the Worker is rolled back; then update this block, the constant, and the test together.
  it('the custom-trip gate ships OPEN (Worker v1.8.0 deployed) and is the sole trip determinant', () => {
    expect(CONCIERGE_ON_CUSTOM_TRIPS).toBe(true);
    state.isDefault = false;
    expect(isConciergeAllowedForActiveTrip()).toBe(true);
    state.isDefault = true;
    expect(isConciergeAllowedForActiveTrip()).toBe(true);
  });
});
