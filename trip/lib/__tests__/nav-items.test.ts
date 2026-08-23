import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  isRouteActive,
  navItemsForActiveTrip,
  primaryItemsForActiveTrip,
} from '../nav-items';

// isRouteActive drives the active state of every primary-nav item (navbar + mobile
// tab bar since FU-4). `normalizePath` is module-private, so it is exercised only
// through isRouteActive here — a deliberate fence.

describe('isRouteActive', () => {
  it('Home is exact-match only', () => {
    expect(isRouteActive('/', '/')).toBe(true);
    expect(isRouteActive('/nepal/', '/')).toBe(false);
    expect(isRouteActive('/plan/', '/')).toBe(false);
  });

  it('matches an exact sub-route', () => {
    expect(isRouteActive('/nepal/', '/nepal/')).toBe(true);
  });

  it('matches a nested path below the route', () => {
    expect(isRouteActive('/nepal/anything', '/nepal/')).toBe(true);
  });

  it('does not false-match on a route-name prefix', () => {
    expect(isRouteActive('/nepalese', '/nepal/')).toBe(false);
  });

  it('is trailing-slash-agnostic on both pathname and href', () => {
    expect(isRouteActive('/nepal', '/nepal/')).toBe(true);
    expect(isRouteActive('', '/')).toBe(true);
    expect(isRouteActive(null, '/')).toBe(true);
  });

  it('each NAV_ITEMS route is active on its own href and not on a sibling route', () => {
    for (const item of NAV_ITEMS) {
      expect(isRouteActive(item.href, item.href)).toBe(true);
      for (const sibling of NAV_ITEMS) {
        if (sibling.href === item.href) continue;
        expect(isRouteActive(item.href, sibling.href)).toBe(false);
      }
    }
  });
});

describe('NAV_ITEMS (S320, D-231 — 5-tab IA delta)', () => {
  it('has exactly 15 items in S320 order + the issue #4 Profile and issue #5 Passport companions', () => {
    expect(NAV_ITEMS.length).toBe(15);
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      'Today',
      'Plan',
      'Map',
      'Guides',
      'Flights',
      'Journal',
      'Safety',
      'Recap',
      'Packing',
      'Documents',
      'Shared Links',
      'Trips',
      'Profile',
      'Passport',
      'Settings',
    ]);
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      '/',
      '/plan/',
      '/map/',
      '/guides/',
      '/flights/',
      '/journal/',
      '/safety/',
      '/recap/',
      '/packing/',
      '/checklist/',
      '/share/',
      '/trips/',
      '/profile/',
      '/passport/',
      '/settings/',
    ]);
  });

  it('every item has a truthy icon', () => {
    for (const item of NAV_ITEMS) {
      expect(item.icon).toBeTruthy();
    }
  });
});

describe('PRIMARY_NAV_ITEMS (S320, D-231 — the 4 shared primaries)', () => {
  it('has exactly Today/Plan/Map/Guides, excluding the companions', () => {
    expect(PRIMARY_NAV_ITEMS.length).toBe(4);
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      'Today',
      'Plan',
      'Map',
      'Guides',
    ]);
    const primaryLabels = new Set(PRIMARY_NAV_ITEMS.map((item) => item.label));
    for (const companion of ['Flights', 'Journal', 'Safety', 'Recap', 'Documents', 'Shared Links']) {
      expect(primaryLabels.has(companion)).toBe(false);
    }
  });

  it('is a subset of NAV_ITEMS', () => {
    for (const item of PRIMARY_NAV_ITEMS) {
      expect(NAV_ITEMS).toContain(item);
    }
  });
});

// S252 (Plan D10/D-071) — the active-trip-aware filters. `isDefaultTrip` is mocked per-test
// (via vi.mock + a mutable flag) rather than driving it through real localStorage, since the
// pure filters only care about its boolean return.
vi.mock('@/core/trips', () => ({ isDefaultTrip: () => mockIsDefault }));
let mockIsDefault = true;

describe('navItemsForActiveTrip / primaryItemsForActiveTrip (S252)', () => {
  beforeEach(() => {
    mockIsDefault = true;
  });

  it('on the default trip, both filters are byte-identical to NAV_ITEMS/PRIMARY_NAV_ITEMS', () => {
    expect(navItemsForActiveTrip()).toEqual(NAV_ITEMS);
    expect(primaryItemsForActiveTrip()).toEqual(PRIMARY_NAV_ITEMS);
  });

  it('on a custom trip, navItemsForActiveTrip drops the defaultTripOnly Guides/Flights/Safety and nothing else', () => {
    mockIsDefault = false;
    const labels = navItemsForActiveTrip().map((i) => i.label);
    expect(labels).toEqual([
      'Today',
      'Plan',
      'Map',
      'Journal',
      'Recap',
      'Packing',
      'Documents',
      'Shared Links',
      'Trips',
      'Profile',
      'Passport',
      'Settings',
    ]);
  });

  // CONTENT-2 — /safety/ serves Nepal Police 100 / Japan 110 / Kathmandu embassy switchboards and
  // a Nepali/Japanese phrasebook, presented as the ACTIVE trip's safety kit. It was the one N*J
  // content surface the custom-trip sweep missed, so a custom trip's More page still offered it
  // and it rendered another country's emergency numbers un-gated. The nav flag is half the fix;
  // `app/safety/page.tsx` carries the matching DefaultTripOnly wrapper for a typed URL.
  it('Safety is defaultTripOnly, so a custom trip never lists it', () => {
    expect(NAV_ITEMS.find((i) => i.href === '/safety/')?.defaultTripOnly).toBe(true);
    mockIsDefault = false;
    expect(navItemsForActiveTrip().some((i) => i.href === '/safety/')).toBe(false);
    mockIsDefault = true;
    expect(navItemsForActiveTrip().some((i) => i.href === '/safety/')).toBe(true);
  });

  it('on a custom trip, primaryItemsForActiveTrip is exactly 4: Today/Plan/Map/Journal (D-231)', () => {
    mockIsDefault = false;
    const labels = primaryItemsForActiveTrip().map((i) => i.label);
    expect(labels).toEqual(['Today', 'Plan', 'Map', 'Journal']);
    expect(labels.length).toBe(4);
  });
});
