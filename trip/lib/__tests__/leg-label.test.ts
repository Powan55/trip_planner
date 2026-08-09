// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveTripId } from '@/core/storage/gateway';
import { setTripConfig, type TripConfigBlock } from '@/core/trips/registry';

/**
 * S407 — the ONE leg-label / place-label helper (`lib/leg-label.ts`).
 *
 * What this suite has to discriminate (each of these shipped in the app before this slice):
 *   - "Syracuse, Nepal"      — the Dec-9 planner header, because `country` (a LEG ID driving
 *                              currency + UTC offset) was rendered as if it were a label.
 *   - "Bali, Japan"          — every day of every CUSTOM trip, from the same nepal/japan ternary.
 *   - "Bali, Bali × Lombok"  — the trap in the naive fix: a custom leg's `countryLabel` IS
 *                              `destinations.join(' × ')` (core/trips/custom.ts).
 *
 * `lib/leg-label.ts` captures the active trip at MODULE LOAD (D-172: a trip switch is a pointer
 * write + full page reload), so the custom-trip block sets the pointer/config FIRST and then
 * `vi.resetModules()` + dynamic-imports — the same technique lib/__tests__/trip-cities-scoped.test.ts
 * uses for the module-load city map.
 */

/** A custom trip whose span deliberately OVERLAPS the default Dec 9 – Jan 9 window (D-231). */
const BALI: TripConfigBlock = {
  start: '2026-12-05',
  end: '2027-01-15',
  destinations: ['Bali', 'Lombok'],
  vibe: 'beach',
  currency: 'IDR',
  updatedAt: 1000,
};

async function loadHelper() {
  vi.resetModules();
  return import('@/lib/leg-label');
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('S407 default pack — the day line names the day, not the leg id', () => {
  it('Day 1 renders "Syracuse, USA" from the seed row, while its leg id stays nepal', async () => {
    const { dayPlaceLabel } = await loadHelper();
    const { SAMPLE_ITINERARY } = await import('@/lib/sample-itinerary');
    const day1 = SAMPLE_ITINERARY[0];

    expect(day1.date).toBe('2026-12-09');
    expect(day1.country).toBe('nepal'); // the LEG ID is untouched — currency + offset depend on it
    expect(dayPlaceLabel(day1)).toBe('Syracuse, USA');
    expect(dayPlaceLabel(day1)).not.toBe('Syracuse, Nepal'); // the bug this slice exists for
  });

  it('a day with no per-day label still gets its leg label (Dec 10 / Dec 19)', async () => {
    const { dayPlaceLabel } = await loadHelper();
    const { SAMPLE_ITINERARY } = await import('@/lib/sample-itinerary');
    const dec10 = SAMPLE_ITINERARY.find((d) => d.date === '2026-12-10')!;
    const dec19 = SAMPLE_ITINERARY.find((d) => d.date === '2026-12-19')!;

    // Pinned verbatim by e2e/weather-tag.spec.ts ('Day 2 • Kathmandu, Nepal') — must not move.
    expect(dayPlaceLabel(dec10)).toBe('Kathmandu, Nepal');
    expect(dayPlaceLabel(dec19)).toBe('Osaka, Japan');
  });

  it('the by-DATE path (dialog option lists, no DayPlan in hand) agrees with the by-plan path', async () => {
    const { placeLabelForDate } = await loadHelper();
    expect(placeLabelForDate('2026-12-09')).toBe('Syracuse, USA');
    expect(placeLabelForDate('2026-12-10')).toBe('Kathmandu, Nepal');
    expect(placeLabelForDate('2027-01-09')).toBe('Tokyo, Japan');
  });

  it('a day that lost countryLabel over Firestore sync still reads Syracuse, USA', async () => {
    // `docToDayPlan` (lib/itinerary-remote.ts) is shape-FROZEN and drops unknown fields, so a
    // synced Dec-9 day arrives without `countryLabel`. The content-derived DAY_LABELS map is what
    // fills it back in — without that fallback this renders the old "Syracuse, Nepal".
    const { dayPlaceLabel } = await loadHelper();
    const synced = { date: '2026-12-09', city: 'Syracuse', country: 'nepal', items: [] };
    expect(dayPlaceLabel(synced)).toBe('Syracuse, USA');
  });

  it('legLabel maps the default pack ids to their pack labels', async () => {
    const { legLabel } = await loadHelper();
    expect(legLabel('nepal')).toBe('Nepal');
    expect(legLabel('japan')).toBe('Japan');
  });
});

describe('S407 custom trip — neither a foreign country nor a duplicated city', () => {
  beforeEach(() => {
    setActiveTripId('custom-bali');
    setTripConfig('custom-bali', BALI);
  });

  it('a main-leg day renders the bare city — not "Bali, Japan", not "Bali, Bali × Lombok"', async () => {
    const { dayPlaceLabel } = await loadHelper();
    const day = { date: '2026-12-20', city: 'Bali', country: 'main', items: [] };

    const label = dayPlaceLabel(day);
    expect(label).toBe('Bali');
    expect(label).not.toContain('Nepal');
    expect(label).not.toContain('Japan');
    expect(label).not.toBe('Bali, Bali × Lombok');
    expect(label).not.toContain('×'); // the joined-destinations label never reaches a day line
  });

  it('a custom day whose city is NOT destinations[0] still appends nothing (single leg says nothing)', async () => {
    const { dayPlaceLabel } = await loadHelper();
    const day = { date: '2026-12-20', city: 'Ubud', country: 'main', items: [] };
    expect(dayPlaceLabel(day)).toBe('Ubud');
  });

  it('the by-DATE path on a custom trip overlapping Dec 9 does NOT inherit the default labels', async () => {
    const { placeLabelForDate } = await loadHelper();
    // D-231 trip-scoping: these dates are Syracuse/USA and Tokyo/Japan on the DEFAULT pack.
    expect(placeLabelForDate('2026-12-09')).toBe('Bali');
    expect(placeLabelForDate('2027-01-09')).toBe('Bali');
  });

  it('legLabel(main) is the joined destinations label — correct on its OWN (the expense/settle-up chip)', async () => {
    const { legLabel } = await loadHelper();
    expect(legLabel('main')).toBe('Bali × Lombok');
  });

  it('legLabel of an unknown/stale leg id falls back capitalized, never blank or lowercase', async () => {
    const { legLabel } = await loadHelper();
    expect(legLabel('nepal')).toBe('Nepal');
  });
});
