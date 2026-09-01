// @vitest-environment jsdom
//
// "I log in as Powan and it says Traveler."
//
// The door's login path (`handleLogin` in components/token-gate) does not ask for a name, so on a
// device with nothing in the local name slot it used to sign in as the literal placeholder
// `DEFAULT_TRAVELER_NAME` and leave the correction to `runAccountIdentitySync`, which only runs
// after the reload and only when the account layer is live. Until then the placeholder is what the
// navbar chip renders and what `createdBy`/`updatedBy` stamp — and where no reconciler can run
// (dormant build, failed read) it is what the traveler keeps.
//
// This pins the door taking the account's own name (D-277's `trips/{key}/profile/identity`, the
// same document the #10 probe already reads) BEFORE it signs in. Asserted at the point the door
// finishes, with no reconciler in the test at all, so it fails on the old behaviour.
//
// Asserts on the mock CALL COUNT as well as the outcome, for the reason spelled out in
// s378-account-identity.test.ts: a bypassed `vi.mock` of `trips-remote` still produces a
// green-looking outcome because every function in it swallows failure.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The firebase gate open, with no firebase behind it — the door reaches only the mock below.
vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
  getTripId: () => 'test-trip',
  FIREBASE_CONFIG: {},
}));

// ONE mock, and deliberately no `fetchAccountIdentity` in it: the door must get the name off the
// probe's own snapshot. If it ever reaches for a second read again, the destructure yields
// undefined and the call throws — the mock cannot paper that over.
type ProbeResult = { verdict: 'exists' | 'missing' | 'unavailable'; name?: string };
const probeAccountIdentityMock = vi.fn<(code: string) => Promise<ProbeResult>>(async () => ({
  verdict: 'exists',
  name: 'Powan',
}));
vi.mock('@/lib/trips-remote', () => ({
  probeAccountIdentity: (code: string) => probeAccountIdentityMock(code),
  pushAccountIdentity: async () => {},
  pushTripList: async () => {},
  subscribeTripList: () => () => {},
}));

const KEY = '11111111-2222-3333-4444-555555555555';

import TokenGate from '@/components/token-gate';
import { getActiveTraveler, DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';
import { getUserName } from '@/lib/identity';

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

/** Flush the door's lazy `import()` + await chain (the single probe read). */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
}

// jsdom throws on a real navigation; `finish()` calls location.replace.
let restoreLocation: (() => void) | null = null;
function stubLocation() {
  const real = window.location;
  const stub = { reload: vi.fn(), replace: vi.fn(), assign: vi.fn(), href: '', search: '' };
  Object.defineProperty(window, 'location', { value: stub, configurable: true, writable: true });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
  return stub;
}

/** Type into a controlled React input (the native setter, so React sees the change). */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  probeAccountIdentityMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (restoreLocation) {
    restoreLocation();
    restoreLocation = null;
  }
});

describe("the door signs in as the account's name, not the placeholder", () => {
  it('a fresh device pasting the account key is Powan the moment the door finishes', async () => {
    stubLocation();
    expect(getUserName()?.trim()).toBeFalsy(); // fresh device: nothing in the local name slot

    const view = render(createElement(TokenGate));
    await flush(); // mount gate resolves → the wall shows its landing view

    const cta = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="landing-cta-login"]',
    )!;
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const field = view.container.querySelector<HTMLInputElement>(
      '[data-testid="token-gate-user-token"]',
    )!;
    await act(async () => typeInto(field, KEY));
    await act(async () => {
      field.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    // ONE read (with the key, not something else) served both the #10 validation and the name,
    // and the name is what got signed in.
    expect(probeAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(probeAccountIdentityMock).toHaveBeenCalledWith(KEY);
    expect(getActiveTraveler()?.name).toBe('Powan');
    // Both identity slots agree — the chip shows what attribution stamps (the trap D-277 names).
    expect(getUserName()).toBe('Powan');
    expect(getUserName()).toBe(getActiveTraveler()?.name);
    // No "you're signed in as Traveler" nudge: the placeholder never happened.
    expect(sessionStorage.getItem('name-hint')).toBeNull();
    view.unmount();
  });

  it('an account with no name on record still falls back to the placeholder + the nudge', async () => {
    probeAccountIdentityMock.mockResolvedValueOnce({ verdict: 'exists' }); // real key, no name on it
    stubLocation();

    const view = render(createElement(TokenGate));
    await flush();
    const cta = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="landing-cta-login"]',
    )!;
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const field = view.container.querySelector<HTMLInputElement>(
      '[data-testid="token-gate-user-token"]',
    )!;
    await act(async () => typeInto(field, KEY));
    await act(async () => {
      field.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();

    expect(probeAccountIdentityMock).toHaveBeenCalledTimes(1);
    expect(getActiveTraveler()?.name).toBe(DEFAULT_TRAVELER_NAME);
    expect(sessionStorage.getItem('name-hint')).toBe('1');
    view.unmount();
  });

  // R2: the door no longer owns a name budget — the probe's 8s race is the only one, and the
  // timeout ITSELF is pinned in trips-remote.test.ts ("a read that never answers loses the 8s
  // race"). What is left to prove here is the door's half: that the answer that race produces
  // ('unavailable', arriving a full 8s late) still ends in the placeholder rather than a hang.
  // The mock therefore models the probe's contract exactly — resolve 'unavailable' AT the budget.
  it('a probe that times out still admits, and signs in as the placeholder', async () => {
    vi.useFakeTimers();
    try {
      probeAccountIdentityMock.mockImplementationOnce(
        () => new Promise((r) => setTimeout(() => r({ verdict: 'unavailable' }), 8_000)),
      );
      stubLocation();

      const view = render(createElement(TokenGate));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50); // mount gate → the wall shows its landing view
      });
      const cta = view.container.querySelector<HTMLButtonElement>(
        '[data-testid="landing-cta-login"]',
      )!;
      await act(async () => {
        cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const field = view.container.querySelector<HTMLInputElement>(
        '[data-testid="token-gate-user-token"]',
      )!;
      await act(async () => typeInto(field, KEY));
      await act(async () => {
        field
          .closest('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      // Mid-race: the door has not signed anyone in — it is waiting on the one budget, not two.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0); // arm the race
      });
      expect(getActiveTraveler()).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(8_001); // past the probe's budget
      });
      expect(probeAccountIdentityMock).toHaveBeenCalledTimes(1);
      expect(getActiveTraveler()?.name).toBe(DEFAULT_TRAVELER_NAME);
      expect(getUserName()).toBe(DEFAULT_TRAVELER_NAME);
      expect(sessionStorage.getItem('name-hint')).toBe('1'); // nothing stored, nothing on record
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
