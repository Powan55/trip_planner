// @vitest-environment jsdom
//
// #10 — the provider half of the member lock (`runTripMembership` in components/itinerary-provider):
// WHEN enrolment runs, and what a refusal looks like to the user. `@/lib/trips-remote` is mocked so
// the gates can be driven without firebase; `sonner` is mocked so the toast is countable.
//
// ⚠ Assertions count mock calls (the S378 rigour): `ensureMembership` swallows every failure, so
// "no toast appeared" is indistinguishable from "the mocked module was bypassed" without a count.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const gate = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: {},
  isRemoteConfigured: () => gate.on,
  isTripRemoteConfigured: () => gate.on,
  getTripId: () => 'trip-abc',
}));

const ensureMembershipMock = vi.fn<(tripId: string) => Promise<void>>(async () => {});
vi.mock('@/lib/trips-remote', () => ({
  ensureMembership: (tripId: string) => ensureMembershipMock(tripId),
  // The provider's other effects reach for these; they are never exercised here.
  fetchAccountIdentity: async () => undefined,
  pushAccountIdentity: async () => {},
  subscribeTripList: () => () => {},
  fetchTripMeta: async () => undefined,
}));

const toastMock = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

import { runTripMembership } from '@/components/itinerary-provider';
import { signIn } from '@/lib/token-auth';
import { setActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';

const TRIP = 'trip-abc';

/** Flush the lazy `import()` + the enrolment `.then` chain. */
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  ensureMembershipMock.mockReset();
  ensureMembershipMock.mockResolvedValue(undefined);
  toastMock.mockClear();
  gate.on = true;
});

describe('runTripMembership — when enrolment runs (#10)', () => {
  it('enrols the ACTIVE trip once for an identified traveler', async () => {
    setActiveTripId(TRIP);
    signIn('Powan');

    const cleanup = runTripMembership();
    await flush();
    cleanup();

    expect(ensureMembershipMock).toHaveBeenCalledTimes(1);
    expect(ensureMembershipMock).toHaveBeenCalledWith(TRIP);
  });

  it('never enrols on the local-only sample pack', async () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    signIn('Powan');

    const cleanup = runTripMembership();
    await flush();
    cleanup();

    expect(ensureMembershipMock).not.toHaveBeenCalled();
  });

  it('never enrols for a signed-out visitor', async () => {
    setActiveTripId(TRIP);

    const cleanup = runTripMembership();
    await flush();
    cleanup();

    expect(ensureMembershipMock).not.toHaveBeenCalled();
  });

  it('never enrols on a dormant build', async () => {
    gate.on = false;
    setActiveTripId(TRIP);
    signIn('Powan');

    const cleanup = runTripMembership();
    await flush();
    cleanup();

    expect(ensureMembershipMock).not.toHaveBeenCalled();
  });
});

describe('runTripMembership — a refusal is ONE actionable toast (#10)', () => {
  it('turns trip:access-pending into a single toast naming where to fix it', async () => {
    setActiveTripId(TRIP);
    signIn('Powan');

    const cleanup = runTripMembership();
    await flush();
    // The literal the provider listens for — pinned equal to trips-remote's exported constant by
    // trip-membership.test.ts, so this string cannot drift away from the dispatcher.
    window.dispatchEvent(new CustomEvent('trip:access-pending'));

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [message] = toastMock.mock.calls[0] as [string];
    expect(message).toContain('don’t have access to this trip yet');
    expect(message).toContain('Settings → Trip access');
    cleanup();
  });

  it('stops listening after the effect is cleaned up', async () => {
    setActiveTripId(TRIP);
    signIn('Powan');

    const cleanup = runTripMembership();
    await flush();
    cleanup();
    window.dispatchEvent(new CustomEvent('trip:access-pending'));

    expect(toastMock).not.toHaveBeenCalled();
  });
});
