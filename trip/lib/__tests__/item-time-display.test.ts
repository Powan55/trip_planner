import { describe, it, expect, afterEach, vi } from 'vitest';

// S125 — the ONE display rule (D-137/D-138) exercised in isolation
// from any component. Reuses S124's core helpers only; adds no new parsing/math.

import { describeItemTime } from '@/lib/item-time-display';
import { TRIP_ITINERARY } from '@/core/content/itinerary';
import type { ItineraryItem } from '@/lib/trip-data';
import { setActiveTripId } from '@/core/storage/gateway';
import { setTripConfig, type TripConfigBlock } from '@/core/trips/registry';

function mk(fields: Partial<ItineraryItem>): ItineraryItem {
  return { id: 'x', title: 'X', category: 'sightseeing', ...fields };
}

/**
 * S390-A — pull a REAL seeded item out of the shipped content pack by id.
 *
 * 🔴 Deliberately NOT `mk({ tzOffsetMin: -300 })`. A hand-built item tests the FUNCTION and
 * never touches the seed, so it stays green even if `j22-5` never carried `tzOffsetMin` at
 * all (or someone later strips it) — i.e. it cannot see the defect that was reported. The
 * `?? throw` is what makes a renamed/removed id a loud failure instead of a silent skip.
 */
function seeded(id: string): ItineraryItem {
  for (const day of TRIP_ITINERARY) {
    const hit = (day.items ?? []).find((i) => i.id === id);
    if (hit) return hit;
  }
  throw new Error(`S390-A: seeded item '${id}' is gone from TRIP_ITINERARY`);
}

const NEPAL_DAY = '2026-12-10'; // inside NEPAL_START..NEPAL_END
const JAPAN_DAY = '2026-12-20'; // inside JAPAN_START..JAPAN_END

describe('describeItemTime — display rule', () => {
  it('a structured startMinutes renders AM/PM + the NPT badge on a Nepal day', () => {
    expect(describeItemTime(mk({ startMinutes: 855 }), NEPAL_DAY)).toEqual({
      label: '2:15 PM',
      badge: 'NPT',
    });
  });

  it('a structured startMinutes renders AM/PM + the JST badge on a Japan day', () => {
    expect(describeItemTime(mk({ startMinutes: 855 }), JAPAN_DAY)).toEqual({
      label: '2:15 PM',
      badge: 'JST',
    });
  });

  it('a parseable legacy `time` (no startMinutes) also renders badged, via the fallback', () => {
    expect(describeItemTime(mk({ time: '2:15 pm' }), NEPAL_DAY)).toEqual({
      label: '2:15 PM',
      badge: 'NPT',
    });
  });

  it('an unparseable legacy `time` renders verbatim, UNBADGED', () => {
    expect(describeItemTime(mk({ time: '2pm-ish' }), NEPAL_DAY)).toEqual({
      label: '2pm-ish',
      badge: null,
    });
  });

  it('no usable time at all renders null (untimed)', () => {
    expect(describeItemTime(mk({}), NEPAL_DAY)).toBeNull();
  });

  it('an out-of-range startMinutes falls through to the legacy text, badged if parseable', () => {
    expect(describeItemTime(mk({ startMinutes: 9999, time: '06:00' }), NEPAL_DAY)).toEqual({
      label: '6:00 AM',
      badge: 'NPT',
    });
  });
});

/**
 * S390-A → S393 — the badge must name the zone the item is ACTUALLY in.
 *
 * S390-A stopped the lie by suppressing the badge on an override item; S393 (D-137 AMENDED,
 * owner-signed) finishes the job by naming the real zone. The assertions below moved from
 * `badge: null` to the real abbreviation ON PURPOSE — `null` is no longer the right answer for
 * a KNOWN offset, only for an unknown one.
 *
 * The PAIR is still the instrument, and both halves are load-bearing:
 *   · `j22-6` is the Detroit layover (`tzOffsetMin: -300`) logged on a `country: 'japan'` day.
 *     Badging it JST claimed a time 14 hours away from the one the item actually means; badging
 *     it nothing left it reading as JST by context. It must say EST. FAILS on BOTH earlier
 *     versions of the code (pre-S390-A said 'JST', S390-A said null).
 *   · `j22-5` is its SAME-DAY sibling with no override. It is the control: it fails on the
 *     over-broad "fix" (re-derive the badge for every item, or drop the day-country path), which
 *     would otherwise read as a pass. It must still say JST.
 * Whole-object `toEqual`, never `toBeFalsy()`/`not.toBe('JST')` — the latter pass on `undefined`
 * and on `'NPT'` respectively, i.e. they accept a 5h45 lie in place of a 14h one.
 *
 * 🔴 The time itself is NEVER converted (D-137's surviving core rule): `j22-6` still reads
 * "3:35 PM", the wall-clock in Detroit — only the label attached to it changed.
 */
