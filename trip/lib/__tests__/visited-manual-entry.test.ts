// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS } from '@/core/storage/gateway';
import {
  addVisit,
  confirmVisit,
  foldPlaceName,
  getVisited,
  getVisitConfirmations,
  hasVisitedCity,
  hasVisitedCountry,
  markVisitCheck,
  removeVisit,
  tidyPlaceName,
  PLACE_NAME_MAX,
} from '@/core/places/visited';

/**
 * Issue #4 — the manual-entry half of the lifetime visit set: what a person may TYPE into it, and
 * how they take it back out. `lib/__tests__/visited-lifetime.test.ts` (issue #29) still owns the
 * set's own laws and the survives-a-wipe centrepiece; this file owns the two things #4 added.
 *
 *  1. THE TRUST BOUNDARY. `/profile`'s city field is free text, so `tidyPlaceName` is the only
 *     thing between a paste and permanent storage. Every clause of it is pinned here, including
 *     the two that are policy rather than hygiene: a name over the cap is REFUSED, never
 *     truncated, and the user's own spelling and case always survive.
 *  2. THE REMOVE PATH. It is asserted to keep the four guarantees the set is built on — nothing
 *     reordered, nothing duplicated, the fold rule deciding what "matching" means — and to take
 *     the removed city's GPS confirmation (key 34, D-320) with it rather than leaving a shadow
 *     record of a place the person just deleted.
 *
 * The adds go through the REAL `addVisit`, never a hand-rolled write, so a policy that stopped
 * being applied inside the store could not pass these by being applied in a test helper.
 */

const KEY = 'tripPlannerLifetimeVisits';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('tidyPlaceName — the trust boundary a typed-in place name crosses', () => {
  it('trims the ends and collapses internal whitespace', () => {
    expect(tidyPlaceName('  Kathmandu  ')).toEqual({ ok: true, value: 'Kathmandu' });
    expect(tidyPlaceName('New    York')).toEqual({ ok: true, value: 'New York' });
    expect(tidyPlaceName('\tSan\n\nFrancisco ')).toEqual({ ok: true, value: 'San Francisco' });
  });

  it('KEEPS the spelling and case exactly as typed — nothing here "corrects" a name', () => {
    expect(tidyPlaceName('kathmandu')).toEqual({ ok: true, value: 'kathmandu' });
    expect(tidyPlaceName('LONDON')).toEqual({ ok: true, value: 'LONDON' });
    expect(tidyPlaceName("Côte d'Or")).toEqual({ ok: true, value: "Côte d'Or" });
    expect(tidyPlaceName('東京')).toEqual({ ok: true, value: '東京' });
  });

  it('turns control, zero-width and bidi characters into a word break, never a silent weld', () => {
    // A zero-width space between two words must not produce "Kathmandu" out of two other words.
    expect(tidyPlaceName('Kath\u200Bmandu')).toEqual({ ok: true, value: 'Kath mandu' });
    expect(tidyPlaceName('Tokyo\u0007')).toEqual({ ok: true, value: 'Tokyo' });
    expect(tidyPlaceName('\u202EParis\u202C')).toEqual({ ok: true, value: 'Paris' });
    expect(tidyPlaceName('Osaka\uFEFF')).toEqual({ ok: true, value: 'Osaka' });
  });

  it('refuses blank, whitespace-only and control-only input', () => {
    expect(tidyPlaceName('')).toEqual({ ok: false, reason: 'blank' });
    expect(tidyPlaceName('   ')).toEqual({ ok: false, reason: 'blank' });
    expect(tidyPlaceName('\u200B\u200B')).toEqual({ ok: false, reason: 'blank' });
    expect(tidyPlaceName(undefined)).toEqual({ ok: false, reason: 'blank' });
    expect(tidyPlaceName(42)).toEqual({ ok: false, reason: 'blank' });
  });

  it('refuses an over-long name rather than TRUNCATING it — a cut-off name is a different place', () => {
    const atCap = 'a'.repeat(PLACE_NAME_MAX);
    expect(tidyPlaceName(atCap)).toEqual({ ok: true, value: atCap });
    expect(tidyPlaceName('a'.repeat(PLACE_NAME_MAX + 1))).toEqual({
      ok: false,
      reason: 'too-long',
    });
    // The cap is measured AFTER tidying, so padding is not what pushes a real name over it.
    expect(tidyPlaceName(`  ${atCap}  `)).toEqual({ ok: true, value: atCap });
  });

  it('refuses a name with no letter or digit anywhere, and accepts one with either', () => {
    expect(tidyPlaceName('...')).toEqual({ ok: false, reason: 'unreadable' });
    expect(tidyPlaceName('!!! ???')).toEqual({ ok: false, reason: 'unreadable' });
    expect(tidyPlaceName('🙂')).toEqual({ ok: false, reason: 'unreadable' });
    expect(tidyPlaceName('1770')).toEqual({ ok: true, value: '1770' }); // a real town in Queensland
    expect(tidyPlaceName('Y')).toEqual({ ok: true, value: 'Y' });
  });
});

