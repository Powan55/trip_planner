// @vitest-environment jsdom
//
// S375 — regression suite for the "joiner sees no day cells" defect. Same createRoot+act harness
// as s346-audit.test.ts (no new dep; the standalone vitest.config.ts globs `*.test.ts` under
// lib/__tests__, so createElement instead of JSX).
//
// THE DEFECT (measured live: the remote meta doc was absent after 20,230 ms on 5 of 6 creates; the
// identical push WITHOUT navigating landed in 179 ms) had two halves that licensed each other:
//
//   HALF 1 — trips-hub's create handler fired `pushTripMeta` and immediately called
//            `window.location.assign`. The push must first `await getRemote()` (a ~456 kB dynamic
//            import + initializeApp + a WebChannel handshake) before `setDoc` is even issued, and
//            the page unloads in 370–740 ms — so the write died in flight and the joiner had no
//            trip identity to read.
//   HALF 2 — the joiner-side self-heal called `tripMetaSelfHealGuard.markRun()` BEFORE checking
//            whether it had found anything. The guard is sessionStorage-backed, so a joiner who
//            looked one second too early was stuck for the entire session — a reload could not
//            recover, because the guard outlives it.
//
// Every test here except the control was RUN RED against the unfixed code first (half 1 against
// the original handler; half 2 against the original `markRun` ordering, restored temporarily).
// The CONTROL covers the path
// that was never broken: rename does not navigate, so it must STAY fire-and-forget — it is the
// recovery path lib/trips-remote's header documents, and the peer harness re-checks it (D1b).
// The two "loop cap" assertions in half 2 are green both before and after the move by design:
// they pin the property the move must not lose.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


// The firebase gate open, with NO firebase: every remote call in this file is a mock.
vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => true,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => true,
  getTripId: () => 'test-trip',
  FIREBASE_CONFIG: {},
}));

/** A promise whose settlement this test controls — stands in for the in-flight Firestore write. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let metaPush = deferred();
/** True once the in-flight meta push has resolved — so "we timed out" can be told from "it acked". */
let metaSettled = false;
const pushTripMetaMock = vi.fn((_id: string, _meta: unknown) => metaPush.promise);
const pushTripListMock = vi.fn((_code: string) => Promise.resolve());
const fetchTripMetaMock = vi.fn(
  async (_id: string): Promise<{ name: string; config?: unknown } | undefined> => undefined,
);
vi.mock('@/lib/trips-remote', () => ({
  pushTripMeta: (id: string, meta: unknown) => pushTripMetaMock(id, meta),
  pushTripList: (code: string) => pushTripListMock(code),
  fetchTripMeta: (id: string) => fetchTripMetaMock(id),
  subscribeTripList: () => () => {},
}));

// #250: create() also kicks off a one-shot city geocode (dynamically imported, same shape as the
// trips-remote pushes above). Mocked to a no-op so this suite — about the meta-push race, not
// geocoding — never issues a real Nominatim request.
vi.mock('@/lib/city-geocode', () => ({
  resolveAndCacheCityCoords: () => Promise.resolve(),
}));

