// @vitest-environment jsdom
//
// CONTENT-5 (D-307 class) — `ROUTE_REDIRECTS[hash]` was a bare object index on an object
// literal, so an `Object.prototype` key name returned a truthy NON-STRING: `#constructor` and
// `#toString` gave functions, `#__proto__` gave `Object.prototype`. The truthiness guard passed,
// `router.replace(target)` was called with a non-string, and `target.indexOf('#')` then threw
// `TypeError: target.indexOf is not a function` inside Home's effect — dropping the WHOLE Home
// route to app/error.tsx with no in-page recovery. `LegacyHashRedirect` is mounted eagerly on
// Home, so opening `https://powan55.github.io/trip_planner/#constructor` was enough.
//
// This is the read-site own-key idiom D-307 mandates, so the check is the same shape as the five
// swept siblings: every prototype key name resolves to `undefined`, and the real table is
// unchanged.

import { describe, it, expect } from 'vitest';
import { legacyHashTarget } from '@/components/legacy-hash-redirect';

const PROTOTYPE_KEYS = [
  'constructor',
  '__proto__',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
];

describe('legacyHashTarget — Object.prototype key names (D-307)', () => {
  for (const key of PROTOTYPE_KEYS) {
    it(`#${key} resolves to undefined, not a prototype member`, () => {
      const target = legacyHashTarget(key);
      expect(target).toBeUndefined();
      // The two things the caller does with a truthy target, neither of which may throw here.
      expect(typeof target === 'string' || target === undefined).toBe(true);
    });
  }

  it('a prototype-key hash never reaches the string ops that threw in Home', () => {
    const target = legacyHashTarget('constructor');
    // Before the fix this line was `TypeError: target.indexOf is not a function`.
    expect(() => (target ? target.indexOf('#') : -1)).not.toThrow();
  });
});

describe('legacyHashTarget — the real redirect table still resolves', () => {
  it('maps the v1 anchors to their v2 routes', () => {
    expect(legacyHashTarget('itinerary')).toBe('/plan/');
    expect(legacyHashTarget('nepal')).toBe('/nepal/');
    expect(legacyHashTarget('japan')).toBe('/japan/');
    expect(legacyHashTarget('map')).toBe('/map/');
    expect(legacyHashTarget('flights')).toBe('/flights/');
    expect(legacyHashTarget('photography')).toBe('/nepal/#photography');
    expect(legacyHashTarget('nightlife')).toBe('/nepal/#nightlife');
  });

  it('a local anchor or an unknown hash is undefined (scroll / no-op paths)', () => {
    expect(legacyHashTarget('hero')).toBeUndefined();
    expect(legacyHashTarget('dashboard')).toBeUndefined();
    expect(legacyHashTarget('inspiration')).toBeUndefined();
    expect(legacyHashTarget('timeline')).toBeUndefined();
    expect(legacyHashTarget('not-a-real-hash')).toBeUndefined();
  });
});
