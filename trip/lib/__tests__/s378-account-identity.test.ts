// @vitest-environment jsdom
//
// S378 (D-277) — the display name is an attribute of the ACCOUNT.
//
// Pins the reconciler `runAccountIdentitySync` in components/itinerary-provider: a one-shot read of
// `trips/{userToken}/profile/identity` on provider mount, with D-277's ordered rule
//   1. remote present ∧ ≠ local ⇒ ADOPT via signIn(remoteName)   (REMOTE WINS on conflict)
//   2. remote absent ∧ local is not the placeholder ⇒ BACKFILL
//   3. remote absent ∧ local IS the placeholder ⇒ do nothing, and NEVER publish 'Traveler'
// plus D-277's sign-out safety re-check and the now-conditional "signed in as Traveler" nudge.
//
// ⚠ WHY THE ASSERTIONS COUNT MOCK CALLS AND NOT ONLY OUTCOMES: two concurrent first-time dynamic
// `import()`s of one specifier can silently hand back the REAL module past `vi.mock`, and
// `trips-remote`'s functions swallow every failure to `console.warn` — so a bypassed mock still
// produces a green "nothing was published" outcome. Every branch therefore asserts on
// `fetchAccountIdentityMock`/`pushAccountIdentityMock` CALL COUNTS, which a bypass cannot fake.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The firebase gate open, with NO firebase: the reconciler's gates are `isRemoteConfigured()` ∧ a
// Sync Code ∧ an active traveler, and everything past them is the mocked trips-remote below.
vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => true,
  // #10: mirrors isRemoteConfigured — every mocked getTripId here is non-empty, so the two gates agree.
  isTripRemoteConfigured: () => true,
  getTripId: () => 'test-trip',
  FIREBASE_CONFIG: {},
}));

const fetchAccountIdentityMock = vi.fn<(code: string) => Promise<string | undefined>>(
  async () => undefined,
);
const pushAccountIdentityMock = vi.fn<(code: string, name: string) => Promise<void>>(
  async () => {},
);
vi.mock('@/lib/trips-remote', () => ({
  fetchAccountIdentity: (code: string) => fetchAccountIdentityMock(code),
  pushAccountIdentity: (code: string, name: string) => pushAccountIdentityMock(code, name),
  subscribeTripList: () => () => {},
}));

const toastMock = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