describe('describeItemTime — S393: an item in another zone is badged with its REAL zone', () => {
  const LAST_DAY = '2027-01-09';

  it('a seeded item with its own tzOffsetMin renders its OWN zone, not the day’s', () => {
    expect(describeItemTime(seeded('j22-6'), LAST_DAY)).toEqual({
      label: '3:35 PM',
      badge: 'EST',
    });
  });

  it('its same-day sibling with no override keeps the day-country badge (the control)', () => {
    expect(describeItemTime(seeded('j22-5'), LAST_DAY)).toEqual({
      label: '5:35 PM',
      badge: 'JST',
    });
  });

  it('the Nepal leg is covered too — an override on a nepal day names its own zone', () => {
    // n1-1 departs Syracuse (-300) on a `country: 'nepal'` day → NPT would be 10h45 wrong.
    // (2026-12-09 carries no unbadged sibling — every item on it is an override — so the
    // control for this rule is the j22-5 assertion above, on the day that HAS both kinds.)
    expect(describeItemTime(seeded('n1-1'), '2026-12-09')).toEqual({
      label: '5:29 AM',
      badge: 'EST',
    });
    // A plain Nepal-day item on the very next day still keeps NPT (nothing was over-broadened).
    expect(describeItemTime(seeded('n2-3'), '2026-12-10')).toEqual({
      label: '4:10 PM',
      badge: 'NPT',
    });
  });

  it('the other two seeded override zones resolve too — IST (Delhi) and CST (Guangzhou)', () => {
    // The whole table is exercised on REAL seed items, not hand-built ones, so stripping an
    // override off the content goes red here rather than silently passing.
    expect(describeItemTime(seeded('n2-1'), '2026-12-10')).toEqual({
      label: '11:40 AM',
      badge: 'IST',
    });
    expect(describeItemTime(seeded('j1-1'), '2026-12-19')).toEqual({
      label: '5:55 AM',
      badge: 'CST',
    });
  });

  it('an offset the table does not know stays UNBADGED — silence, never a guessed label', () => {
    // +60 (CET) is nowhere on this trip. The honest answer is no badge — NOT 'UTC+1', not the
    // day's zone. Hand-built on purpose: no seed item carries an unknown offset, and this guards
    // the fallback branch that keeps a future content edit from inventing a zone name.
    expect(describeItemTime(mk({ startMinutes: 855, tzOffsetMin: 60 }), JAPAN_DAY)).toEqual({
      label: '2:15 PM',
      badge: null,
    });
  });
});

/**
 * #243 — a CUSTOM trip badged every item with the DEVICE's zone.
 *
 * The guarantee in `lib/item-time-display.ts` says a day offset with no table entry, naming a
 * custom pack's own leg offset, stays unbadged. It was not delivered: the badge's base offset came
 * from `offsetForCountry`, which substitutes `-new Date().getTimezoneOffset()` for a pack where
 * every leg carries the placeholder `utcOffsetMin: 0` (core/trips/custom.ts). So the leg's 0 never
 * reached the table and the device's own offset did — a Paris trip planned from a US-Eastern phone
 * in December badged every item `EST`. The badge now bases on `declaredOffsetForCountry`.
 *
 * The device offset is STUBBED to -300 rather than inherited from the suite's `TZ`
 * (`America/New_York`, per vitest.config.ts). `offsetForCountry` reads the offset at CALL time
 * against the real clock, so an inherited zone gives -300 only between November and March: run in
 * August it is -240, which has no table entry either and the pre-fix code would have gone green.
 * That is the same "silently a no-op on CI" failure the TZ pin in vitest.config.ts exists to close.
 *
 * Module-load capture: `core/dates` reads the active pack once per module graph (D-172 — a trip
 * switch is a pointer write plus a full reload), so the pointer/config are set FIRST and the
 * subject is then dynamically imported after `vi.resetModules()`, as trip-cities-scoped.test.ts
 * and leg-label.test.ts do. The default-pack blocks above are the control and use the static
 * import — they must stay NPT/JST/EST/IST/CST, unchanged by this fix.
 */
describe('#243 describeItemTime — a custom trip never borrows the device zone', () => {
  const PARIS: TripConfigBlock = {
    start: '2027-03-01',
    end: '2027-03-05',
    destinations: ['Paris'],
    vibe: 'city',
    currency: 'EUR',
    updatedAt: 1000,
  };
  const PARIS_DAY = '2027-03-02';

  async function loadUnderCustomTrip() {
    localStorage.clear();
    sessionStorage.clear();
    setActiveTripId('custom-paris');
    setTripConfig('custom-paris', PARIS);

    vi.resetModules();
    const { describeItemTime: fresh } = await import('@/lib/item-time-display');
    // A device on US Eastern standard time — the exact reported configuration. Stubbed AFTER the
    // import on purpose: `offsetForCountry` reads it at CALL time, so the module graph still loads
    // against the real clock and nothing else is perturbed.
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300);
    return fresh;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('an ordinary item on a custom trip renders its time UNBADGED, not "EST"', async () => {
    const describe243 = await loadUnderCustomTrip();
    // Whole-object per this file's rule — 'EST' (the defect), 'NPT' and `undefined` all go red.
    expect(describe243(mk({ startMinutes: 855 }), PARIS_DAY)).toEqual({
      label: '2:15 PM',
      badge: null,
    });
  });

  it('the label itself is untouched — silence is only about the badge', async () => {
    const describe243 = await loadUnderCustomTrip();
    expect(describe243(mk({ startMinutes: 345 }), PARIS_DAY)).toEqual({
      label: '5:45 AM',
      badge: null,
    });
    expect(describe243(mk({ time: '2pm-ish' }), PARIS_DAY)).toEqual({
      label: '2pm-ish',
      badge: null,
    });
    expect(describe243(mk({}), PARIS_DAY)).toBeNull();
  });

  it('a per-item tzOffsetMin is a real declaration and still badges on a custom trip', async () => {
    // The control against over-suppressing (blanket "no badge on a custom trip"). -300 here is the
    // ITEM's own asserted offset, not the device's, so S393 still applies and it must say EST.
    const describe243 = await loadUnderCustomTrip();
    expect(describe243(mk({ startMinutes: 935, tzOffsetMin: -300 }), PARIS_DAY)).toEqual({
      label: '3:35 PM',
      badge: 'EST',
    });
  });
});
