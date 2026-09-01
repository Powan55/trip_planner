// @vitest-environment jsdom
//
// `components/home-readiness.tsx` had no test at any level. What is pinned here is the thing
// that went wrong on the one route the owner actually opens: the rows used to render UNGATED
// while the summary line alone waited on `hydrated`, so a prepared trip painted "Not started"
// four times and then corrected itself. The gate is now the same `hydrated` on both, and the
// un-hydrated paint renders the SHAPE (SPEC 9.8) instead of a verdict.
//
// Mock shape mirrors `nightlife-section-gate.test.tsx` — hoisted-safe `vi.mock` of the hooks, so
// no provider tree, no IndexedDB and no clock. The four sources are stubbed because THEIR
// hydration timing is exactly what is under test; the arithmetic on top of them (`rollUp`,
// `fracStatus`, `TRIP_DATES`) stays real.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const state = vi.hoisted(() => ({
  itineraryHydrated: true,
  packingHydrated: true,
  docsHydrated: true,
  plans: [] as Array<{ date: string; items: unknown[] }>,
  packing: { checked: 0, total: 0 },
  docs: { done: 0, total: 0 },
  legBudgets: { nepal: 0, japan: 0 } as Record<string, number>,
}));

vi.mock('@/components/itinerary-provider', () => ({
  useItineraryContext: () => ({ plans: state.plans, hydrated: state.itineraryHydrated }),
}));
vi.mock('@/hooks/use-packing', () => ({
  usePacking: () => ({ progress: state.packing, hydrated: state.packingHydrated }),
}));
vi.mock('@/hooks/use-docs', () => ({
  useDocs: () => ({ completion: state.docs, hydrated: state.docsHydrated }),
}));
vi.mock('@/hooks/use-budget', () => ({
  useBudget: () => ({
    model: {
      version: 1,
      homeCurrency: 'USD',
      rates: {},
      legBudgets: state.legBudgets,
      categoryBudgets: {},
    },
  }),
}));
vi.mock('@/hooks/use-expenses', () => ({ useExpenses: () => ({ expenses: [] }) }));

import HomeReadiness from '@/components/home-readiness';
import { TRIP_DATES } from '@/lib/trip-data';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(HomeReadiness)));
  return container;
}

const ROW_IDS = ['days', 'docs', 'packing', 'budget'] as const;
const row = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`[data-testid="home-readiness-${id}"]`);

/** Every day carries an item, so the "days planned" check reads ready. */
function fullyPlanned() {
  return TRIP_DATES.map((date) => ({ date, items: [{ id: `${date}-1` }] }));
}

