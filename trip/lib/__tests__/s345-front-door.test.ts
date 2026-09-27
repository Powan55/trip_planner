// @vitest-environment jsdom
//
// S345 — component-level proof for three front-door fixes, rendered with the same
// createRoot+act harness story-photos.test.ts uses (no new dep; standalone vitest.config.ts
// only globs `*.test.ts`, so createElement instead of JSX). framer-motion is mocked to plain
// host elements so the LazyMotion-`strict` `m.*` components render outside a LazyMotion
// provider without throwing.
//
//   A1 — which mode the auth card opens on. S382 INVERTED it once (it opens on "Log in" for EVERY
//        device, including one with no stored User Token — INTAKE-03); #70 then RE-POINTED it off
//        the mode default, which no CTA observes any more, onto the per-CTA table. The block's own
//        comment carries the full why, and reading it is the point.
//   S382 — entry FOCUS lands on the log-in CTA (`document.activeElement`), the instrument that
//        measured the defect on the deployed site.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

// Neutralise framer-motion: `m.<tag>` -> the host element (motion props stripped),
// AnimatePresence -> a passthrough. Avoids the LazyMotion-strict throw in a bare test tree.
//
// ⚠ FILE-WIDE (issue #440): the Proxy below mints a NEW component type per property access, so
// React remounts the whole `m.*` subtree on every re-render. Re-query a node AFTER the render
// that changes it — one captured earlier is detached, its events never reach React's root
// listener, and the handler silently never runs, surfacing several assertions later somewhere
// that looks unrelated. Dispatch is not the problem: a hand-built `submit` Event drives React
// fine here; `submitLogin` works precisely because it re-queries at call time.
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

