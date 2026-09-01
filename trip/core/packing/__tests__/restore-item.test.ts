import { describe, it, expect } from 'vitest';

/**
 * `restoreItem` — the undo of `removeItem`. Pins that it puts the item back at its old index
 * with its category and packed state intact, and its three degrade-to-safe branches: an id
 * already present, an out-of-range index, and a non-array `items`.
 */

import { restoreItem, removeItem, sanitizeItems, type PackingItem } from '@/core/packing/model';

const CHECKED_LEG_ITEM: PackingItem = {
  id: 'nepal-down-jacket',
  label: 'Down jacket',
  category: 'nepal',
  checked: true,
};

describe('restoreItem', () => {
  it('puts the item back at its index, keeping category and checked', () => {
    const items = sanitizeItems(undefined).map((i) =>
      i.id === CHECKED_LEG_ITEM.id ? { ...i, checked: true } : i,
    );
    const index = items.findIndex((i) => i.id === CHECKED_LEG_ITEM.id);
    const removed = removeItem(items, CHECKED_LEG_ITEM.id);

    const next = restoreItem(removed, items[index], index);
    expect(next).toEqual(items);
    expect(next[index]).toEqual({ ...CHECKED_LEG_ITEM, label: items[index].label });
  });

  it('an id already present is a no-op (still a new array)', () => {
    const items = sanitizeItems(undefined);
    const next = restoreItem(items, items[3], 0);
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
  });

  it('an out-of-range or non-integer index appends', () => {
    const items = sanitizeItems(undefined).slice(0, 2);
    expect(restoreItem(items, CHECKED_LEG_ITEM, 99).at(-1)).toEqual(CHECKED_LEG_ITEM);
    expect(restoreItem(items, CHECKED_LEG_ITEM, -1).at(-1)).toEqual(CHECKED_LEG_ITEM);
    expect(restoreItem(items, CHECKED_LEG_ITEM, 1.5).at(-1)).toEqual(CHECKED_LEG_ITEM);
    expect(restoreItem(items, CHECKED_LEG_ITEM, Number.NaN).at(-1)).toEqual(CHECKED_LEG_ITEM);
  });

  it('a non-array items degrades to a single-item list', () => {
    expect(restoreItem(undefined as unknown as PackingItem[], CHECKED_LEG_ITEM, 0)).toEqual([
      CHECKED_LEG_ITEM,
    ]);
  });

  it('an unsalvageable item is a no-op', () => {
    const items = sanitizeItems(undefined).slice(0, 2);
    expect(restoreItem(items, { ...CHECKED_LEG_ITEM, label: '  ' }, 0)).toEqual(items);
  });
});