describe('the policy is enforced INSIDE the store, not at the form', () => {
  it('addVisit tidies what it stores, so a caller that skipped the check cannot write raw text', () => {
    addVisit({ city: '  New    York ', country: ' Ünited  States ' });
    expect(getVisited()).toEqual({ cities: ['New York'], countries: ['Ünited States'] });
  });

  it('addVisit silently drops a name the policy refuses (it is total and never throws)', () => {
    expect(() => addVisit({ city: 'x'.repeat(500), country: '...' })).not.toThrow();
    expect(getVisited()).toEqual({ cities: [], countries: [] });
  });

  it('the collapsed fold is what dedupes, so double spaces are not a second city', () => {
    addVisit({ city: 'New York' });
    addVisit({ city: 'new    york' });
    addVisit({ city: ' NEW YORK ' });
    expect(getVisited().cities).toEqual(['New York']);
  });

  it("foldPlaceName is the store's own comparison key, exported so a UI cannot invent a second one", () => {
    expect(foldPlaceName(' KATHMANDU ')).toBe('kathmandu');
    expect(foldPlaceName('New    York')).toBe('new york');
    expect(foldPlaceName('new york')).toBe(foldPlaceName(' NEW  YORK '));
    addVisit({ city: 'New York' });
    const recorded = new Set(getVisited().cities.map(foldPlaceName));
    expect(recorded.has(foldPlaceName('new  york'))).toBe(true);
  });
});

describe('removeVisit — someone will mistype, and the record is for life', () => {
  it('removes a city and a country, and returns the resulting set', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    addVisit({ city: 'Tokyo', country: 'Japan' });
    expect(removeVisit({ city: 'Tokyo', country: 'Japan' })).toEqual({
      cities: ['Kathmandu'],
      countries: ['Nepal'],
    });
    expect(getVisited()).toEqual({ cities: ['Kathmandu'], countries: ['Nepal'] });
  });

  it('matches under the SAME fold rule as an add — case, padding and double spaces included', () => {
    addVisit({ city: 'New York' });
    removeVisit({ city: '  new    YORK ' });
    expect(getVisited().cities).toEqual([]);
  });

  it('either half may be omitted, exactly like addVisit', () => {
    addVisit({ city: 'Pokhara', country: 'Nepal' });
    removeVisit({ city: 'Pokhara' });
    expect(getVisited()).toEqual({ cities: [], countries: ['Nepal'] });
    removeVisit({ country: 'Nepal' });
    expect(getVisited()).toEqual({ cities: [], countries: [] });
  });

  it('preserves INSERTION ORDER of everything it keeps', () => {
    for (const city of ['Kathmandu', 'Pokhara', 'Tokyo', 'Kyoto', 'Osaka']) addVisit({ city });
    removeVisit({ city: 'Tokyo' });
    expect(getVisited().cities).toEqual(['Kathmandu', 'Pokhara', 'Kyoto', 'Osaka']);
    // ...and a re-add lands at the END, because the set is a first-visit log, not a sorted list.
    addVisit({ city: 'Tokyo' });
    expect(getVisited().cities).toEqual(['Kathmandu', 'Pokhara', 'Kyoto', 'Osaka', 'Tokyo']);
  });

  it('removing something that was never there is a harmless no-op', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    expect(removeVisit({ city: 'Lisbon', country: 'Portugal' })).toEqual({
      cities: ['Kathmandu'],
      countries: ['Nepal'],
    });
    expect(removeVisit({})).toEqual({ cities: ['Kathmandu'], countries: ['Nepal'] });
    expect(removeVisit({ city: '   ' })).toEqual({ cities: ['Kathmandu'], countries: ['Nepal'] });
  });

  it('the removal reaches DISK, not just the returned object', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    removeVisit({ city: 'Kathmandu' });
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual({
      cities: [],
      countries: ['Nepal'],
    });
  });

  it('a removed place stops answering the membership tests', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    removeVisit({ city: 'Kathmandu', country: 'Nepal' });
    expect(hasVisitedCity('Kathmandu')).toBe(false);
    expect(hasVisitedCountry('Nepal')).toBe(false);
  });

  it('SSR-safe: with no window it neither throws nor pretends to have removed anything', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => removeVisit({ city: 'Tokyo' })).not.toThrow();
      expect(removeVisit({ city: 'Tokyo' })).toEqual({ cities: [], countries: [] });
    } finally {
      globalThis.window = saved;
    }
  });
});

describe('removeVisit — a deleted city leaves no shadow record behind (D-320, key 34)', () => {
  it('takes the removed city\'s GPS confirmation with it, and keeps checkedOn', () => {
    markVisitCheck('2026-12-12');
    confirmVisit({ city: 'Kathmandu', country: 'Nepal' }, '2026-12-12T09:00:00.000Z');
    confirmVisit({ city: 'Tokyo', country: 'Japan' }, '2026-12-20T09:00:00.000Z');
    expect(getVisitConfirmations().confirmed.map((c) => c.city)).toEqual(['Kathmandu', 'Tokyo']);

    removeVisit({ city: 'Kathmandu' });

    const after = getVisitConfirmations();
    expect(after.confirmed.map((c) => c.city)).toEqual(['Tokyo']);
    // The check still RAN that day — that fact is not the user's to edit, and rewriting it would
    // only buy them an extra permission prompt.
    expect(after.checkedOn).toBe('2026-12-12');
  });

  it('removing a COUNTRY does not touch confirmations — the country there is a day label', () => {
    confirmVisit({ city: 'Tokyo', country: 'Japan' }, '2026-12-20T09:00:00.000Z');
    removeVisit({ country: 'Japan' });
    expect(getVisited().countries).toEqual([]);
    expect(getVisitConfirmations().confirmed.map((c) => c.city)).toEqual(['Tokyo']);
  });

  it('leaves key 34 untouched when nothing matched', () => {
    confirmVisit({ city: 'Tokyo', country: 'Japan' }, '2026-12-20T09:00:00.000Z');
    const before = window.localStorage.getItem(STORAGE_KEYS.visitConfirmations);
    removeVisit({ city: 'Lisbon' });
    expect(window.localStorage.getItem(STORAGE_KEYS.visitConfirmations)).toBe(before);
  });
});
