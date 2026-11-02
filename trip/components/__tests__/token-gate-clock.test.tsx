// @vitest-environment jsdom
//
// #412 — the sign-in wall's countdown reads the app's one clock (`getNow()`, D-075), so `?today=`
// drives it. Before, it read `new Date()` and showed the real months-away countdown here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { TRIP_START, TRIP_END } from '@/lib/trip-data';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let FAKE_NOW = new Date(TRIP_START.getTime() - ((2 * 60 + 3) * 60 + 4) * 1000);

vi.mock('@/lib/trip-now', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/trip-now')>();
  return { ...orig, getNow: () => new Date(FAKE_NOW) };
});

// LazyMotion-strict `m.*` needs a provider; plain host elements are enough here.
vi.mock('framer-motion', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const DROP = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout', 'layoutId']);
  const m = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        const Motion = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const clean: Record<string, unknown> = {};
          for (const k of Object.keys(props)) if (!DROP.has(k)) clean[k] = props[k];
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

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

function openAuthView(now: Date) {
  FAKE_NOW = now;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<TokenGate />));
  act(() => {
    container
      .querySelector('[data-testid="landing-cta-login"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('token-gate CompactCountdown', () => {
  it('counts down from getNow(), not the wall clock', () => {
    openAuthView(new Date(TRIP_START.getTime() - ((2 * 60 + 3) * 60 + 4) * 1000));
    const timer = container.querySelector('[aria-label^="Departure in"]');
    expect(timer?.getAttribute('aria-label')).toBe('Departure in 2 Hr, 3 Min, 4 Sec');
  });

  it('is a timer, not a live region: the ticking digits are never announced', () => {
    openAuthView(new Date(TRIP_START.getTime() - 5000));
    const timer = container.querySelector('[aria-label^="Departure in"]')!;
    expect(timer.getAttribute('role')).toBe('timer');
    expect(timer.closest('[role="status"], [aria-live]')).toBeNull();
    expect(timer.querySelector('[role="status"], [aria-live]')).toBeNull();
  });

  it('says the journey has begun mid-trip and that it has ended afterwards', () => {
    openAuthView(new Date(TRIP_START.getTime() + 86_400_000));
    expect(container.textContent).toContain('The journey has begun.');
    act(() => root.unmount());
    container.remove();
    openAuthView(new Date(TRIP_END.getTime() + 86_400_000));
    expect(container.textContent).toContain('The trip has ended.');
    expect(container.textContent).not.toContain('The journey has begun.');
  });
});
