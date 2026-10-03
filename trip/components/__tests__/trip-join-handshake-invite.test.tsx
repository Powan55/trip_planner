// @vitest-environment jsdom
//
// #641: an invite link's token leaves the address bar on mount, and Join redeems it before the
// local switch, so a refused invite never moves the active-trip pointer.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const calls = vi.hoisted(() => [] as string[]);
vi.mock('@/lib/invites-remote', () => ({
  redeemInvite: async (tripId: string, token: string) => {
    calls.push(`redeem:${tripId}:${token}`);
    return 'joined';
  },
}));
vi.mock('@/core/trips/registry', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/core/trips/registry')>();
  return {
    ...orig,
    joinTrip: (id: string, name?: string) => {
      calls.push(`join:${id}`);
      return orig.joinTrip(id, name);
    },
  };
});
vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Powan' } }),
}));

import TripJoinHandshake from '@/components/trip-join-handshake';

const TOKEN = '0f8b6c2e-1d3a-4b5c-8d7e-9f0a1b2c3d4e';
const realLocation = window.location;
let root: Root;
let host: HTMLDivElement;
const replace = vi.fn();

beforeEach(() => {
  calls.length = 0;
  window.localStorage.clear();
  window.history.replaceState(null, '', `/?trip=trip-xyz&invite=${TOKEN}`);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true, writable: true });
});

describe('TripJoinHandshake with an invite (#641)', () => {
  it('strips invite on mount, then redeems before joining', async () => {
    const spy = vi.spyOn(window.history, 'replaceState');
    await act(async () => root.render(<TripJoinHandshake />));

    expect(spy).toHaveBeenCalled();
    expect(window.location.search).toBe('?trip=trip-xyz');

    const confirm = document.querySelector<HTMLButtonElement>('[data-testid="trip-join-confirm"]');
    expect(confirm).not.toBeNull();
    Object.defineProperty(window, 'location', {
      value: { ...realLocation, replace },
      configurable: true,
      writable: true,
    });
    await act(async () => confirm!.click());

    expect(calls).toEqual([`redeem:trip-xyz:${TOKEN}`, 'join:trip-xyz']);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  // #775: a legacy name is refused as a new trip, but a row this device already holds still opens.
  it.each([
    ['refused when unknown', false, 'This link can’t be opened'],
    ['offered when already a row', true, null],
  ])('a legacy-name link is %s', async (_label, known, title) => {
    if (known) window.localStorage.setItem('tripPlannerKnownTrips', JSON.stringify([{ id: 'Sushil', name: 'Old', joinedAt: 1 }]));
    window.history.replaceState(null, '', '/?trip=Sushil');
    await act(async () => root.render(<TripJoinHandshake />));
    const dialog = document.querySelector('[data-testid="trip-join-dialog"]');
    expect(dialog).not.toBeNull();
    if (title) expect(dialog!.textContent).toContain(title);
    else expect(document.querySelector('[data-testid="trip-join-confirm"]')).not.toBeNull();
  });
});
