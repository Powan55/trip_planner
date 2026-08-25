import { describe, it, expect } from 'vitest';
import { NAV_ITEMS } from '../nav-items';
import { GROUPS } from '@/app/more/more-list';

// Regression guard for #211: a companion route (primary === false) absent from
// GROUPS is invisible on mobile — /more/ is the ONLY mobile path to it, even
// though it still shows up in the desktop dropdown and command palette (both of
// which read NAV_ITEMS directly, not GROUPS). Bit /passport and /profile before.
//
// Deliberately uses NAV_ITEMS, not navItemsForActiveTrip(): defaultTripOnly
// companions (Flights, Safety) must stay covered here even though they drop out
// of a custom trip's runtime catalog. Guides is primary (no `primary: false`), so
// it is correctly excluded from the comparison set.

describe('GROUPS covers every NAV_ITEMS companion (#211)', () => {
  const companions = NAV_ITEMS.filter((i) => i.primary === false);
  const allGroupHrefs = GROUPS.flatMap((g) => g.hrefs);

  it('every companion href appears in exactly one GROUPS entry', () => {
    for (const item of companions) {
      const count = allGroupHrefs.filter((href) => href === item.href).length;
      expect(count, `${item.label} (${item.href}) should appear exactly once in GROUPS`).toBe(1);
    }
  });

  it('GROUPS has no stray hrefs outside the companion set', () => {
    const companionHrefs = new Set(companions.map((i) => i.href));
    for (const href of allGroupHrefs) {
      expect(companionHrefs.has(href), `${href} in GROUPS is not a companion NAV_ITEM`).toBe(true);
    }
  });
});