beforeEach(() => {
  state.itineraryHydrated = true;
  state.packingHydrated = true;
  state.docsHydrated = true;
  state.plans = [];
  state.packing = { checked: 0, total: 0 };
  state.docs = { done: 0, total: 0 };
  state.legBudgets = { nepal: 0, japan: 0 };
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('HomeReadiness — "Before you fly" on /', () => {
  it('claims nothing before the stores settle: no "Not started", no verdict rows, the shape instead', () => {
    state.itineraryHydrated = false;
    state.packingHydrated = false;
    state.docsHydrated = false;
    const c = mount();

    // The defect: the zero state used to paint here and then flip.
    expect(c.textContent).not.toContain('Not started');
    expect(c.textContent).not.toContain('No checklist yet');
    expect(c.textContent).not.toContain('No packing list yet');
    expect(c.textContent).not.toContain('No budget set yet');
    expect(c.textContent).not.toContain('ready');
    for (const id of ROW_IDS) expect(row(c, id)).toBeNull();

    // The section — and the reserved box it sits in — still exists.
    expect(c.querySelector('[data-testid="home-readiness"]')).not.toBeNull();

    // The shape: the four rows it will hold, at full size, each saying in words that it is
    // still reading, with LOADING as a real text node (never a bare grey block).
    const loading = c.querySelector<HTMLElement>('[data-testid="home-readiness-loading"]');
    expect(loading).not.toBeNull();
    expect(loading?.querySelectorAll('li').length).toBe(4);
    for (const id of ROW_IDS) {
      const r = c.querySelector<HTMLElement>(`[data-testid="home-readiness-loading-${id}"]`);
      expect(r?.dataset.s).toBe('hollow');
      expect(r?.querySelector('.cond')?.textContent).toMatch(/^Reading /);
      expect(r?.textContent).toContain('LOADING');
    }
    expect(c.textContent).toContain('Reading this device');

    // The days row's line is long ON PURPOSE. Its settled sentence ("n of 32 days have
    // something on them", 34-36 chars) wraps to two lines below 480px and in the 640-1023
    // two-column grid; a short line there leaves the loading shape 20.7px under the height it
    // settles at. Measured on the built export — see the note on LOADING_ROWS.
    const daysCond =
      c.querySelector('[data-testid="home-readiness-loading-days"] .cond')?.textContent ?? '';
    expect(daysCond.length).toBeGreaterThanOrEqual(34);
  });

  it('one store still reading holds the whole section — the gate is the AND, not any one flag', () => {
    state.packingHydrated = true;
    state.docsHydrated = true;
    state.itineraryHydrated = false;
    state.docs = { done: 4, total: 4 };
    const c = mount();

    expect(c.querySelector('[data-testid="home-readiness-loading"]')).not.toBeNull();
    expect(row(c, 'docs')).toBeNull();
    expect(c.textContent).not.toContain('Not started');
  });

  it('once hydrated, the ready count is exactly the number of checks that pass', () => {
    state.plans = fullyPlanned(); // days   -> ready
    state.docs = { done: 3, total: 3 }; // docs   -> ready
    state.packing = { checked: 2, total: 5 }; // packing -> in progress
    state.legBudgets = { nepal: 50000, japan: 0 }; // budget -> ready
    const c = mount();

    expect(c.querySelector('[data-testid="home-readiness-loading"]')).toBeNull();
    expect(c.textContent).toContain('3 of 4 ready');

    const words = ROW_IDS.map(
      (id) => c.querySelector(`[data-testid="home-readiness-${id}-word"]`)?.textContent,
    );
    expect(words).toEqual(['Ready', 'Ready', 'In progress', 'Ready']);
    expect(words.filter((w) => w === 'Ready').length).toBe(3);

    // And the count moves with the checks rather than being written twice.
    act(() => root.unmount());
    state.docs = { done: 1, total: 3 };
    expect(mount().textContent).toContain('2 of 4 ready');
  });

  it('an empty device says "0 of 4 ready" and "Not started" only once it has actually read', () => {
    const c = mount();
    expect(c.textContent).toContain('0 of 4 ready');
    expect(row(c, 'packing')?.textContent).toContain('Not started');
    expect(row(c, 'packing')?.textContent).toContain('No packing list yet');
  });

  it('every row states its condition in words, never by colour or mark alone', () => {
    state.plans = fullyPlanned();
    state.docs = { done: 1, total: 4 };
    state.packing = { checked: 0, total: 6 };
    const c = mount();

    const expected: Record<string, string> = {
      days: 'Ready',
      docs: 'In progress',
      packing: 'Not started',
      budget: 'Not started',
    };
    for (const id of ROW_IDS) {
      const r = row(c, id);
      // The word is a text node in the row, not only a class or a data attribute.
      expect(r?.textContent).toContain(expected[id]);
      // Repeated with the counts for a screen reader, which never sees the mark at all.
      expect(r?.getAttribute('aria-label')).toContain(expected[id]);
      expect(r?.querySelector('.mk')?.getAttribute('aria-hidden')).toBe('true');
    }
    expect(row(c, 'docs')?.textContent).toContain('1 of 4 checked off');
    expect(row(c, 'packing')?.getAttribute('aria-label')).toContain('0 of 6 packed');
  });
});
