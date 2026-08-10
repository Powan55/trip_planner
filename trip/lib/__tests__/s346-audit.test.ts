// @vitest-environment jsdom
//
// S346 — component/unit proof for three audit fixes, same createRoot+act harness as
// s345-front-door.test.ts (no new dep; standalone vitest.config.ts globs only `*.test.ts`, so
// createElement instead of JSX). framer-motion is neutralised so token-gate's `m.*` render in a
// bare tree.
//
//   A3 — DefaultTripOnly's empty-state offers a "Switch to the Nepal × Japan trip" button that
//        sets the active trip back to the default pack and reloads; the old Plan link is gone.
//   A5 — a token-only login with NO stored name sets the one-shot `name-hint` flag in handleLogin;
//        consumeNameHint fires the Sonner toast exactly once (flag cleared before firing).
//        ⚠ S378/D-277 RE-SCOPED the login case: it pins the DOOR's TRANSIENT local placeholder, not
//        the display name the user ends up with. WHEN the nudge fires is no longer decided here —
//        `runAccountIdentitySync` now gates it to branch 3 (no account name to adopt); those cases,
//        and the end-to-end name guarantee, live in `s378-account-identity.test.ts`.
//   #1 — createSyncCodeTripListSync tears the trip-list subscription down when the traveler goes
//        null (sign-out) and re-arms for a fresh identity.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// React 18 createRoot + act need this flag set, else state updates dispatched from raw DOM events
// aren't flushed (and act warns). Harmless for the pure-function tests.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Neutralise framer-motion for token-gate's `m.*` / AnimatePresence (LazyMotion-strict throw).
vi.mock('framer-motion', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const MOTION_PROPS = new Set([
    'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover',
    'whileTap', 'whileInView', 'layout', 'layoutId', 'drag',
  ]);
  const m = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        const Motion = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const clean: Record<string, unknown> = {};
          for (const k of Object.keys(props)) if (!MOTION_PROPS.has(k)) clean[k] = props[k];
          return React.createElement(tag, { ...clean, ref });
        });
        Motion.displayName = `motion.${tag}`;
        return Motion;
      },
    },
  );
  return { m, AnimatePresence: ({ children }: { children: unknown }) => children };
});

// #1 needs the firebase gate open + a fake remote subscribe (the real one would touch firebase).
const subscribeTripListMock = vi.fn((_code: string, _onMerge?: () => void) => vi.fn());
vi.mock('@/lib/firebase-config', () => ({
  isRemoteConfigured: () => true,
  getTripId: () => 'test-trip',
  FIREBASE_CONFIG: {},
}));
vi.mock('@/lib/trips-remote', () => ({
  subscribeTripList: (code: string, onMerge?: () => void) => subscribeTripListMock(code, onMerge),
}));
// sonner's toast — spy so A5 can assert one call.
const toastMock = vi.fn();
vi.mock('sonner', () => ({ toast: (...args: unknown[]) => toastMock(...args) }));

import DefaultTripOnly from '@/components/default-trip-only';
import TokenGate from '@/components/token-gate';
import { consumeNameHint, createSyncCodeTripListSync } from '@/components/itinerary-provider';
import {
  setActiveTripId,
  getActiveTripId,
  DEFAULT_TRIP_ID,
  setSyncCode,
  getSyncCode,
} from '@/core/storage/gateway';
import { signIn, signOut, DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';
import { getUserName, setUserName } from '@/lib/identity';

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

// Flush the microtask/timer queue (the components' lazy `import()` .then chains) inside act().
async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

// Stub the parts of window.location the handlers navigate through (jsdom throws on real nav).
let restoreLocation: (() => void) | null = null;
function stubLocation() {
  const real = window.location;
  const stub = { reload: vi.fn(), replace: vi.fn(), assign: vi.fn(), href: '', search: '' };
  Object.defineProperty(window, 'location', { value: stub, configurable: true, writable: true });
  restoreLocation = () =>
    Object.defineProperty(window, 'location', { value: real, configurable: true, writable: true });
  return stub;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  subscribeTripListMock.mockClear();
  toastMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (restoreLocation) {
    restoreLocation();
    restoreLocation = null;
  }
});

