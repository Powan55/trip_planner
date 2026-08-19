import { describe, it, expect } from 'vitest';

/**
 * S217 — pure docs-checklist core (D-016/D-099). `core/docs/model.ts` is framework-free; these
 * tests pin the type guard, the built-in `DEFAULT_TEMPLATE` shape, the sanitizer (total, id/label/
 * section-required, dedupe by id, seed-template-when-empty, sync-field passthrough), the pure
 * transforms (`toggleItem`/`setNote` incl. the optional injected stamper), and the `docsCompletion`
 * selector S219 consumes. Every function must be TOTAL — a bad input degrades, never throws.
 */

import {
  isDocSection,
  sanitizeItem,
  sanitizeItems,
  toggleItem,
  setNote,
  docsCompletion,
  DEFAULT_TEMPLATE,
  UNIVERSAL_TEMPLATE,
  type DocItem,
} from '@/core/docs/model';

describe('isDocSection', () => {
  it('accepts only the 2 canonical sections', () => {
    expect(isDocSection('critical')).toBe(true);
    expect(isDocSection('dayzero')).toBe(true);
    expect(isDocSection('bogus')).toBe(false);
    expect(isDocSection('')).toBe(false);
    expect(isDocSection(null)).toBe(false);
    expect(isDocSection(undefined)).toBe(false);
    expect(isDocSection(3)).toBe(false);
  });
});

describe('DEFAULT_TEMPLATE', () => {
  it('has 18 items — 10 critical, 8 dayzero — all unchecked, unique ids, no sync fields', () => {
    expect(DEFAULT_TEMPLATE).toHaveLength(18);
    expect(DEFAULT_TEMPLATE.every((i) => i.checked === false)).toBe(true);
    const ids = new Set(DEFAULT_TEMPLATE.map((i) => i.id));
    expect(ids.size).toBe(DEFAULT_TEMPLATE.length);
    expect(DEFAULT_TEMPLATE.filter((i) => i.section === 'critical')).toHaveLength(10);
    expect(DEFAULT_TEMPLATE.filter((i) => i.section === 'dayzero')).toHaveLength(8);
    // The seed carries NO sync stamps / notes (D-038 byte-identity — a dormant slot is clean).
    for (const i of DEFAULT_TEMPLATE) {
      expect(i.rev).toBeUndefined();
      expect(i.hlc).toBeUndefined();
      expect(i.note).toBeUndefined();
    }
  });
});

describe('UNIVERSAL_TEMPLATE (A-15/#102, D-355)', () => {
  it('is DEFAULT_TEMPLATE minus nepal-visa/japan-entry — 16 items, derived not hand-duplicated', () => {
    expect(UNIVERSAL_TEMPLATE).toHaveLength(16);
    const ids = UNIVERSAL_TEMPLATE.map((i) => i.id);
    expect(ids).not.toContain('nepal-visa');
    expect(ids).not.toContain('japan-entry');
    // Every remaining id/section/checked is byte-identical to DEFAULT_TEMPLATE — only the 4
    // labels below are allowed to differ.
    const overridden = new Set(['flight-tickets', 'cards-cash', 'passport-validity', 'chargers-adapters']);
    for (const item of UNIVERSAL_TEMPLATE) {
      const source = DEFAULT_TEMPLATE.find((d) => d.id === item.id)!;
      expect(source).toBeDefined();
      expect(item.section).toBe(source.section);
      expect(item.checked).toBe(source.checked);
      if (overridden.has(item.id)) expect(item.label).not.toBe(source.label);
      else expect(item.label).toBe(source.label);
    }
  });

  it('genericizes the 4 country/date-specific labels, dropping Nepal/Japan/hardcoded-year copy', () => {
    const byId = new Map(UNIVERSAL_TEMPLATE.map((i) => [i.id, i.label]));
    expect(byId.get('flight-tickets')).toBe('Flight e-tickets saved offline');
    expect(byId.get('cards-cash')).toBe('Payment cards + emergency cash');
    expect(byId.get('passport-validity')).toBe('Passport valid 6+ months beyond your return date');
    expect(byId.get('chargers-adapters')).toBe('Chargers, cables & power adapters');
    for (const label of byId.values()) {
      expect(label).not.toMatch(/Nepal|Japan|Kathmandu|2027/i);
    }
  });
});

describe('sanitizeItem', () => {
  it('accepts a valid item (checked coerced to strict boolean)', () => {
    expect(sanitizeItem({ id: 'x', label: 'Passport', section: 'critical', checked: true })).toEqual({
      id: 'x',
      label: 'Passport',
      section: 'critical',
      checked: true,
    });
    expect(sanitizeItem({ id: 'x', label: 'Passport', section: 'critical', checked: 'yes' })).toEqual({
      id: 'x',
      label: 'Passport',
      section: 'critical',
      checked: false,
    });
  });

  it('preserves an optional note + sync stamps when present with the right type', () => {
    const r = sanitizeItem({
      id: 'x',
      label: 'Visa',
      section: 'critical',
      checked: true,
      note: 'expires 2028',
      rev: 3,
      hlc: '000000000005000:000000:me',
      updatedBy: 'Powan',
    });
    expect(r).toEqual({
      id: 'x',
      label: 'Visa',
      section: 'critical',
      checked: true,
      note: 'expires 2028',
      rev: 3,
      hlc: '000000000005000:000000:me',
      updatedBy: 'Powan',
    });
  });

  it('drops a blank/whitespace note and wrong-typed sync fields', () => {
    const r = sanitizeItem({ id: 'x', label: 'Visa', section: 'critical', checked: false, note: '   ', rev: 'nope' });
    expect(r).toEqual({ id: 'x', label: 'Visa', section: 'critical', checked: false });
  });

  it('rejects missing/invalid id, label, or section', () => {
    expect(sanitizeItem(null)).toBeNull();
    expect(sanitizeItem('nope')).toBeNull();
    expect(sanitizeItem({ id: '', label: 'x', section: 'critical' })).toBeNull();
    expect(sanitizeItem({ id: 'x', label: '', section: 'critical' })).toBeNull();
    expect(sanitizeItem({ id: 'x', label: 'x', section: 'atlantis' })).toBeNull();
    expect(sanitizeItem({ id: 'x', label: 'x' })).toBeNull();
  });
});