import TripsHub from '@/components/trips-hub';
import { runTripMetaSelfHeal } from '@/components/itinerary-provider';
import { setActiveTripId, tripMetaSelfHealGuard, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
import {
  joinTrip,
  getKnownTrip,
  listKnownTrips,
  SHARED_NAME,
  TRIP_DAYS_MAX,
} from '@/core/trips/registry';
import { signIn } from '@/lib/token-auth';

function render(el: ReactElement) {
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

/** Flush the microtask/timer queue (the components' lazy `import()` .then chains) inside act(). */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

let restoreLocation: (() => void) | null = null;
function stubLocation() {
  const real = window.location;
  const stub = {
    reload: vi.fn(),
    replace: vi.fn(),
    assign: vi.fn(),
    href: '',
    search: '',
    origin: 'http://localhost',
  };
  Object.defineProperty(window, 'location', { value: stub, configurable: true, writable: true });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
  return stub;
}

/** Type into a React-controlled input (the native setter is what React's onChange listens for). */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  metaPush = deferred();
  metaSettled = false;
  void metaPush.promise.then(() => {
    metaSettled = true;
  });
  pushTripMetaMock.mockClear();
  pushTripListMock.mockClear();
  fetchTripMetaMock.mockClear();
  fetchTripMetaMock.mockResolvedValue(undefined);
  signIn('Kenji'); // create/rename are login-gated (D-238)
  // NO Sync Code on purpose: `pushSyncList` then short-circuits before its dynamic import, so the
  // handlers issue exactly ONE `import('@/lib/trips-remote')`. Two concurrent first-time imports of
  // the same specifier race vitest's mock registry — the second sometimes resolves to the REAL
  // module and calls firebase for real (reproduced: 4 runs in 5, with a stack through trips-hub's
  // pushSyncList). The trip-list push is not part of this defect, so the cheapest correct answer is
  // not to fire it. `settleWithin` still awaits the meta push, which is the whole point.
});
afterEach(() => {
  vi.useRealTimers();
  metaPush.resolve(); // never leave a create handler hanging on a pending push
  if (restoreLocation) {
    restoreLocation();
    restoreLocation = null;
  }
});

const field = (view: { container: HTMLElement }, id: string) =>
  view.container.querySelector<HTMLInputElement>(`[data-testid="trips-hub-create-${id}"]`)!;

/**
 * Mount the hub, wait for its post-mount storage read, and submit the create form.
 * Destinations are REQUIRED (they become the leg's `fallbackCity` and land in the LIFETIME
 * visited-cities record), so every submit fills them unless a test overrides them.
 */
async function submitCreate(
  name: string,
  extra: { destinations?: string; start?: string; end?: string } = {},
) {
  const { destinations = 'Kochi, Munnar', start, end } = extra;
  const view = render(createElement(TripsHub));
  await flush(); // mount effect: listKnownTrips() → canManage true → the create form paints
  const input = field(view, 'name');
  expect(input).not.toBeNull();
  await act(async () => {
    typeInto(input, name);
    typeInto(field(view, 'destinations'), destinations);
    if (start !== undefined) typeInto(field(view, 'start'), start);
    if (end !== undefined) typeInto(field(view, 'end'), end);
  });
  const form = input.closest('form')!;
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  return view;
}

