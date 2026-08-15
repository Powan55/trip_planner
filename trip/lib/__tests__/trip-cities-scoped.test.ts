// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveTripId } from '@/core/storage/gateway';
import { setTripConfig, type TripConfigBlock } from '@/core/trips/registry';

/**
 * S330 (D-231) — `getCityForDate` is TRIP-SCOPED. Regression guard for the wrong-data bug where a
 * CUSTOM trip overlapping the default Dec 9 – Jan 9 window resolved per-day cities from the DEFAULT
 * content pack (`TRIP_CITIES`) and wrongly showed Kathmandu / Osaka / Tokyo.
 *
 * `getCityForDate` captures the active trip + `isDefaultTrip()` at MODULE LOAD (D-172: a switch is a
 * pointer write + full page reload, so a fresh module graph re-captures the new trip). This suite
 * therefore sets the active-trip pointer/config FIRST, then `vi.resetModules()` + dynamic-imports the
 * module so it loads under the custom trip — the same technique custom-trip-config.test.ts uses for
 * the module-load budget model. The frozen S82 boundary matrix stays in lib/__tests__/trip-cities.test.ts,
 * UNCHANGED (that file proves the default trip is byte-identical).
 */

// A custom single-leg trip whose span OVERLAPS the default Dec 9 – Jan 9 window. Its own leg city
// (destinations[0]) is 'Reykjavik' — never a default-pack city — so a leak of the default map is loud.
const OVERLAP: TripConfigBlock = {
  start: '2026-12-05',
  end: '2027-01-15',
  destinations: ['Reykjavik', 'Vik'],
  vibe: 'roadtrip',
  currency: 'ISK',
  updatedAt: 1000,
};

describe('S330 getCityForDate — trip-scoped (custom trip does NOT inherit the default per-day map)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('a custom trip overlapping Dec 9 – Jan 9 resolves in-window dates to ITS OWN leg city, not Kathmandu/Osaka/Tokyo', async () => {
    setActiveTripId('custom-overlap');
    setTripConfig('custom-overlap', OVERLAP);

    vi.resetModules(); // re-capture the active (custom) trip at module load
    const { getCityForDate } = await import('@/core/dates/trip-cities');

    // Dates that, on the DEFAULT pack, are New York (Dec 9 — D-315), Kathmandu (Dec 12/18),
    // Osaka (Dec 19) and Tokyo (Jan 9).
    for (const date of ['2026-12-09', '2026-12-12', '2026-12-18', '2026-12-19', '2027-01-09']) {
      const city = getCityForDate(date);
      expect(city, `${date} leaked the default per-day map`).toBe('Reykjavik'); // the custom leg fallbackCity
      expect(['New York', 'Kathmandu', 'Osaka', 'Tokyo']).not.toContain(city);
    }
  });

  it('the DEFAULT trip (unset pointer) still resolves the frozen S82 boundary cities from the per-day map', async () => {
    // Parity re-check in this file too: with no pointer set, the module loads under the default pack
    // and the authored per-day map applies exactly as before.
    vi.resetModules();
    const { getCityForDate } = await import('@/core/dates/trip-cities');
    expect(getCityForDate('2026-12-09')).toBe('New York'); // D-315 — was Syracuse, was Kathmandu
    expect(getCityForDate('2026-12-19')).toBe('Osaka');
    expect(getCityForDate('2027-01-09')).toBe('Tokyo');
  });
});
