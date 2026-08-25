import { describe, it, expect } from 'vitest';

/**
 * S206 — pure packing-checklist core (D-016/D-099). `core/packing/model.ts` is framework-free;
 * these tests pin the type guard (`isPackingCategory`), the built-in `DEFAULT_TEMPLATE` shape,
 * the sanitizer (`sanitizeItems`/`sanitizeItem` — total, id/label/category-required, dedupe by
 * id, "seed the template when absent/corrupt/empty"), and the pure transforms (`toggleItem`,
 * `packingProgress`).
 */

import {
  isPackingCategory,
  sanitizeItem,
  sanitizeItems,
  toggleItem,
  addItem,
  removeItem,
  packingProgress,
  DEFAULT_TEMPLATE,
  type PackingItem,
} from '@/core/packing/model';

describe('isPackingCategory', () => {
  it('accepts only the 3 canonical categories', () => {
    expect(isPackingCategory('nepal')).toBe(true);
    expect(isPackingCategory('japan')).toBe(true);
    expect(isPackingCategory('universal')).toBe(true);
    expect(isPackingCategory('bogus')).toBe(false);
    expect(isPackingCategory('')).toBe(false);
    expect(isPackingCategory(null)).toBe(false);
    expect(isPackingCategory(undefined)).toBe(false);
    expect(isPackingCategory(3)).toBe(false);
  });
});

describe('DEFAULT_TEMPLATE', () => {
  it('has 28 items — 10 universal, 9 nepal, 9 japan — all unchecked, unique ids', () => {
    expect(DEFAULT_TEMPLATE).toHaveLength(28);
    expect(DEFAULT_TEMPLATE.every((i) => i.checked === false)).toBe(true);
    const ids = new Set(DEFAULT_TEMPLATE.map((i) => i.id));
    expect(ids.size).toBe(DEFAULT_TEMPLATE.length);
    expect(DEFAULT_TEMPLATE.filter((i) => i.category === 'universal')).toHaveLength(10);
    expect(DEFAULT_TEMPLATE.filter((i) => i.category === 'nepal')).toHaveLength(9);
    expect(DEFAULT_TEMPLATE.filter((i) => i.category === 'japan')).toHaveLength(9);
  });
});

describe('sanitizeItem', () => {
  it('accepts a valid item verbatim (checked coerced to strict boolean)', () => {
    expect(sanitizeItem({ id: 'x', label: 'Boots', category: 'nepal', checked: true })).toEqual({
      id: 'x',
      label: 'Boots',
      category: 'nepal',
      checked: true,
    });
    expect(sanitizeItem({ id: 'x', label: 'Boots', category: 'nepal', checked: 'yes' })).toEqual({
      id: 'x',
      label: 'Boots',
      category: 'nepal',
      checked: false,
    });
  });

  it('rejects missing/invalid id, label, or category', () => {
    expect(sanitizeItem(null)).toBeNull();
    expect(sanitizeItem('nope')).toBeNull();
    expect(sanitizeItem({ id: '', label: 'x', category: 'nepal' })).toBeNull();
    expect(sanitizeItem({ id: 'x', label: '', category: 'nepal' })).toBeNull();
    expect(sanitizeItem({ id: 'x', label: 'x', category: 'atlantis' })).toBeNull();
    expect(sanitizeItem({ id: 'x', label: 'x' })).toBeNull();
  });
});

describe('sanitizeItems', () => {
  it('an absent/non-array value seeds the built-in template', () => {
    expect(sanitizeItems(undefined)).toEqual(DEFAULT_TEMPLATE);
    expect(sanitizeItems(null)).toEqual(DEFAULT_TEMPLATE);
    expect(sanitizeItems({ not: 'an array' })).toEqual(DEFAULT_TEMPLATE);
  });

  it('an array that sanitizes down to zero valid items also seeds the template (no empty state)', () => {
    expect(sanitizeItems([{ bad: true }, null, 42])).toEqual(DEFAULT_TEMPLATE);
    expect(sanitizeItems([])).toEqual(DEFAULT_TEMPLATE);
  });

  it('drops malformed entries but keeps valid ones', () => {
    const result = sanitizeItems([
      { id: 'a', label: 'Passport', category: 'universal', checked: true },
      { id: 'bad', label: '', category: 'universal' },
    ]);
    expect(result).toEqual([{ id: 'a', label: 'Passport', category: 'universal', checked: true }]);
  });

  it('dedupes by id — last write wins', () => {
    const result = sanitizeItems([
      { id: 'a', label: 'First', category: 'nepal', checked: false },
      { id: 'a', label: 'Second', category: 'nepal', checked: true },
    ]);
    expect(result).toEqual([{ id: 'a', label: 'Second', category: 'nepal', checked: true }]);
  });

  it('a custom fallback is honored when the input is absent/empty', () => {
    const custom: PackingItem[] = [{ id: 'z', label: 'Z', category: 'universal', checked: false }];
    expect(sanitizeItems(undefined, custom)).toEqual(custom);
    expect(sanitizeItems([], custom)).toEqual(custom);
  });
});

