// @vitest-environment jsdom
//
// D-314 residual (2) and D-320's storage-scope clause: the three lifetime-scoped keys sit outside
// `wipeAllTripData()` on purpose, and "Forget this device" is the ONE clearing path named for a
// handed-down device. Both halves are pinned here, through the real dialog and the real
// `signOut()` — never a hand-rolled imitation of either, because the teardown IS what is under
// test. The keys are seeded through their own live writers (`core/places/visited.ts`,
// `core/places/passport.ts`) so the clear is asserted against what the app actually writes.
//
// Harness mirrors `components/__tests__/backup-restore-dialog.test.tsx`: plain react-dom/client
// via `act`, no @testing-library in this repo, the real Radix alert dialog.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import SignOutConfirm from '@/components/sign-out-confirm';
import { addVisit, confirmVisit } from '@/core/places/visited';
import { claimStamps } from '@/core/places/passport';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The on-disk literals, not `STORAGE_KEYS.*` — these bytes are the contract a handed-down device
// is judged on, and the registry constants are pinned to them by their own suites.
const VISITS_KEY = 'tripPlannerLifetimeVisits';
const CONFIRM_KEY = 'tripPlannerVisitConfirmations';
const STAMPS_KEY = 'tripPlannerPassportStamps';
const LIFETIME_KEYS = [VISITS_KEY, CONFIRM_KEY, STAMPS_KEY];
// A trip-scoped slot, so a vacuous pass (nothing ever written / sign-out never ran) is impossible.
const ITINERARY_KEY = 'nepal_japan_itinerary';

let root: Root;
let container: HTMLDivElement;
let restoreLocation: (() => void) | null = null;

function must<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = document.body.querySelector<T>(`[data-testid="${testId}"]`);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    must(testId).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await flush();
}

/** Seed the whole lifetime record the way the app writes it, then prove it is on disk. */
function seedTravelHistory(): void {
  localStorage.setItem(ITINERARY_KEY, JSON.stringify([{ date: '2026-12-09', items: [] }]));
  addVisit({ city: 'Kathmandu', country: 'Nepal' });
  confirmVisit({ city: 'Kathmandu', country: 'Nepal' }, '2026-12-09T09:00:00.000Z');
  claimStamps();
  for (const key of [...LIFETIME_KEYS, ITINERARY_KEY]) {
    expect(localStorage.getItem(key)).not.toBeNull();
  }
}

async function mount(forgetDevice: boolean): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <SignOutConfirm testId="tid" forgetDevice={forgetDevice}>
        <button type="button" data-testid="tid">
          {forgetDevice ? 'Forget this device' : 'Sign out'}
        </button>
      </SignOutConfirm>,
    );
  });
  await flush();
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  // jsdom throws on a real navigation; the confirm handler reloads after the teardown.
  const real = window.location;
  Object.defineProperty(window, 'location', {
    value: { reload: vi.fn(), replace: vi.fn(), assign: vi.fn(), href: '', search: '' },
    configurable: true,
    writable: true,
  });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  restoreLocation?.();
  restoreLocation = null;
  vi.restoreAllMocks();
});

describe('"Forget this device" clears the lifetime travel record (D-314 residual 2)', () => {
  it('removes all three lifetime keys, and the trip data with them', async () => {
    seedTravelHistory();
    await mount(true);

    await click('tid');
    await click('tid-confirm');

    for (const key of LIFETIME_KEYS) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem(ITINERARY_KEY)).toBeNull(); // the plain sign-out half still ran
    expect(window.location.reload).toHaveBeenCalled();
  });

  it('says so before the traveller confirms', async () => {
    await mount(true);
    await click('tid');
    const copy = must('tid-dialog').textContent ?? '';
    expect(copy).toMatch(/travel history/i);
    expect(copy).toMatch(/passport stamps/i);
  });

  it('cancelling clears nothing', async () => {
    seedTravelHistory();
    await mount(true);

    await click('tid');
    await click('tid-cancel');

    for (const key of [...LIFETIME_KEYS, ITINERARY_KEY]) {
      expect(localStorage.getItem(key)).not.toBeNull();
    }
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

describe('plain sign-out still leaves the lifetime travel record alone (D-314)', () => {
  it('wipes the trip data and keeps all three lifetime keys', async () => {
    seedTravelHistory();
    await mount(false);

    await click('tid');
    await click('tid-confirm');

    expect(localStorage.getItem(ITINERARY_KEY)).toBeNull();
    for (const key of LIFETIME_KEYS) expect(localStorage.getItem(key)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(VISITS_KEY) as string)).toEqual({
      cities: ['Kathmandu'],
      countries: ['Nepal'],
    });
    expect(window.location.reload).toHaveBeenCalled();
  });
});
