import { describe, it, expect } from 'vitest';

/**
 * S220 — pure share-inbox core (D-016/D-099). `core/share/model.ts` is framework-free; these tests
 * pin the Zod read boundary (`sanitizeItem`/`sanitizeItems` — total, id/receivedAt/content-required,
 * dedupe by id, empty on non-array/all-corrupt), the day-assign bounds (`isTripDay`/`assignDay`
 * against `core/dates` `TRIP_DATES`), and the pure mutators (`addShareItem` cap-100 drop-oldest,
 * `removeShareItem`).
 */

import {
  sanitizeItem,
  sanitizeItems,
  addShareItem,
  removeShareItem,
  assignDay,
  isTripDay,
  SHARE_CAP,
  type ShareItem,
} from '@/core/share/model';
import { TRIP_DATES } from '@/core/dates';

const base: ShareItem = { id: 'a', url: 'https://example.com', receivedAt: '2026-07-18T10:00:00.000Z' };

describe('sanitizeItem — parse-don\'t-validate round trip', () => {
  it('accepts a valid item verbatim (title+text+url+day preserved)', () => {
    const day = TRIP_DATES[1];
    const item = { id: 'x', title: 'T', text: 'B', url: 'https://a.co', receivedAt: '2026-07-18T00:00:00Z', day };
    expect(sanitizeItem(item)).toEqual(item);
  });

  it('trims content and drops blank/whitespace-only fields', () => {
    expect(sanitizeItem({ id: ' x ', title: '  Hi  ', text: '   ', url: '', receivedAt: ' 2026 ' })).toEqual({
      id: 'x',
      title: 'Hi',
      receivedAt: '2026',
    });
  });

  it('rejects missing id / receivedAt / all-empty content', () => {
    expect(sanitizeItem(null)).toBeNull();
    expect(sanitizeItem('nope')).toBeNull();
    expect(sanitizeItem({ id: '', url: 'https://a.co', receivedAt: 't' })).toBeNull();
    expect(sanitizeItem({ id: 'x', url: 'https://a.co' })).toBeNull(); // no receivedAt
    expect(sanitizeItem({ id: 'x', receivedAt: 't' })).toBeNull(); // no content at all
    expect(sanitizeItem({ id: 'x', title: '   ', receivedAt: 't' })).toBeNull(); // blank content
  });

  it('drops an out-of-trip day but KEEPS the item (degrade, not reject)', () => {
    const item = sanitizeItem({ id: 'x', url: 'https://a.co', receivedAt: 't', day: '1999-01-01' });
    expect(item).not.toBeNull();
    expect(item?.day).toBeUndefined();
  });

  it('tolerates + passes through unknown future keys (never quarantines a whole item)', () => {
    const item = sanitizeItem({ id: 'x', url: 'https://a.co', receivedAt: 't', futureField: 42 });
    expect(item).toEqual({ id: 'x', url: 'https://a.co', receivedAt: 't' });
  });
});

describe('sanitizeItems', () => {
  it('a non-array / all-corrupt value yields the empty inbox', () => {
    expect(sanitizeItems(undefined)).toEqual([]);
    expect(sanitizeItems(null)).toEqual([]);
    expect(sanitizeItems({ not: 'array' })).toEqual([]);
    expect(sanitizeItems([null, 42, { bad: true }])).toEqual([]);
  });

  it('drops malformed entries, keeps valid ones, dedupes by id (first/newest wins)', () => {
    const out = sanitizeItems([
      { id: 'a', title: 'First', receivedAt: 't1' },
      { bad: true },
      { id: 'a', title: 'Second', receivedAt: 't2' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('First');
  });

  it('caps a bloated slot to the newest SHARE_CAP (drop-oldest)', () => {
    const many = Array.from({ length: SHARE_CAP + 25 }, (_, i) => ({
      id: `id-${i}`,
      text: `t${i}`,
      receivedAt: `2026-07-18T00:00:${String(i).padStart(2, '0')}Z`,
    }));
    const out = sanitizeItems(many);
    expect(out).toHaveLength(SHARE_CAP);
    expect(out[0].id).toBe('id-0'); // newest-first order preserved; head kept
  });
});

describe('addShareItem — newest-first, cap-100 drop-oldest', () => {
  it('prepends the new item (newest-first)', () => {
    const next = addShareItem([base], { id: 'b', text: 'new', receivedAt: 't' });
    expect(next.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('re-adding the same id de-dupes (moves it to the front, no growth)', () => {
    const next = addShareItem([base, { id: 'b', text: 'x', receivedAt: 't' }], { ...base, text: 'again' });
    expect(next.map((i) => i.id)).toEqual(['a', 'b']);
    expect(next).toHaveLength(2);
  });

  it('drops the OLDEST when the list is already at the cap', () => {
    const full: ShareItem[] = Array.from({ length: SHARE_CAP }, (_, i) => ({
      id: `id-${i}`,
      text: `t${i}`,
      receivedAt: 't',
    }));
    const oldestId = full[full.length - 1].id;
    const next = addShareItem(full, { id: 'fresh', text: 'new', receivedAt: 't' });
    expect(next).toHaveLength(SHARE_CAP);
    expect(next[0].id).toBe('fresh');
    expect(next.some((i) => i.id === oldestId)).toBe(false); // oldest evicted
  });
});

describe('removeShareItem', () => {
  it('removes the matching id, returns a new array; a miss is a no-op', () => {
    const list = [base, { id: 'b', text: 'x', receivedAt: 't' }];
    expect(removeShareItem(list, 'a').map((i) => i.id)).toEqual(['b']);
    expect(removeShareItem(list, 'zzz')).toEqual(list);
  });
});

describe('day-assign bounds (isTripDay / assignDay)', () => {
  it('isTripDay accepts only real trip days', () => {
    expect(isTripDay(TRIP_DATES[0])).toBe(true);
    expect(isTripDay('2026-12-10')).toBe(true);
    expect(isTripDay('1999-01-01')).toBe(false);
    expect(isTripDay('not-a-date')).toBe(false);
    expect(isTripDay(undefined)).toBe(false);
    expect(isTripDay(20261210)).toBe(false);
  });

  it('assignDay sets an in-bounds day', () => {
    const day = TRIP_DATES[3];
    const next = assignDay([base], 'a', day);
    expect(next[0].day).toBe(day);
  });

  it('assignDay with an OUT-of-bounds day clears the assignment (never persists a bad day)', () => {
    const assigned = assignDay([base], 'a', TRIP_DATES[2]);
    const cleared = assignDay(assigned, 'a', '2050-01-01');
    expect(cleared[0].day).toBeUndefined();
  });

  it('assignDay(undefined) clears; a non-matching id is a no-op', () => {
    const assigned = assignDay([base], 'a', TRIP_DATES[2]);
    expect(assignDay(assigned, 'a', undefined)[0].day).toBeUndefined();
    expect(assignDay([base], 'zzz', TRIP_DATES[0])).toEqual([base]);
  });
});
