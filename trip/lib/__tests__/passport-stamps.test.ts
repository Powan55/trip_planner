// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS, TRIP_SCOPED_SLOTS, wipeAllTripData } from '@/core/storage/gateway';
import { addVisit } from '@/core/places/visited';
import { claimStamps, newlyStamped } from '@/core/places/passport';

/**
 * The passport stamp board (issue #5, gateway key 35). One question is under test and it is the
 * one the feature turns on: HOW DO YOU KNOW A COUNTRY IS NEWLY COUNTED, rather than one that was
 * already in the set when the page loaded?
 *
 * Three failure modes have their own case below, because each of them ships a page that looks
 * right in a screenshot and is wrong in use:
 *
 *  1. **The re-animation defect** — a stamp that unlocks again on every visit. Pinned by claiming
 *     twice and by claiming across a simulated reload.
 *  2. **The unlock storm** — a device that already holds a lifetime of countries firing all of
 *     them the first time the page is opened. Pinned by the absent-vs-empty rule: an absent record
 *     SEEDS and celebrates nothing.
 *  3. **The wiped record** — the visit set survives a trip wipe and a sign-out (D-314), so a
 *     stamp record that did not would re-unlock every country afterwards. Pinned against the REAL
 *     `wipeAllTripData()`, never an imitation of it.
 */

const KEY = 'tripPlannerPassportStamps';
const VISITS_KEY = 'tripPlannerLifetimeVisits';

describe('newlyStamped — the predicate, pure', () => {
  it('an ABSENT record seeds: history is not an unlock', () => {
    // The device that has been to twelve places and is opening the passport for the first time.
    expect(newlyStamped(['Nepal', 'Japan', 'USA'], null)).toEqual([]);
  });

  it('an EMPTY record is not the same as an absent one — everything in it is new', () => {
    expect(newlyStamped(['Nepal', 'Japan'], [])).toEqual(['Nepal', 'Japan']);
  });

  it('returns only the ungreeted countries, in the visit set order', () => {
    expect(newlyStamped(['Nepal', 'Japan', 'USA'], ['Nepal'])).toEqual(['Japan', 'USA']);
    expect(newlyStamped(['Nepal', 'Japan', 'USA'], ['USA', 'Nepal'])).toEqual(['Japan']);
  });

  it('nothing is new when the record already covers the set', () => {
    expect(newlyStamped(['Nepal', 'Japan'], ['Nepal', 'Japan'])).toEqual([]);
    // A record holding a country the set no longer names is inert, never an error.
    expect(newlyStamped(['Nepal'], ['Nepal', 'Japan', 'Atlantis'])).toEqual([]);
  });

  it('an empty visit set has nothing new whatever the record says', () => {
    expect(newlyStamped([], null)).toEqual([]);
    expect(newlyStamped([], [])).toEqual([]);
    expect(newlyStamped([], ['Nepal'])).toEqual([]);
  });
});

