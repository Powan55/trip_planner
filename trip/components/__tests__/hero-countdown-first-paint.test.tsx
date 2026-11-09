// @vitest-environment jsdom
//
// #1065: the Home countdown prints the live numbers from the first committed frame. It used to
// count up from 00 over 2s, so every visit showed wrong numbers while the reveal ran.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { computeCountdown } from '@/core/clock/countdown';
import { TRIP_START } from '@/core/dates';
import { daysToGo } from '@/lib/home-stats';

const NOW = new Date('2026-11-03T12:00:00');

vi.mock('@/lib/trip-now', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/trip-now')>()),
  getNow: () => new Date('2026-11-03T12:00:00'),
  getTodayInTrip: () => null,
  getTripDayDate: () => '2026-11-03',
}));

vi.mock('@/hooks/use-trip-day', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/use-trip-day')>()),
  useTripDay: () => '2026-11-03',
}));

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ hydrated: true, getDayPlan: () => ({ items: [] }) }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
}));

vi.mock('framer-motion', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const DROP = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout', 'layoutId', 'style']);
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
  return {
    m,
    AnimatePresence: ({ children }: { children: unknown }) => children,
    useReducedMotion: () => false,
    useScroll: () => ({ scrollYProgress: 0 }),
    useTransform: () => 0,
  };
});

import HeroSection from '@/components/hero-section';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

describe('hero countdown first paint (#1065)', () => {
  it('shows the live numbers immediately, with motion allowed', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<HeroSection />));

    const text = (id: string) => container.querySelector(`[data-testid="${id}"]`)?.textContent;
    const left = computeCountdown(TRIP_START, NOW);
    expect(left.totalDays).toBeGreaterThan(0);
    expect(text('countdown-total-days')).toBe(String(daysToGo(NOW)));
    expect(text('countdown-hours')).toBe(String(left.hours).padStart(2, '0'));
    expect(text('countdown-minutes')).toBe(String(left.minutes).padStart(2, '0'));
  });
});
