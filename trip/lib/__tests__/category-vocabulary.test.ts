import { describe, it, expect } from 'vitest';

// Issues #164 / #168 — the ten-category vocabulary had seven runtime copies and the icon map had
// three. Both now come from one place, and this is the check that keeps it that way.
//
// The type↔array tie itself is COMPILE-time (`_Missing` in lib/itinerary-category.ts): types are
// erased, so no runtime assertion can prove `ALL_CATEGORIES` covers `ItineraryCategory` — a test
// that compared the array to a hardcoded copy of itself would just be an eighth copy. What runs
// here is the part that survives erasure: every keyed-by-category map covers the array exactly,
// and the two lists that still hold their own literals (core/content/schema.ts's zod enum and
// core/budget/model.ts's BUDGET_CATEGORIES, both owned elsewhere) still agree with it in members
// AND order — order is what the pickers render.

import { ALL_CATEGORIES } from '@/lib/itinerary-category';
import { CATEGORY_COLORS } from '@/lib/trip-data';
import { CATEGORY_ICON_MAP } from '@/components/category-icon';
import { itineraryCategories } from '@/core/content/schema';
import { BUDGET_CATEGORIES } from '@/core/budget/model';

describe('ALL_CATEGORIES', () => {
  it('is the ten categories, no duplicates', () => {
    expect(ALL_CATEGORIES).toHaveLength(10);
    expect(new Set(ALL_CATEGORIES).size).toBe(ALL_CATEGORIES.length);
  });

  it('has an icon for every category, and no icon for anything else', () => {
    expect(Object.keys(CATEGORY_ICON_MAP).sort()).toEqual([...ALL_CATEGORIES].sort());
    for (const cat of ALL_CATEGORIES) {
      expect(CATEGORY_ICON_MAP[cat], `no icon for "${cat}"`).toBeTruthy();
    }
  });

  it('has colours for every category, and no colours for anything else', () => {
    expect(Object.keys(CATEGORY_COLORS).sort()).toEqual([...ALL_CATEGORIES].sort());
  });
});

describe('the lists that still carry their own literals', () => {
  it('core/content/schema.ts itineraryCategories matches, in order', () => {
    expect(itineraryCategories).toEqual(ALL_CATEGORIES);
  });

  it('core/budget/model.ts BUDGET_CATEGORIES matches, in order', () => {
    expect(BUDGET_CATEGORIES).toEqual(ALL_CATEGORIES);
  });
});
