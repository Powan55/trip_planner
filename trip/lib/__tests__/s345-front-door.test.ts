// @vitest-environment jsdom
//
// S345 — component-level proof for three front-door fixes, rendered with the same
// createRoot+act harness story-photos.test.ts uses (no new dep; standalone vitest.config.ts
// only globs `*.test.ts`, so createElement instead of JSX). framer-motion is mocked to plain
// host elements so the LazyMotion-`strict` `m.*` components render outside a LazyMotion
// provider without throwing.
//
//   A1 — TokenGate's auth-card default mode. S382 INVERTED the first case: the card now opens on
//        "Log in" for EVERY device, including one with no stored User Token (INTAKE-03).
//   A2 — UserTokenShowOnce renders a Download .txt control beside Copy (durable save, no recovery otherwise).
//   S382 — entry FOCUS lands on the log-in CTA (`document.activeElement`), the instrument that
//        measured the defect on the deployed site.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// Neutralise framer-motion: `m.<tag>` -> the host element (motion props stripped),
// AnimatePresence -> a passthrough. Avoids the LazyMotion-strict throw in a bare test tree.
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

// #10 — the door's account probe (login validation) + the create-path seed, mocked so the wall's
// handlers can be driven for real with zero firebase. The mock is file-wide but inert for every
// pre-#10 test above (they never submit a form, so the dynamic import never runs).
const probeMock = vi.fn<(code: string) => Promise<'exists' | 'missing' | 'unavailable'>>(
  async () => 'unavailable',
);
const pushAccountIdentityMock = vi.fn(async (_code: string, _name: string) => {});
const pushTripListMock = vi.fn(async (_code: string) => {});
vi.mock('@/lib/trips-remote', () => ({
  probeAccountIdentity: (code: string) => probeMock(code),
  pushAccountIdentity: (code: string, name: string) => pushAccountIdentityMock(code, name),
  pushTripList: (code: string) => pushTripListMock(code),
}));

import TokenGate from '@/components/token-gate';
import UserTokenShowOnce from '@/components/user-token-show-once';
import { setSyncCode, getSyncCode } from '@/core/storage/gateway';

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

// Stub window.location for the paths that navigate (finish() → replace; jsdom throws on real
// navigation) — same idiom as s346-audit.test.ts.
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
  probeMock.mockClear();
  probeMock.mockResolvedValue('unavailable');
  pushAccountIdentityMock.mockClear();
  pushTripListMock.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  if (restoreLocation) {
    restoreLocation();
    restoreLocation = null;
  }
});

