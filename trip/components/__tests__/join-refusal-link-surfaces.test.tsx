// @vitest-environment jsdom
//
// The two `joinTrip` surfaces that are NOT paste forms: the `?trip=` share-link confirm
// (`trip-join-handshake`, mounted in the root layout) and the Home chip strip. Both used to treat
// `joinTrip` as infallible; both now have to cope with a refusal, and they cope differently
// because they hold different things.
//
// - The handshake holds a token off the URL. It can SAY what happened, and it must not offer a
//   retry for a value the user cannot edit.
// - The strip holds an id already in the registry. Its only job is to stop performing a reload
//   that repaints the trip you were already on.
//
// Harness mirrors `backup-restore-dialog.test.tsx`: plain react-dom/client via `act`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));

import TripJoinHandshake from '@/components/trip-join-handshake';
import HomeTripStrip from '@/components/home-trip-strip';
import { JOIN_REFUSAL_COPY, joinTrip, upsertKnownTrip } from '@/core/trips/registry';
import { setSyncCode, setActiveTripId, getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';

const ACCOUNT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

let restoreLocation: (() => void) | null = null;
function stubLocation(search: string) {
  const real = window.location;
  const stub = {
    reload: vi.fn(),
    replace: vi.fn(),
    assign: vi.fn(),
    href: 'https://x.test/',
    origin: 'https://x.test',
    search,
  };
  Object.defineProperty(window, 'location', { value: stub, configurable: true, writable: true });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
  return stub;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(el: Parameters<Root['render']>[0]) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
}

const q = <T extends HTMLElement = HTMLElement>(testId: string): T | null =>
  document.body.querySelector<T>(`[data-testid="${testId}"]`);

function must<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = q<T>(testId);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

function click(testId: string) {
  const el = must(testId);
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  restoreLocation?.();
  restoreLocation = null;
  vi.restoreAllMocks();
});

describe('?trip= handshake — a refused token and a failed write are different sentences', () => {
  it('the account key arriving as ?trip= gets the shared refusal copy, not the storage sentence', () => {
    setSyncCode(ACCOUNT);
    const location = stubLocation(`?trip=${ACCOUNT}`);
    render(createElement(TripJoinHandshake));

    click('trip-join-confirm');

    const alert = must('trip-join-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toBe(JOIN_REFUSAL_COPY['own-account-token']);
    // The bug this replaces: it used to tell someone holding a refused token to leave private
    // browsing or free up disk space.
    expect(alert.textContent).not.toContain('free some space');
    expect(alert.textContent).not.toContain('Private browsing');

    expect(location.replace).not.toHaveBeenCalled();
    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
  });

  it('a refusal disables the confirm — the token came off the URL and cannot be corrected here', () => {
    setSyncCode(ACCOUNT);
    stubLocation(`?trip=${ACCOUNT}`);
    render(createElement(TripJoinHandshake));

    expect(must<HTMLButtonElement>('trip-join-confirm').disabled).toBe(false);
    click('trip-join-confirm');
    expect(must<HTMLButtonElement>('trip-join-confirm').disabled).toBe(true);
    // Cancel stays live: it is the only exit that can work.
    expect(must<HTMLButtonElement>('trip-join-cancel').disabled).toBe(false);
  });

  it("a friend's Trip Token still joins and navigates", () => {
    setSyncCode(ACCOUNT);
    const location = stubLocation('?trip=friends-trip');
    render(createElement(TripJoinHandshake));

    click('trip-join-confirm');

    expect(q('trip-join-error')).toBeNull();
    expect(getActiveTripId()).toBe('friends-trip');
    expect(location.replace).toHaveBeenCalledTimes(1);
  });
});

describe('home chip strip — a chip that cannot switch no longer reloads the page', () => {
  // The population S-1 leaves behind: a device that registered the account key as a trip before
  // `joinTrip` could refuse it still has that row. The chip renders; the switch cannot happen.
  it('tapping a chip the registry refuses does not reload', () => {
    setSyncCode(ACCOUNT);
    upsertKnownTrip(ACCOUNT, 'Looks like a trip'); // written before the guard existed
    setActiveTripId(DEFAULT_TRIP_ID);
    const location = stubLocation('');
    render(createElement(HomeTripStrip));

    const chip = document.body.querySelector<HTMLButtonElement>(
      `[aria-label="Switch to trip Looks like a trip"]`,
    );
    expect(chip).not.toBeNull();
    act(() => {
      chip!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(location.reload).not.toHaveBeenCalled();
    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
  });

  it('an ordinary chip still switches and reloads', () => {
    setSyncCode(ACCOUNT);
    joinTrip('friends-trip', 'Friends trip');
    setActiveTripId(DEFAULT_TRIP_ID);
    const location = stubLocation('');
    render(createElement(HomeTripStrip));

    const chip = document.body.querySelector<HTMLButtonElement>(
      `[aria-label="Switch to trip Friends trip"]`,
    );
    act(() => {
      chip!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(getActiveTripId()).toBe('friends-trip');
    expect(location.reload).toHaveBeenCalledTimes(1);
  });
});
