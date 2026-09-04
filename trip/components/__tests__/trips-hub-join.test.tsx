// @vitest-environment jsdom
//
// "Add a trip by Trip Token" (`components/trips-hub.tsx`). The two tokens are different kinds of
// thing — the account key signs you in, a Trip Token opens one trip and is the thing you hand to a
// friend — and a trip row is rendered WITH share affordances, so the account key must never become
// one. `joinTrip` is where that is decided; this file is about what the form does with the answer,
// because a refusal the user cannot see reads as "wrong token" and gets pasted again.
//
// Harness mirrors `backup-restore-dialog.test.tsx`: plain react-dom/client via `act`, no
// @testing-library in this repo.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// The identity is not what is under test; `canManage` just needs a signed-in traveler.
vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));

import TripsHub from '@/components/trips-hub';
import { setSyncCode, setActiveTripId, getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
import { listKnownTrips, upsertKnownTrip, joinTrip } from '@/core/trips/registry';

const ACCOUNT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

// jsdom has no navigation; the form calls assign() on the path that succeeds.
let restoreLocation: (() => void) | null = null;
function stubLocation() {
  const real = window.location;
  const stub = { assign: vi.fn(), replace: vi.fn(), reload: vi.fn(), href: '', origin: 'https://x.test', search: '' };
  Object.defineProperty(window, 'location', { value: stub, configurable: true, writable: true });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
  return stub;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(TripsHub));
  });
}

function q<T extends HTMLElement = HTMLElement>(testId: string): T | null {
  return document.body.querySelector<T>(`[data-testid="${testId}"]`);
}

function must<T extends HTMLElement = HTMLElement>(testId: string): T {
  const el = q<T>(testId);
  if (!el) throw new Error(`missing [data-testid="${testId}"]`);
  return el;
}

/** Type into a CONTROLLED input the way React hears it. */
function type(testId: string, value: string) {
  const input = must<HTMLInputElement>(testId);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submitJoin() {
  const button = must<HTMLButtonElement>('trips-hub-join');
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('trips hub — pasting the account key into "Add a trip by Trip Token"', () => {
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

  it('is refused in place: an alert, no row, no navigation', () => {
    setSyncCode(ACCOUNT);
    const location = stubLocation();
    render();

    type('trips-hub-join-key', ACCOUNT);
    submitJoin();

    const alert = must('trips-hub-join-error');
    expect(alert.getAttribute('role')).toBe('alert');
    // The copy names the value as the user's OWN key and says what to ask for instead. It must
    // not read as "that token was not found", which is what sends someone back to paste it again.
    expect(alert.textContent).toContain('your own key');
    expect(alert.textContent).toContain('Trip Token');

    expect(location.assign).not.toHaveBeenCalled();
    expect(listKnownTrips().map((t) => t.id)).toEqual([DEFAULT_TRIP_ID]);
    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
  });

  it('the field is marked invalid and points at the message (a11y, not just colour)', () => {
    setSyncCode(ACCOUNT);
    stubLocation();
    render();

    const input = must<HTMLInputElement>('trips-hub-join-key');
    expect(input.getAttribute('aria-invalid')).toBeNull();

    type('trips-hub-join-key', ACCOUNT);
    submitJoin();

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('trips-hub-join-error');
    expect(document.getElementById('trips-hub-join-error')).not.toBeNull();
  });

  it('editing the field clears the refusal', () => {
    setSyncCode(ACCOUNT);
    stubLocation();
    render();

    type('trips-hub-join-key', ACCOUNT);
    submitJoin();
    expect(q('trips-hub-join-error')).not.toBeNull();

    type('trips-hub-join-key', 'someone-elses-trip');
    expect(q('trips-hub-join-error')).toBeNull();
  });

  it('a real Trip Token still joins and navigates — the guard is not a blanket refusal', () => {
    setSyncCode(ACCOUNT);
    const location = stubLocation();
    render();

    type('trips-hub-join-key', 'someone-elses-trip');
    type('trips-hub-join-name', 'Their trip');
    submitJoin();

    expect(q('trips-hub-join-error')).toBeNull();
    expect(location.assign).toHaveBeenCalledTimes(1);
    expect(getActiveTripId()).toBe('someone-elses-trip');
    expect(listKnownTrips().find((t) => t.id === 'someone-elses-trip')?.name).toBe('Their trip');
  });
});

describe('trips hub — a row the registry refuses does not navigate as though it switched', () => {
  // Sibling of the Home chip strip's guard, and the sharper of the two: this one calls
  // `location.assign` rather than `reload`, so an unguarded refusal lands the browser on Home
  // looking like the switch completed. The row itself is the population S-1 leaves behind — a
  // list written before `joinTrip` could refuse, or merged in from a device that still cannot.
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

  /** The row's main control is the only button in it whose label carries the switch affordance. */
  function switchButton(name: string): HTMLButtonElement | null {
    return (
      [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => b.textContent?.includes(name) && b.textContent?.includes('tap to switch'),
      ) ?? null
    );
  }

  it('tapping a refused row neither moves the pointer nor navigates', () => {
    setSyncCode(ACCOUNT);
    upsertKnownTrip(ACCOUNT, 'Looks like a trip'); // written before the guard existed
    setActiveTripId(DEFAULT_TRIP_ID);
    const location = stubLocation();
    render();

    const button = switchButton('Looks like a trip');
    expect(button).not.toBeNull();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(location.assign).not.toHaveBeenCalled();
    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
  });

  it('an ordinary row still switches and navigates', () => {
    setSyncCode(ACCOUNT);
    joinTrip('friends-trip', 'Friends trip');
    setActiveTripId(DEFAULT_TRIP_ID);
    const location = stubLocation();
    render();

    const button = switchButton('Friends trip');
    expect(button).not.toBeNull();
    act(() => {
      button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });

    expect(getActiveTripId()).toBe('friends-trip');
    expect(location.assign).toHaveBeenCalledTimes(1);
  });
});