describe('A1 → S382 — the auth card default mode', () => {
  /**
   * S355: the wall now opens on the marketing LANDING, so the auth card (and its mode toggle) is
   * only reachable via a CTA. "Someone shared a trip with me" names no path, so it is the ONE CTA
   * that leaves the mode on this device's default — which is exactly what A1 pins. Driving A1
   * through either of the other two CTAs would assert the CTA, not the default, and quietly turn
   * this test vacuous.
   *
   * 🔴 S382 CONSCIOUSLY REWROTE the first case below. It used to read "a first-timer (no stored
   * token) opens on 'Create an account'" and it was a TRUE assertion of a rule since
   * overturned (INTAKE-03): the key-derived default meant every private-window visit — i.e. every
   * returning visit — opened on signup. The old rule is not deleted, it is INVERTED here, so the
   * new rule is pinned by a check that used to fail. `onJoin` now sets the mode explicitly, so
   * this pair also covers that call site.
   */
  function openAuthOnTheDefault(view: { container: HTMLElement }) {
    const join = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="landing-cta-join"]',
    )!;
    act(() => {
      join.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('S382: a never-synced device (no stored token) opens on "Log in", not "Create an account"', () => {
    expect(window.localStorage.getItem('tripPlannerSyncCode')).toBeNull(); // the fresh-device condition
    const view = render(createElement(TokenGate));
    openAuthOnTheDefault(view);
    const create = view.container.querySelector('[data-testid="token-gate-mode-create"]');
    const login = view.container.querySelector('[data-testid="token-gate-mode-login"]');
    expect(login?.getAttribute('aria-pressed')).toBe('true');
    expect(create?.getAttribute('aria-pressed')).toBe('false');
    // Signup is NOT removed — the toggle is still rendered and still switches.
    expect(create).not.toBeNull();
    act(() => {
      (create as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(
      view.container.querySelector('[data-testid="token-gate-mode-create"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    expect(view.container.querySelector('[data-testid="token-gate-name"]')).not.toBeNull();
    view.unmount();
  });

  it('a returning device (token present) opens on "Log in"', () => {
    setSyncCode('11111111-2222-3333-4444-555555555555');
    const view = render(createElement(TokenGate));
    openAuthOnTheDefault(view);
    const create = view.container.querySelector('[data-testid="token-gate-mode-create"]');
    const login = view.container.querySelector('[data-testid="token-gate-mode-login"]');
    expect(login?.getAttribute('aria-pressed')).toBe('true');
    expect(create?.getAttribute('aria-pressed')).toBe('false');
    view.unmount();
  });
});

/**
 * S382 (INTAKE-03) — THE FRONT DOOR'S ENTRY FOCUS.
 *
 * 🔴 This is the one check in the slice that measures what was actually measured on the deployed
 * site: `document.activeElement` on arrival, with `localStorage` carrying no User Token. A live
 * browser measurement found "Create an account" holding focus, which is why a returning traveller
 * in a private window experienced the door as a signup page even though the first screen is the
 * marketing landing.
 *
 * Asserting that a log-in button EXISTS, or that it carries `bg-primary`, would pass on the broken
 * code (the button always existed) or pass on markup that no keyboard user ever reaches. Only
 * `activeElement` discriminates. The wall focuses on a 50ms `setTimeout` backstop, so each case
 * waits real time inside `act` rather than faking timers (fake timers here would also fake React's
 * own scheduling).
 */
describe('S382 — entry focus lands on "log in", not "create an account"', () => {
  async function settleFocus() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
  }

  it('a never-synced device: focus lands on landing-cta-login', async () => {
    expect(window.localStorage.length).toBe(0); // genuinely fresh — the private-window condition
    const view = render(createElement(TokenGate));
    await settleFocus();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('landing-cta-login');
    view.unmount();
  });

  it('a device with a stored User Token: focus still lands on landing-cta-login', async () => {
    setSyncCode('11111111-2222-3333-4444-555555555555');
    const view = render(createElement(TokenGate));
    await settleFocus();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('landing-cta-login');
    view.unmount();
  });

  it('the log-in CTA is the FIRST focusable button in the wall panel (the focus mechanism)', async () => {
    const view = render(createElement(TokenGate));
    await settleFocus();
    const panel = view.container.querySelector<HTMLElement>('[role="dialog"]')!;
    const first = panel.querySelector<HTMLElement>('button:not([disabled])');
    // The wall's focus effect queries exactly this. If a button is ever inserted above the hero
    // CTAs, entry focus moves and this fails before anyone ships it.
    expect(first?.getAttribute('data-testid')).toBe('landing-cta-login');
    view.unmount();
  });
});

// S355 — the wall's FIRST view is the marketing landing, and it must carry zero live trip data.
describe('S355 — TokenGate opens on the landing, and its CTAs pick the auth path', () => {
  it('a logged-out visitor gets the landing, not the auth form', () => {
    const view = render(createElement(TokenGate));
    expect(view.container.querySelector('[data-testid="landing-page"]')).not.toBeNull();
    expect(view.container.querySelector('[data-testid="token-gate-submit"]')).toBeNull();
    expect(view.container.querySelector('h1')?.textContent).toBe(
      'Every day of the trip, in one place.',
    );
    view.unmount();
  });

  it('"Create an account" opens the auth card in create mode', () => {
    setSyncCode('11111111-2222-3333-4444-555555555555'); // default would be "login" — the CTA wins
    const view = render(createElement(TokenGate));
    act(() => {
      view.container
        .querySelector('[data-testid="landing-cta-create"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(
      view.container
        .querySelector('[data-testid="token-gate-mode-create"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    view.unmount();
  });

  it('"I have a key — log in" opens the auth card in login mode', () => {
    // S382 note: since the default is now 'login' for every device, this case no longer
    // discriminates the CTA from the default on its own. Its sibling above ("Create an account"
    // wins over the login default) is the one that proves a CTA overrides the default; this one
    // stays as the end-to-end path check for the CTA the INTAKE-03 ruling promotes.
    const view = render(createElement(TokenGate));
    act(() => {
      view.container
        .querySelector('[data-testid="landing-cta-login"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(
      view.container
        .querySelector('[data-testid="token-gate-mode-login"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
    view.unmount();
  });
});

// ── #10 — the door validates a NEW key against the account identity doc ─────────────────────────
describe('#10 — handleLogin probes the pasted key; only a server-confirmed absence rejects', () => {
  async function flush() {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  /** Open the auth card on Log in (the wall opens on the landing). */
  async function openLogin(view: { container: HTMLElement }) {
    const cta = view.container.querySelector<HTMLButtonElement>('[data-testid="landing-cta-login"]')!;
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  /** Type into the CONTROLLED key field (native setter + input event so React sees it). */
  async function typeKey(view: { container: HTMLElement }, value: string) {
    const input = view.container.querySelector<HTMLInputElement>(
      '[data-testid="token-gate-user-token"]',
    )!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function submitLogin(view: { container: HTMLElement }) {
    const form = view.container
      .querySelector('[data-testid="token-gate-user-token"]')!
      .closest('form')!;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush(); // the dynamic import + probe .then chain
  }

  const NEW_KEY = '99999999-8888-4777-8666-555544443333';

  it("probe 'missing' → the error renders AND zero state was stored (no key, no signIn, no navigation)", async () => {
    probeMock.mockResolvedValue('missing');
    const loc = stubLocation();
    const view = render(createElement(TokenGate));
    await openLogin(view);
    await typeKey(view, NEW_KEY);
    await submitLogin(view);

    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(probeMock).toHaveBeenCalledWith(NEW_KEY);
    const error = view.container.querySelector('[data-testid="token-gate-error"]');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.textContent).toBe('This user does not exist. Check your key, or create an account.');
    // An invented key leaves ZERO stored state — the whole point of the door validating.
    expect(getSyncCode()).toBeNull();
    expect(window.localStorage.getItem('tripPlannerToken')).toBeNull(); // signIn never ran
    expect(loc.replace).not.toHaveBeenCalled();
    // The form is usable again (busy released) for a corrected key.
    expect(
      view.container
        .querySelector('[data-testid="token-gate-user-token"]')
        ?.hasAttribute('readonly'),
    ).toBe(false);
    view.unmount();
  });

  it("probe 'unavailable' → ADMITS (fail open: offline must never lock a real user out)", async () => {
    probeMock.mockResolvedValue('unavailable');
    const loc = stubLocation();
    const view = render(createElement(TokenGate));
    await openLogin(view);
    await typeKey(view, NEW_KEY);
    await submitLogin(view);

    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(getSyncCode()).toBe(NEW_KEY);
    expect(loc.replace).toHaveBeenCalledTimes(1); // finish() navigated — admitted
    expect(view.container.querySelector('[data-testid="token-gate-error"]')).toBeNull();
    view.unmount();
  });

  it("probe 'exists' → admits exactly the same way", async () => {
    probeMock.mockResolvedValue('exists');
    const loc = stubLocation();
    const view = render(createElement(TokenGate));
    await openLogin(view);
    await typeKey(view, NEW_KEY);
    await submitLogin(view);

    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(getSyncCode()).toBe(NEW_KEY);
    expect(loc.replace).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('the STORED key skips the probe entirely — a returning device is never re-gated', async () => {
    const stored = '11111111-2222-3333-4444-555555555555';
    setSyncCode(stored);
    const loc = stubLocation();
    const view = render(createElement(TokenGate));
    await openLogin(view);
    // One-tap saved-key fill (the returning-device path), then submit.
    const useSaved = view.container.querySelector<HTMLButtonElement>(
      '[data-testid="token-gate-use-saved"]',
    )!;
    await act(async () => {
      useSaved.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await submitLogin(view);

    expect(probeMock).not.toHaveBeenCalled(); // stored sessions are NEVER re-gated
    expect(loc.replace).toHaveBeenCalledTimes(1); // logged straight in
    view.unmount();
  });
});

describe('A2 — UserTokenShowOnce offers a durable Download .txt save', () => {
  it('renders a download control beside the existing copy control', () => {
    const view = render(
      createElement(UserTokenShowOnce, { token: 'tok-123', onConfirm: () => {} }),
    );
    expect(
      view.container.querySelector('[data-testid="user-token-show-once-download"]'),
    ).not.toBeNull();
    // Copy affordance is preserved.
    expect(
      view.container.querySelector('[data-testid="user-token-show-once-copy"]'),
    ).not.toBeNull();
    view.unmount();
  });
});
