// @vitest-environment jsdom
//
// #412 — the sign-in wall's countdown reads the app's one clock (`getNow()`, D-075), so `?today=`
// drives it. Before, it read `new Date()` and showed the real months-away countdown here.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { TRIP_START } from '@/lib/trip-data';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FAKE_NOW = new Date(TRIP_START.getTime() - ((2 * 60 + 3) * 60 + 4) * 1000);

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

describe('token-gate CompactCountdown', () => {
  it('counts down from getNow(), not the wall clock', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<TokenGate />));
    act(() => {
      container
        .querySelector('[data-testid="landing-cta-login"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const status = container.querySelector('[aria-label^="Departure in"]');
    expect(status?.getAttribute('aria-label')).toBe('Departure in 2 Hr, 3 Min, 4 Sec');
  });
});