describe('claimStamps — reading the board consumes the unlock', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('the first view of a device that has already been places seeds and celebrates nothing', () => {
    addVisit({ city: 'Kathmandu', country: 'Nepal' });
    addVisit({ city: 'Tokyo', country: 'Japan' });

    expect(claimStamps()).toEqual({ countries: ['Nepal', 'Japan'], fresh: [] });
    // Seeded on disk, under this key, as the display strings the visit set holds.
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toEqual(['Nepal', 'Japan']);
  });

  it('a country counted AFTER that view is the one that stamps', () => {
    addVisit({ country: 'Nepal' });
    claimStamps(); // the seeding view

    addVisit({ country: 'Japan' }); // e.g. the trip day arriving, or the profile screen

    expect(claimStamps()).toEqual({ countries: ['Nepal', 'Japan'], fresh: ['Japan'] });
  });

  it('THE RE-ANIMATION DEFECT: the very next view has nothing fresh', () => {
    addVisit({ country: 'Nepal' });
    claimStamps();
    addVisit({ country: 'Japan' });
    expect(claimStamps().fresh).toEqual(['Japan']);

    expect(claimStamps().fresh).toEqual([]);
    expect(claimStamps().fresh).toEqual([]);
  });

  it('...and it survives a RELOAD, because the record is on disk and not in memory', () => {
    addVisit({ country: 'Nepal' });
    claimStamps();
    addVisit({ country: 'Japan' });
    expect(claimStamps().fresh).toEqual(['Japan']);

    // A reload keeps localStorage and drops everything else; sessionStorage would survive too, so
    // clear only what a new browser SESSION would drop and assert the answer is unchanged.
    sessionStorage.clear();
    expect(claimStamps().fresh).toEqual([]);
  });

  it('a brand-new device with nothing recorded is an empty board, not a broken one', () => {
    expect(claimStamps()).toEqual({ countries: [], fresh: [] });
    // ...and the first country it ever counts is still an unlock, because the seed ran.
    addVisit({ country: 'Nepal' });
    expect(claimStamps()).toEqual({ countries: ['Nepal'], fresh: ['Nepal'] });
  });

  it('several countries added between two views are all fresh, in visit order', () => {
    claimStamps();
    addVisit({ country: 'Nepal' });
    addVisit({ country: 'Japan' });
    addVisit({ country: 'USA' });
    expect(claimStamps().fresh).toEqual(['Nepal', 'Japan', 'USA']);
  });

  it('a corrupt or wrong-shaped record SEEDS rather than throwing or celebrating', () => {
    addVisit({ country: 'Nepal' });
    for (const corrupt of ['{not json', '"a string"', '{"countries":["Nepal"]}', '7']) {
      window.localStorage.setItem(KEY, corrupt);
      expect(claimStamps().fresh, corrupt).toEqual([]);
    }
    // A non-string entry inside a real array is dropped, and the rest of the record still counts.
    window.localStorage.setItem(KEY, JSON.stringify(['Nepal', 3, null]));
    addVisit({ country: 'Japan' });
    expect(claimStamps().fresh).toEqual(['Japan']);
  });

  it('SSR-safe: with no window it reads empty, writes inertly and never throws', () => {
    const saved = globalThis.window;
    // @ts-expect-error — intentionally remove window for the SSR path.
    delete globalThis.window;
    try {
      expect(() => claimStamps()).not.toThrow();
      expect(claimStamps()).toEqual({ countries: [], fresh: [] });
    } finally {
      globalThis.window = saved;
    }
  });

  it('unreadable storage degrades to NEVER celebrating, never to celebrating every view', () => {
    // Private browsing / disabled storage. The safe direction is the opposite of the entrance
    // ledger's: a missed stamp is a cosmetic loss, a burst on every single page view is not.
    const real = window.localStorage;
    const throwing = {
      getItem() {
        throw new Error('storage disabled');
      },
      setItem() {
        throw new Error('storage disabled');
      },
      removeItem() {
        throw new Error('storage disabled');
      },
      clear() {},
      key() {
        return null;
      },
      length: 0,
    } as unknown as Storage;
    Object.defineProperty(window, 'localStorage', { configurable: true, value: throwing });
    try {
      expect(claimStamps()).toEqual({ countries: [], fresh: [] });
      expect(claimStamps()).toEqual({ countries: [], fresh: [] });
    } finally {
      Object.defineProperty(window, 'localStorage', { configurable: true, value: real });
    }
  });
});

describe('the stamp record is LIFETIME-scoped, like the visit set it reads (key 35)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('the key string is exactly tripPlannerPassportStamps and is unique in the registry', () => {
    expect(STORAGE_KEYS.passportStamps).toBe(KEY);
    const values = Object.values(STORAGE_KEYS) as string[];
    expect(new Set(values).size).toBe(values.length);
  });

  it('is NOT a trip-scoped slot, and carries neither the trip: nor the pack prefix', () => {
    expect((TRIP_SCOPED_SLOTS as readonly string[]).includes('passportStamps')).toBe(false);
    for (const slot of TRIP_SCOPED_SLOTS) expect(STORAGE_KEYS[slot]).not.toBe(KEY);
    expect(STORAGE_KEYS.passportStamps.startsWith('trip:')).toBe(false);
    expect(STORAGE_KEYS.passportStamps.startsWith('nepal_japan_')).toBe(false);
  });

  it('survives the REAL wipeAllTripData(), so a trip teardown cannot re-unlock every country', () => {
    // The point of the pairing: key 32 outlives the wipe by design, so if key 35 did not, the
    // next passport view after a wipe would fire an unlock for every country at once.
    for (const slot of TRIP_SCOPED_SLOTS) window.localStorage.setItem(STORAGE_KEYS[slot], 'seeded');
    addVisit({ country: 'Nepal' });
    addVisit({ country: 'Japan' });
    expect(claimStamps().fresh).toEqual([]);

    wipeAllTripData();

    // The wipe really ran (this assertion is what stops the rest passing vacuously)...
    for (const slot of TRIP_SCOPED_SLOTS) {
      expect(window.localStorage.getItem(STORAGE_KEYS[slot])).toBeNull();
    }
    // ...and both lifetime records are still on disk, so the board is unchanged and silent.
    expect(window.localStorage.getItem(VISITS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    expect(claimStamps()).toEqual({ countries: ['Nepal', 'Japan'], fresh: [] });
  });
});