describe('toggleItem', () => {
  it('flips checked for the matching id only, returning a NEW array', () => {
    const items = sanitizeItems(undefined).slice(0, 2);
    const next = toggleItem(items, items[0].id);
    expect(next).not.toBe(items);
    expect(next[0].checked).toBe(true);
    expect(next[1].checked).toBe(items[1].checked);
    expect(items[0].checked).toBe(false); // original untouched (pure)
  });

  it('toggling twice returns to the original checked value', () => {
    const items = sanitizeItems(undefined).slice(0, 1);
    const once = toggleItem(items, items[0].id);
    const twice = toggleItem(once, items[0].id);
    expect(twice[0].checked).toBe(items[0].checked);
  });

  it('a non-matching id is a no-op (values unchanged, still a new array)', () => {
    const items = sanitizeItems(undefined).slice(0, 2);
    const next = toggleItem(items, 'does-not-exist');
    expect(next).toEqual(items);
  });
});

describe('addItem (#227)', () => {
  it('appends a new item categorized universal, unchecked, with the caller-injected id', () => {
    const items = sanitizeItems(undefined);
    const next = addItem(items, 'Travel pillow', 'custom-1');
    expect(next).not.toBe(items);
    expect(next).toHaveLength(items.length + 1);
    expect(next[next.length - 1]).toEqual({ id: 'custom-1', label: 'Travel pillow', category: 'universal', checked: false });
    expect(items).toHaveLength(28); // original untouched (pure)
  });

  it('trims the label', () => {
    const next = addItem([], '  Umbrella  ', 'custom-2');
    expect(next[0].label).toBe('Umbrella');
  });

  it('a blank/whitespace-only label is a no-op (still a new array)', () => {
    const items = sanitizeItems(undefined).slice(0, 1);
    expect(addItem(items, '', 'custom-3')).toEqual(items);
    expect(addItem(items, '   ', 'custom-4')).toEqual(items);
  });

  it('a missing/blank id is a no-op', () => {
    const items = sanitizeItems(undefined).slice(0, 1);
    expect(addItem(items, 'Something', '')).toEqual(items);
  });
});

describe('removeItem (#227)', () => {
  it('removes a FIXED-TEMPLATE item by id', () => {
    const items = sanitizeItems(undefined);
    const targetId = items[0].id;
    const next = removeItem(items, targetId);
    expect(next).toHaveLength(items.length - 1);
    expect(next.find((i) => i.id === targetId)).toBeUndefined();
  });

  it('removes a CUSTOM item by id', () => {
    const items = addItem(sanitizeItems(undefined), 'Neck pillow', 'custom-5');
    const next = removeItem(items, 'custom-5');
    expect(next).toHaveLength(items.length - 1);
    expect(next.find((i) => i.id === 'custom-5')).toBeUndefined();
  });

  it('a non-matching id is a no-op (values unchanged, still a new array)', () => {
    const items = sanitizeItems(undefined).slice(0, 2);
    const next = removeItem(items, 'does-not-exist');
    expect(next).toEqual(items);
    expect(next).not.toBe(items);
  });
});

describe('packingProgress', () => {
  it('counts checked vs total', () => {
    const items: PackingItem[] = [
      { id: 'a', label: 'A', category: 'universal', checked: true },
      { id: 'b', label: 'B', category: 'universal', checked: false },
      { id: 'c', label: 'C', category: 'nepal', checked: true },
    ];
    expect(packingProgress(items)).toEqual({ checked: 2, total: 3 });
  });

  it('the full built-in template starts at 0/28', () => {
    expect(packingProgress(DEFAULT_TEMPLATE)).toEqual({ checked: 0, total: 28 });
  });
});