import TokenGate from '@/components/token-gate';
import { setSyncCode } from '@/core/storage/gateway';

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

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('A1 → #70 — every landing CTA opens the auth card on the mode its label promises', () => {
  /**
   * 🔴 A1 WAS RE-POINTED BY #70, in the same change that moved the behaviour. Read this before
   * "restoring" the version in the history: the old assertion cannot be made true again without
   * reintroducing the defect. Here is why.
   *
   * A1 used to drive the card open through the SHARED-TRIP CTA ("Someone shared a trip with me")
   * and assert the mode was 'login'. That worked because that CTA deliberately set no mode, making
   * it the ONE path that ever observed `TokenGateWall`'s `useState<Mode>('login')` initializer —
   * which is what A1 existed to pin (S382/INTAKE-03: the card opens on Log in for every device,
   * including one with no stored key).
   *
   * #70 is the report that this routing was wrong. That CTA names visitors holding a TRIP TOKEN;
   * the login field takes a USER TOKEN (D-239, never mixed), so the door asked them for the one
   * credential they cannot have — D-296's probe rejects it, and a dormant/offline build admits
   * them into a working-but-empty account. The CTA now opens 'create', and lands on `/trips/`
   * where a Trip Token is actually accepted.
   *
   * So the old A1 could not simply be edited to expect 'create': it would then be asserting the
   * CTA, not the default, while its name and comment still claimed to pin the default — a test
   * passing for the wrong reason. NO CTA observes the initializer any more (all three set the
   * mode), so the initializer is genuinely unobservable and nothing here pretends otherwise.
   *
   * WHAT THIS BLOCK STILL FAILS ON, which is the whole reason it was re-pointed rather than
   * deleted: the shared-trip CTA regressing to log-in mode (the #70 defect — and the exact routing
   * the wall's old comment used to defend); the log-in CTA opening signup (INTAKE-03's defect
   * direction, whose primary guard is the entry-FOCUS block below); and create and log in swapped.
   * WHAT IT NO LONGER CLAIMS: anything about the mode initializer.
   */
  const STORED_KEY = '11111111-2222-3333-4444-555555555555';

  function clickCta(view: { container: HTMLElement }, testid: string) {
    const cta = view.container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;
    act(() => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  function pressed(view: { container: HTMLElement }, mode: 'login' | 'create') {
    return view.container
      .querySelector(`[data-testid="token-gate-mode-${mode}"]`)
      ?.getAttribute('aria-pressed');
  }

  // The table. Seeded with a stored User Token on purpose: that is the input the RETIRED default
  // used to branch on, so if a future edit reintroduces a storage-derived mode, the CTA it
  // contradicts fails here rather than shipping.
  const CTA_MODES = [
    ['landing-cta-login', 'login'],
    ['landing-cta-create', 'create'],
    // #70 — a Trip Token holder has no User Token, so this CTA is the SIGNUP path.
    ['landing-cta-join', 'create'],
  ] as const;

  for (const [testid, expected] of CTA_MODES) {
    const other = expected === 'login' ? 'create' : 'login';
    it(`${testid} opens the auth card on "${expected}"`, () => {
      setSyncCode(STORED_KEY);
      const view = render(createElement(TokenGate));
      clickCta(view, testid);
      expect(pressed(view, expected)).toBe('true');
      expect(pressed(view, other)).toBe('false');
      view.unmount();
    });
  }

  it('#70: a never-synced visitor with a Trip Token lands on sign-up, which asks for a name', () => {
    expect(window.localStorage.getItem('tripPlannerSyncCode')).toBeNull(); // the fresh-device condition
    const view = render(createElement(TokenGate));

    // The landing states the second half of the route BEFORE the click, and states it to assistive
    // tech too — the button's accessible description is that line, not loose text beside it.
    const note = view.container.querySelector('#landing-join-note');
    expect(note?.textContent).toMatch(/Trip Token/);
    expect(note?.textContent).toMatch(/Trips page/);
    expect(
      view.container
        .querySelector('[data-testid="landing-cta-join"]')
        ?.getAttribute('aria-describedby'),
    ).toBe('landing-join-note');

    clickCta(view, 'landing-cta-join');
    expect(pressed(view, 'create')).toBe('true');
    expect(view.container.querySelector('[data-testid="token-gate-name"]')).not.toBeNull();
    view.unmount();
  });

  it('log in is still one tap from there, for a shared-trip visitor who does have an account', () => {
    const view = render(createElement(TokenGate));
    clickCta(view, 'landing-cta-join');
    clickCta(view, 'token-gate-mode-login');
    expect(pressed(view, 'login')).toBe('true');
    expect(view.container.querySelector('[data-testid="token-gate-username"]')).not.toBeNull();
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

  it('"I have an account — log in" opens the auth card in login mode', () => {
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

/**
 * #25 — THE FRONT DOOR IS PHOTOGRAPHIC IN BOTH VIEWS.
 *
 * The landing half shipped with a full-bleed cover; the auth half did not, because the wall
 * renders the landing XOR the auth card and opening the card unmounted the cover outright. Spec
 * The design rule puts the panel's scrim OVER the cover, so the wall now carries its own copy of
 * the photo as a sibling of the panel.
 *
 * Asserting the layer EXISTS is the first half. The second half is where it exists: outside the
 * dialog panel, carrying nothing focusable. That is what makes the pinned front-door behaviours
 * (the Tab-trap, and `panel.querySelector('button:not([disabled])')` deciding entry focus)
 * structurally unable to see it — a check that would fail if a later change moved the backdrop
 * inside the panel, which is the version of this that would break the focus contract.
 *
 * The Ken Burns pause is CSS (`.wall-auth-open .door-kb { animation-play-state: paused }`) and
 * jsdom applies no stylesheet, so what is checkable here is that the wall stamps the class the
 * rule keys off. The rule itself is globals.css's, and `npm run loop-check` is what holds the
 * loop to D-293 R2/R8.
 */
describe('#25 — the auth view keeps the cover mounted, outside the focus trap', () => {
  function openAuth(view: { container: HTMLElement }) {
    act(() => {
      view.container
        .querySelector('[data-testid="landing-cta-login"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }

  it('the landing view has no wall backdrop — the cover it shows is its own, inside the panel', () => {
    const view = render(createElement(TokenGate));
    expect(view.container.querySelector('[data-testid="door-wall-photo"]')).toBeNull();
    expect(view.container.querySelector('[data-testid="landing-page"] .door-kb')).not.toBeNull();
    view.unmount();
  });

  it('opening the auth card keeps a cover on screen, and pauses the loop with the ruled class', () => {
    const view = render(createElement(TokenGate));
    openAuth(view);

    // The landing (and with it the cover inside the panel) is gone...
    expect(view.container.querySelector('[data-testid="landing-page"]')).toBeNull();
    // ...and the wall's own cover is what the card now floats on.
    const photo = view.container.querySelector<HTMLElement>('[data-testid="door-wall-photo"]');
    expect(photo).not.toBeNull();
    expect(photo!.getAttribute('aria-hidden')).toBe('true');
    expect(photo!.querySelector('img')).not.toBeNull();
    // Every <img> in a decorative layer is empty-alt: the LQIP backdrop and the raster.
    for (const img of Array.from(photo!.querySelectorAll('img'))) expect(img.alt).toBe('');
    // D-293 R4 — the class the pause rule keys off is on the wall root, and only in this view.
    const wall = view.container.querySelector('.fixed');
    expect(wall?.classList.contains('wall-auth-open')).toBe(true);
    expect(photo!.querySelector('.door-kb')).not.toBeNull();
    view.unmount();
  });

  it('the backdrop is OUTSIDE the dialog panel and holds nothing focusable', () => {
    const view = render(createElement(TokenGate));
    openAuth(view);
    const panel = view.container.querySelector<HTMLElement>('[role="dialog"]')!;
    const photo = view.container.querySelector<HTMLElement>('[data-testid="door-wall-photo"]')!;
    // Not in `panelRef`, so neither the Tab-trap nor the entry-focus query can reach it.
    expect(panel.contains(photo)).toBe(false);
    expect(
      photo.querySelectorAll('a[href], button, input, textarea, select, [tabindex]').length,
    ).toBe(0);
    view.unmount();
  });

  it('the wall-open class is not on the landing view', () => {
    const view = render(createElement(TokenGate));
    expect(view.container.querySelector('.fixed')?.classList.contains('wall-auth-open')).toBe(
      false,
    );
    view.unmount();
  });
});