describe('S375 half 1 — create must not navigate out from under its own meta push', () => {
  it('holds the navigation until the meta push settles, then navigates', async () => {
    const loc = stubLocation();

    const view = await submitCreate('Kerala 2027');
    await flush(); // let every microtask the handler queued run

    // The push is in flight (this is the ~456 kB import + handshake + setDoc window).
    expect(pushTripMetaMock).toHaveBeenCalledTimes(1);
    expect(pushTripMetaMock.mock.calls[0][1]).toMatchObject({ name: 'Kerala 2027' });
    // THE REGRESSION: pre-fix, assign() had already fired here and killed the write in flight.
    expect(loc.assign).not.toHaveBeenCalled();

    // The write acks → now, and only now, the page may unload.
    await act(async () => {
      metaPush.resolve();
    });
    await flush();
    expect(loc.assign).toHaveBeenCalledTimes(1);

    view.unmount();
  });

  it('navigates anyway when the push never settles — creating a trip can never hang', async () => {
    // Fake timers must be installed BEFORE the handler schedules the budget timer (a timer already
    // scheduled on the real clock is not adopted). `shouldAdvanceTime` keeps `flush()`'s real
    // setTimeout(0) working.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const loc = stubLocation();
    const view = await submitCreate('Dead Network Trip');
    await flush();
    expect(loc.assign).not.toHaveBeenCalled(); // still waiting on the budget
    expect(metaSettled).toBe(false); // and the push genuinely never settled

    // Deliberately does NOT assert the exact budget — only that one exists and is bounded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(loc.assign).toHaveBeenCalledTimes(1);
    expect(pushTripMetaMock).toHaveBeenCalledTimes(1); // timed out, not retried
    vi.useRealTimers();

    view.unmount();
  });

  it('a second submit during the wait cannot mint a second trip', async () => {
    stubLocation();
    const view = await submitCreate('Double Click');
    await flush();

    const btn = view.container.querySelector<HTMLButtonElement>('[data-testid="trips-hub-create"]')!;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');

    const form = btn.closest('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(pushTripMetaMock).toHaveBeenCalledTimes(1); // not two trips, not two pushes

    view.unmount();
  });
});

describe('S375 control — the NON-navigating push path stays fire-and-forget', () => {
  it('rename pushes meta without awaiting it and without navigating', async () => {
    const loc = stubLocation();
    joinTrip('trip-to-rename', 'Old name');
    setActiveTripId(DEFAULT_TRIP_ID); // rename a row that is not the active one

    const view = render(createElement(TripsHub));
    await flush();

    // Index-free selector: the row testids are positional, the aria-label is not.
    const pencil = view.container.querySelector<HTMLButtonElement>('[aria-label="Rename Old name"]');
    expect(pencil).not.toBeNull();
    await act(async () => {
      pencil!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = view.container.querySelector<HTMLInputElement>(
      '[data-testid^="trips-hub-rename-input-"]',
    )!;
    await act(async () => {
      typeInto(input, 'New name');
    });
    await act(async () => {
      input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    // The rename committed locally and the form closed IMMEDIATELY — no await on the network,
    // even though `metaPush` is still pending. This is the D1b shape: the push is unchanged.
    expect(getKnownTrip('trip-to-rename')?.name).toBe('New name');
    expect(view.container.querySelector('[data-testid^="trips-hub-rename-input-"]')).toBeNull();
    expect(loc.assign).not.toHaveBeenCalled();
    await flush();
    expect(pushTripMetaMock).toHaveBeenCalledTimes(1);
    expect(pushTripMetaMock.mock.calls[0][1]).toMatchObject({ name: 'New name' });

    view.unmount();
  });
});

describe('S375 half 2 — the self-heal guard marks only a FOUND doc', () => {
  const TRIP = 'joined-trip-xyz';

  beforeEach(() => {
    joinTrip(TRIP, SHARED_NAME);
    setActiveTripId(TRIP);
  });

  it('a miss (the creator\'s write has not landed yet) stays retryable', async () => {
    fetchTripMetaMock.mockResolvedValue(undefined);
    const loc = stubLocation();

    runTripMetaSelfHeal();
    await flush();

    expect(fetchTripMetaMock).toHaveBeenCalledTimes(1);
    // THE REGRESSION: pre-fix this was true, and sessionStorage carried it across every reload —
    // the joiner's trip was dead for the whole session.
    expect(tripMetaSelfHealGuard.hasRun(TRIP)).toBe(false);
    expect(loc.reload).not.toHaveBeenCalled();

    // The next page load tries again (this call IS the next load — the provider mounts once per
    // document load) and finds it this time.
    fetchTripMetaMock.mockResolvedValue({
      name: 'Kerala 2027',
      config: {
        start: '2027-01-01',
        end: '2027-01-10',
        destinations: ['Kochi'],
        vibe: 'relaxed',
        updatedAt: 1,
      },
    });
    runTripMetaSelfHeal();
    await flush();

    expect(fetchTripMetaMock).toHaveBeenCalledTimes(2);
    expect(getKnownTrip(TRIP)?.config?.destinations).toEqual(['Kochi']);
    expect(getKnownTrip(TRIP)?.name).toBe('Kerala 2027');
    expect(tripMetaSelfHealGuard.hasRun(TRIP)).toBe(true);
    expect(loc.reload).toHaveBeenCalledTimes(1);
  });

  it('a name-only hit still caps the reload at one per session (the guard\'s real job)', async () => {
    // No config in the doc ⇒ nothing is written locally ⇒ the `?.config` gate stays OPEN on the
    // next load. Only the guard stops this from reload-looping, so the move must not have lost it.
    fetchTripMetaMock.mockResolvedValue({ name: 'Kerala 2027' });
    const loc = stubLocation();

    runTripMetaSelfHeal();
    await flush();
    expect(tripMetaSelfHealGuard.hasRun(TRIP)).toBe(true);
    expect(loc.reload).toHaveBeenCalledTimes(1);
    expect(getKnownTrip(TRIP)?.config).toBeUndefined();

    runTripMetaSelfHeal(); // the reload's next mount
    await flush();
    expect(fetchTripMetaMock).toHaveBeenCalledTimes(1); // short-circuited before the import
    expect(loc.reload).toHaveBeenCalledTimes(1); // no loop
  });

  it('does not touch the network for the default pack or a trip that already has a config', async () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    runTripMetaSelfHeal();
    await flush();
    expect(fetchTripMetaMock).not.toHaveBeenCalled();
  });
});

// ── create-form validation ───────────────────────────────────────────────────────────────────────
//
// Two defects that both end in a permanent, out-of-trip record:
//   - a blank Destinations field fell back to the trip NAME, which became `destinations[0]` → the
//     leg's `fallbackCity` → the day's city → `tripPlannerLifetimeVisits`, a LIFETIME-scoped key
//     outside `wipeAllTripData()` (D-314). "Mum's 60th" was filed forever as a city visited.
//   - nothing capped `end - start`, so a one-digit year typo minted tens of thousands of trip days,
//     megabytes of day shells, and ONE FIRESTORE DOCUMENT PER DAY on a free tier.
// Both are refused at the point of authorship AND at `sanitizeTripConfig` (custom-trip-config.test).
describe('create form — destinations required, span capped', () => {
  it('refuses a blank Destinations field instead of filing the trip NAME as a city', async () => {
    const loc = stubLocation();
    const view = await submitCreate("Mum's 60th", { destinations: '  ,  ' });
    await flush();

    expect(pushTripMetaMock).not.toHaveBeenCalled();
    expect(loc.assign).not.toHaveBeenCalled();
    const err = view.container.querySelector('[data-testid="trips-hub-create-date-error"]');
    expect(err?.textContent).toMatch(/destination/i);
    // The whole point: no trip exists, so nothing can stamp the name into the lifetime record.
    expect(listKnownTrips().filter((t) => t.id !== DEFAULT_TRIP_ID)).toEqual([]);

    view.unmount();
  });

  it(`refuses a span over ${TRIP_DAYS_MAX} days (the mistyped-year trip)`, async () => {
    const loc = stubLocation();
    const view = await submitCreate('Kerala 2027', {
      start: '2027-01-05',
      end: '2207-01-05', // one digit off — 65,744 days pre-fix
    });
    await flush();

    expect(pushTripMetaMock).not.toHaveBeenCalled();
    expect(loc.assign).not.toHaveBeenCalled();
    const err = view.container.querySelector('[data-testid="trips-hub-create-date-error"]');
    expect(err?.textContent).toContain(String(TRIP_DAYS_MAX));
    expect(listKnownTrips().filter((t) => t.id !== DEFAULT_TRIP_ID)).toEqual([]);

    view.unmount();
  });

  it('the End date input carries the cap natively, so the picker cannot offer a worse year', async () => {
    const view = render(createElement(TripsHub));
    await flush();
    await act(async () => {
      typeInto(field(view, 'start'), '2027-01-05');
    });
    const end = field(view, 'end');
    expect(end.min).toBe('2027-01-05');
    expect(end.max).toBe('2029-01-03'); // 2027-01-05 + (730 - 1) days
    expect(field(view, 'destinations').required).toBe(true);

    view.unmount();
  });

  it('a normal trip still creates (the guards refuse only the two bad shapes)', async () => {
    const loc = stubLocation();
    const view = await submitCreate('Kerala 2027', {
      destinations: 'Kochi, Munnar',
      start: '2027-03-01',
      end: '2027-03-05',
    });
    await flush();

    expect(pushTripMetaMock).toHaveBeenCalledTimes(1);
    expect(pushTripMetaMock.mock.calls[0][1]).toMatchObject({
      name: 'Kerala 2027',
      config: { start: '2027-03-01', end: '2027-03-05', destinations: ['Kochi', 'Munnar'] },
    });
    await act(async () => {
      metaPush.resolve();
    });
    await flush();
    expect(loc.assign).toHaveBeenCalledTimes(1);

    view.unmount();
  });
});
