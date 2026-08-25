// @vitest-environment jsdom
//
// #257 — CurrencyPanel's `asOf` date now carries a computed "N days old" next to it, for the
// two cases where a bare date string hides real staleness: the NPR static reference rate, and a
// cached live rate served after a failed refetch. `fetchCurrencyRate` and `getNow` are mocked
// directly so the day count is exact and deterministic — no network, no real clock.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { CurrencyRateResult } from '@/lib/currency-rate';

const state = vi.hoisted(() => ({ result: null as CurrencyRateResult | null }));

vi.mock('@/lib/currency-rate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/currency-rate')>();
  return { ...orig, fetchCurrencyRate: async () => state.result! };
});

// Fixed "now" so the day-count assertions below are exact, not just "a positive number".
vi.mock('@/lib/trip-now', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/trip-now')>();
  return { ...orig, getNow: () => new Date('2026-09-29T00:00:00') };
});

import TravelEssentialsCard from '@/components/travel-essentials-card';

let container: HTMLElement;
let root: Root;

async function mount(date: string): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(TravelEssentialsCard, { date }));
  });
  // Second flush: fetchCurrencyRate resolves on a microtask after mount, and the resulting
  // setState needs its own act pass to commit.
  await act(async () => {});
  return container;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('CurrencyPanel — staleness age (#257)', () => {
  it('NPR static reference rate: renders the exact computed "N days old" next to asOf', async () => {
    state.result = {
      status: 'ok',
      data: {
        currency: 'NPR',
        rate: 152.7,
        asOf: '2026-08-15',
        stale: false,
        fetchedAt: 'x',
        source: 'reference',
      },
    };
    const c = await mount('2026-12-10'); // a Nepal day on the default date backbone

    expect(
      c.querySelector('[data-testid="travel-essentials-currency-age"]')?.textContent,
    ).toBe('45 days old');
    expect(
      c.querySelector('[data-testid="travel-essentials-currency-reference"]')?.textContent,
    ).toContain('not a live quote');
  });

  it('a cached (stale) live rate also gets an age, not just the bare "(cached)" label', async () => {
    state.result = {
      status: 'ok',
      data: { currency: 'JPY', rate: 155.32, asOf: '2026-07-15', stale: true, fetchedAt: 'x', source: 'live' },
    };
    const c = await mount('2026-12-19'); // a Japan day on the default date backbone

    expect(
      c.querySelector('[data-testid="travel-essentials-currency-age"]')?.textContent,
    ).toBe('76 days old');
    expect(c.querySelector('[data-testid="travel-essentials-currency-asof"]')?.textContent).toContain('cached');
  });

  it('a fresh (non-stale) live rate omits the age — nothing stale to flag', async () => {
    state.result = {
      status: 'ok',
      data: { currency: 'JPY', rate: 155.32, asOf: '2026-09-28', stale: false, fetchedAt: 'x', source: 'live' },
    };
    const c = await mount('2026-12-19');

    expect(c.querySelector('[data-testid="travel-essentials-currency-age"]')).toBeNull();
  });

  it('singular day reads "1 day old", not "1 days old"', async () => {
    state.result = {
      status: 'ok',
      data: {
        currency: 'NPR',
        rate: 152.7,
        asOf: '2026-09-28', // one calendar day before the mocked 2026-09-29 "now"
        stale: false,
        fetchedAt: 'x',
        source: 'reference',
      },
    };
    const c = await mount('2026-12-10');

    expect(
      c.querySelector('[data-testid="travel-essentials-currency-age"]')?.textContent,
    ).toBe('1 day old');
  });
});