describe('sanitizeItems', () => {
  it('an absent/non-array value seeds the built-in template', () => {
    expect(sanitizeItems(undefined)).toEqual(DEFAULT_TEMPLATE);
    expect(sanitizeItems(null)).toEqual(DEFAULT_TEMPLATE);
    expect(sanitizeItems({ not: 'an array' })).toEqual(DEFAULT_TEMPLATE);
  });

  it('an array that sanitizes to zero valid items also seeds the template (no empty state)', () => {
    expect(sanitizeItems([{ bad: true }, null, 42])).toEqual(DEFAULT_TEMPLATE);
    expect(sanitizeItems([])).toEqual(DEFAULT_TEMPLATE);
  });

  it('drops malformed entries but keeps valid ones, deduping by id (last write wins)', () => {
    const result = sanitizeItems([
      { id: 'a', label: 'First', section: 'critical', checked: false },
      { id: 'bad', label: '', section: 'critical' },
      { id: 'a', label: 'Second', section: 'critical', checked: true },
    ]);
    expect(result).toEqual([{ id: 'a', label: 'Second', section: 'critical', checked: true }]);
  });
});

describe('toggleItem', () => {
  it('flips checked for the matching id only, returning a NEW array (pure)', () => {
    const items = [...DEFAULT_TEMPLATE].slice(0, 2);
    const next = toggleItem(items, items[0].id);
    expect(next).not.toBe(items);
    expect(next[0].checked).toBe(true);
    expect(next[1].checked).toBe(items[1].checked);
    expect(items[0].checked).toBe(false); // original untouched
  });

  it('writes NO sync field with no stamper (dormant byte-identity, D-038)', () => {
    const next = toggleItem([...DEFAULT_TEMPLATE].slice(0, 1), DEFAULT_TEMPLATE[0].id);
    expect(next[0].rev).toBeUndefined();
    expect(next[0].hlc).toBeUndefined();
    expect(Object.keys(next[0]).sort()).toEqual(['checked', 'id', 'label', 'section']);
  });

  it('applies the injected stamper under sync (rev/hlc advance)', () => {
    const stamp = (i: DocItem): DocItem => ({ ...i, rev: (i.rev ?? 0) + 1, hlc: 'stamped' });
    const next = toggleItem([...DEFAULT_TEMPLATE].slice(0, 1), DEFAULT_TEMPLATE[0].id, stamp);
    expect(next[0]).toMatchObject({ checked: true, rev: 1, hlc: 'stamped' });
  });

  it('a non-matching id is a no-op (values unchanged, still a new array)', () => {
    const items = [...DEFAULT_TEMPLATE].slice(0, 2);
    expect(toggleItem(items, 'does-not-exist')).toEqual(items);
  });

  it('never throws on a non-array input', () => {
    expect(toggleItem(undefined as unknown as DocItem[], 'x')).toEqual([]);
  });
});

describe('setNote', () => {
  it('sets a trimmed note, and clears it (removes the field) on empty/whitespace', () => {
    const base = [...DEFAULT_TEMPLATE].slice(0, 1);
    const withNote = setNote(base, base[0].id, '  policy #42  ');
    expect(withNote[0].note).toBe('policy #42');
    const cleared = setNote(withNote, base[0].id, '   ');
    expect('note' in cleared[0]).toBe(false);
  });

  it('a non-matching id is a no-op', () => {
    const base = [...DEFAULT_TEMPLATE].slice(0, 1);
    expect(setNote(base, 'nope', 'x')).toEqual(base);
  });
});

describe('docsCompletion', () => {
  it('counts done/total overall and per-section', () => {
    const items: DocItem[] = [
      { id: 'a', section: 'critical', label: 'A', checked: true },
      { id: 'b', section: 'critical', label: 'B', checked: false },
      { id: 'c', section: 'dayzero', label: 'C', checked: true },
    ];
    expect(docsCompletion(items)).toEqual({
      done: 2,
      total: 3,
      perSection: { critical: { done: 1, total: 2 }, dayzero: { done: 1, total: 1 } },
    });
  });

  it('the full built-in template starts at 0/18', () => {
    const c = docsCompletion(DEFAULT_TEMPLATE);
    expect(c).toEqual({
      done: 0,
      total: 18,
      perSection: { critical: { done: 0, total: 10 }, dayzero: { done: 0, total: 8 } },
    });
  });

  it('excludes a defensive tombstone and never throws on junk', () => {
    const items: DocItem[] = [
      { id: 'a', section: 'critical', label: 'A', checked: true },
      { id: 'b', section: 'critical', label: 'B', checked: true, deleted: true },
    ];
    expect(docsCompletion(items).total).toBe(1);
    expect(docsCompletion(undefined as unknown as DocItem[])).toEqual({
      done: 0,
      total: 0,
      perSection: { critical: { done: 0, total: 0 }, dayzero: { done: 0, total: 0 } },
    });
  });
});