describe('A3 — DefaultTripOnly empty-state switch-back', () => {
  it('renders a switch button (not the old Plan link) on a non-default trip and switches + reloads', async () => {
    setActiveTripId('some-other-trip'); // force the empty state (isDefault === false)
    const loc = stubLocation();

    const view = render(createElement(DefaultTripOnly, { children: 'GUIDE' }));
    await flush(); // let the effect's gateway import resolve → empty state paints

    const btn = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="default-trip-only-switch"]',
    );
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
    expect(btn?.textContent).toContain('Switch to the Nepal × Japan trip');
    // The weaker Plan link is gone; Manage trips stays as the secondary.
    expect(view.container.querySelector('[data-testid="default-trip-only-plan-link"]')).toBeNull();
    expect(
      view.container.querySelector('[data-testid="default-trip-only-trips-link"]'),
    ).not.toBeNull();

    await act(async () => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flush(); // the click handler lazy-imports the gateway before switching

    expect(getActiveTripId()).toBe(DEFAULT_TRIP_ID);
    expect(loc.reload).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

describe('A5 — post-login name-hint one-shot', () => {
  // Drive the real wall: the saved-token one-tap button (a React onClick, so state commits under
  // act) fills the User Token field, then submit the login form → the real handleLogin runs.
  async function submitLogin(view: { container: HTMLElement }) {
    // S355: the wall opens on the marketing landing — a CTA opens the auth card.
    const cta = view.container.querySelector<HTMLButtonElement>('[data-testid="landing-cta-login"]')!;
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const useSaved = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="token-gate-use-saved"]',
    )!;
    await act(async () => {
      useSaved.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const form = view.container
      .querySelector('[data-testid="token-gate-user-token"]')!
      .closest('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  // ⚠ RE-SCOPED IN S378 (D-277). This pins the DOOR's LOCAL PLACEHOLDER — nothing more.
  // D-277 made the display name an attribute of the ACCOUNT, but it deliberately did NOT touch the
  // door: `token-gate` stays firebase-free (D-239 LOCKED, no push/lookup at the door), so a
  // token-only login still writes "Traveler" locally and this assertion stays literally true. What
  // changed is that the placeholder is now TRANSIENT — `runAccountIdentitySync` in
  // itinerary-provider replaces it with the account's real name on the very next load. The
  // END-TO-END guarantee ("Powan stays Powan on a fresh device") lives in
  // lib/__tests__/s378-account-identity.test.ts, NOT here. Do not "strengthen" this test by forcing
  // a name lookup into the door — that would violate D-239's firebase-free clause.
  it('the door defaults the local name slot to the transient placeholder and flags the hint (real handleLogin)', async () => {
    setSyncCode('11111111-2222-3333-4444-555555555555'); // opens the wall on "Log in" mode + offers the saved token
    stubLocation(); // finish() → window.location.replace
    expect(getUserName()?.trim()).toBeFalsy(); // fresh device: nothing in the name slot

    const view = render(createElement(TokenGate));
    await flush(); // mount gate resolves → wall shows, savedToken effect runs
    await submitLogin(view);

    // Login defaulted the name to the placeholder and left the one-shot hint for the post-reload
    // consumer — which, since S378, only toasts if the account has no real name to adopt (branch 3).
    expect(getUserName()).toBe(DEFAULT_TRAVELER_NAME);
    expect(sessionStorage.getItem('name-hint')).toBe('1');
    view.unmount();
  });

  it('a login that reuses an existing stored name does NOT set the flag', async () => {
    setSyncCode('11111111-2222-3333-4444-555555555555'); // opens on "Log in" mode
    setUserName('Sora'); // name known from a prior session, but NOT signed in (no token) → wall shows
    stubLocation();
    expect(getUserName()).toBe('Sora');

    const view = render(createElement(TokenGate));
    await flush();
    await submitLogin(view);

    expect(getUserName()).toBe('Sora'); // reused, not overwritten by the default
    expect(sessionStorage.getItem('name-hint')).toBeNull();
    view.unmount();
  });

  it('consumeNameHint fires the toast once and clears the flag (a reload cannot double-fire)', () => {
    sessionStorage.setItem('name-hint', '1');

    consumeNameHint();
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('name-hint')).toBeNull();
    const [, opts] = toastMock.mock.calls[0] as [string, { action?: { label?: string } }];
    expect(opts?.action?.label).toBe('Settings');

    // Second mount (or a reload) must NOT re-toast — the flag is already cleared.
    consumeNameHint();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('consumeNameHint is a no-op when the flag is absent', () => {
    consumeNameHint();
    expect(toastMock).not.toHaveBeenCalled();
  });
});

describe('#1 — sync-code trip-list subscription tears down on sign-out (identity → null)', () => {
  it('subscribes for an identified traveler, unsubscribes when the traveler goes null, re-arms for a new one', async () => {
    setSyncCode('code-abc');
    signIn('Kenji'); // active traveler present + code present + remote configured (mocked)
    expect(getSyncCode()).toBe('code-abc');

    const unsub = vi.fn();
    subscribeTripListMock.mockReturnValue(unsub);

    const tick = () => new Promise((r) => setTimeout(r, 0)); // let the lazy import() settle

    const sync = createSyncCodeTripListSync();
    sync.activate();
    await tick();
    expect(subscribeTripListMock).toHaveBeenCalledTimes(1);
    expect(unsub).not.toHaveBeenCalled();

    // Sign out → identity:changed fires teardown()+activate(); getActiveTraveler() is now null.
    signOut();
    sync.teardown();
    sync.activate(); // gate fails (no traveler) → no new subscribe
    await tick();
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(subscribeTripListMock).toHaveBeenCalledTimes(1); // still just the one

    // A fresh sign-in re-arms.
    setSyncCode('code-abc');
    signIn('Mika');
    sync.teardown();
    sync.activate();
    await tick();
    expect(subscribeTripListMock).toHaveBeenCalledTimes(2);
    sync.teardown();
  });
});