import { runAccountIdentitySync } from '@/components/itinerary-provider';
import { signIn, signOut, getActiveTraveler, DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';
import { setSyncCode } from '@/core/storage/gateway';
import { useAuthorFilter } from '@/hooks/use-author-filter';

const CODE = '11111111-2222-3333-4444-555555555555';

/** Flush the reconciler's lazy `import()` + fetch `.then` chain. */
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  fetchAccountIdentityMock.mockReset();
  fetchAccountIdentityMock.mockResolvedValue(undefined);
  pushAccountIdentityMock.mockReset();
  pushAccountIdentityMock.mockResolvedValue(undefined);
  toastMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('S378 branch 1 — remote present ⇒ ADOPT (remote wins)', () => {
  it("THE DEFECT: a device that logged in as the placeholder adopts the account's real name", async () => {
    setSyncCode(CODE);
    signIn(DEFAULT_TRAVELER_NAME); // exactly what token-gate's handleLogin leaves behind
    fetchAccountIdentityMock.mockResolvedValue('Powan');

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    expect(fetchAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(fetchAccountIdentityMock).toHaveBeenCalledWith(CODE);
    expect(getUserName()).toBe('Powan');
    // TRAP 1: `signIn`, never a bare `setUserName` — the NAME slot (what attribution stamps) and the
    // TOKEN slot (what getActiveTraveler displays) must agree, or the app shows one and stamps another.
    expect(getActiveTraveler()?.name).toBe('Powan');
    expect(getUserName()).toBe(getActiveTraveler()?.name);
    // An adopt never publishes.
    expect(pushAccountIdentityMock).not.toHaveBeenCalled();
  });

  it('CONFLICT: device holds "Sora", remote says "Powan" ⇒ remote wins', async () => {
    setSyncCode(CODE);
    signIn('Sora');
    fetchAccountIdentityMock.mockResolvedValue('Powan');

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    expect(fetchAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(getUserName()).toBe('Powan');
    expect(getActiveTraveler()?.name).toBe('Powan');
    expect(pushAccountIdentityMock).not.toHaveBeenCalled();
  });

  it('remote === local ⇒ no write, no identity churn', async () => {
    setSyncCode(CODE);
    signIn('Powan');
    fetchAccountIdentityMock.mockResolvedValue('Powan');
    const identityEvents = vi.fn();
    window.addEventListener('identity:changed', identityEvents);

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();
    window.removeEventListener('identity:changed', identityEvents);

    expect(fetchAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(pushAccountIdentityMock).not.toHaveBeenCalled();
    expect(identityEvents).not.toHaveBeenCalled();
    expect(getUserName()).toBe('Powan');
  });
});

describe('S378 branch 2 — remote absent ∧ local is a real name ⇒ BACKFILL', () => {
  it('publishes the local name once and leaves both slots alone', async () => {
    setSyncCode(CODE);
    signIn('Sora');

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    expect(fetchAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(pushAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(pushAccountIdentityMock).toHaveBeenCalledWith(CODE, 'Sora');
    expect(getUserName()).toBe('Sora');
    expect(getActiveTraveler()?.name).toBe('Sora');
  });
});

describe('S378 branch 3 — remote absent ∧ local IS the placeholder ⇒ publish NOTHING', () => {
  it('never publishes "Traveler" to the account (the migration must not re-create the defect)', async () => {
    setSyncCode(CODE);
    signIn(DEFAULT_TRAVELER_NAME);

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    // The fetch count proves the mocked module is the one that ran — so the zero below is a
    // measurement, not a mock that was silently bypassed (whose swallowed failure looks identical).
    expect(fetchAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(pushAccountIdentityMock).toHaveBeenCalledTimes(0);
    expect(getUserName()).toBe(DEFAULT_TRAVELER_NAME);
  });
});

describe('S378 sign-out safety (trap 4 — D-240s bug class)', () => {
  it('a late resolve landing after signOut() does NOT resurrect the session', async () => {
    setSyncCode(CODE);
    signIn('Sora');
    let resolveFetch: (v: string | undefined) => void = () => {};
    fetchAccountIdentityMock.mockImplementation(
      () =>
        new Promise<string | undefined>((r) => {
          resolveFetch = r;
        }),
    );

    const cleanup = runAccountIdentitySync();
    await flush(); // the lazy import has resolved; the fetch is still in flight

    signOut(); // the user signs out mid-read
    expect(getActiveTraveler()).toBeNull();

    resolveFetch('Powan'); // the read lands late, for an identity that no longer exists
    await flush();
    cleanup();

    expect(getActiveTraveler()).toBeNull();
    expect(getUserName()).toBeNull();
    expect(pushAccountIdentityMock).not.toHaveBeenCalled();
  });

  it('a resolve after the effect cleanup does not write either', async () => {
    setSyncCode(CODE);
    signIn('Sora');
    let resolveFetch: (v: string | undefined) => void = () => {};
    fetchAccountIdentityMock.mockImplementation(
      () =>
        new Promise<string | undefined>((r) => {
          resolveFetch = r;
        }),
    );

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup(); // provider unmounted

    resolveFetch('Powan');
    await flush();

    expect(getUserName()).toBe('Sora'); // unchanged — the late adopt was cancelled
    expect(pushAccountIdentityMock).not.toHaveBeenCalled();
  });
});

describe('S378 — the "signed in as Traveler" nudge is now CONDITIONAL', () => {
  it('does NOT fire when the name is about to be adopted from the account (branch 1)', async () => {
    setSyncCode(CODE);
    signIn(DEFAULT_TRAVELER_NAME);
    sessionStorage.setItem('name-hint', '1');
    fetchAccountIdentityMock.mockResolvedValue('Powan');

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    expect(toastMock).not.toHaveBeenCalled();
    expect(getUserName()).toBe('Powan');
  });

  it('fires on branch 3, where the placeholder really is the final answer', async () => {
    setSyncCode(CODE);
    signIn(DEFAULT_TRAVELER_NAME);
    sessionStorage.setItem('name-hint', '1');

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('name-hint')).toBeNull();
  });

  it('still fires immediately with no account to ask (no Sync Code ⇒ no read at all)', async () => {
    signIn(DEFAULT_TRAVELER_NAME); // no setSyncCode: nothing can ever correct the placeholder
    sessionStorage.setItem('name-hint', '1');

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    expect(fetchAccountIdentityMock).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('reads nothing for a signed-out visitor', async () => {
    setSyncCode(CODE);

    const cleanup = runAccountIdentitySync();
    await flush();
    cleanup();

    expect(fetchAccountIdentityMock).not.toHaveBeenCalled();
    expect(pushAccountIdentityMock).not.toHaveBeenCalled();
  });
});

// ── The filter's live seam (D-277): "My edits" must follow an ADOPT, not wait for an edit ─────────
function renderHook(): { myName: () => string | null; unmount: () => void } {
  let latest: string | null = null;
  function Probe() {
    latest = useAuthorFilter().myName;
    return null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(createElement(Probe) as ReactElement));
  return {
    myName: () => latest,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('S378 — useAuthorFilter refreshes myName on identity:changed', () => {
  it('picks up an adopted name without waiting for an unrelated itinerary edit', () => {
    signIn('Traveler');
    const hook = renderHook();
    expect(hook.myName()).toBe('Traveler');

    act(() => {
      signIn('Powan'); // what the reconciler's adopt does — fires identity:changed
    });

    expect(hook.myName()).toBe('Powan');
    hook.unmount();
  });
});
