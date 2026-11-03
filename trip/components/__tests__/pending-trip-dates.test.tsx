// @vitest-environment jsdom
//
// #970: a trip whose dates have not loaded yet shows the pending label, never a countdown or
// hardcoded dates.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const PENDING = 'Trip details not loaded yet';

vi.mock('@/core/dates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/dates')>()),
  TRIP_DATES_PENDING: true,
  TRIP_DATE_LABEL: 'Trip details not loaded yet',
}));

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
    useReducedMotion: () => true,
    useScroll: () => ({ scrollYProgress: 0 }),
    useTransform: () => 0,
  };
});

import TravelHeroCard from '@/components/travel-hero-card';
import HeroSection from '@/components/hero-section';
import TokenGate from '@/components/token-gate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(node));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

describe('pending trip dates (#970)', () => {
  it('Travel Mode off-trip copy shows the pending label, not hardcoded dates', () => {
    mount(<TravelHeroCard />);
    const copy = container.querySelector('[data-testid="travel-hero-offtrip"]')!;
    expect(copy.textContent).toBe(`${PENDING}.`);
    expect(container.textContent).not.toMatch(/Dec 9|2099/);
  });

  it('Home hero drops the countdown and shows the pending label', () => {
    mount(<HeroSection />);
    expect(container.textContent).toContain(PENDING);
    expect(container.textContent).not.toContain('Countdown to day one');
    expect(container.querySelector('[data-testid="countdown-total-days"]')).toBeNull();
  });

  it('sign-in wall countdown shows the pending label instead of a timer', () => {
    mount(<TokenGate />);
    act(() => {
      container
        .querySelector('[data-testid="landing-cta-login"]')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[aria-label^="Departure in"]')).toBeNull();
    expect(container.textContent).toContain(PENDING);
  });
});
