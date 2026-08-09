// S160 — PhotoMeta pure-core unit suite: sanitize (identity required, alt/dims repairable), owner
// filter, add/remove, and the expense-owner re-point. TOTAL / never-throw, mirrors journal-core. D-159.

import { describe, it, expect } from 'vitest';
import {
  sanitizePhoto,
  sanitizePhotos,
  photosForOwner,
  addPhotoMeta,
  removePhotoMeta,
  repointExpenseOwner,
  isPhotoOwner,
  type PhotoMeta,
} from '@/core/photos/model';

const meta = (over: Partial<PhotoMeta> = {}): PhotoMeta => ({
  id: 'ph-1',
  owner: { kind: 'journal', date: '2026-12-14' },
  altText: 'A momo stall',
  w: 1600,
  h: 1200,
  bytes: 200_000,
  createdAt: '2026-12-14T10:00:00.000Z',
  ...over,
});

describe('isPhotoOwner', () => {
  it('accepts a valid journal (date) and expense (id) owner; rejects the rest', () => {
    expect(isPhotoOwner({ kind: 'journal', date: '2026-12-14' })).toBe(true);
    expect(isPhotoOwner({ kind: 'expense', expenseId: 'exp-1' })).toBe(true);
    expect(isPhotoOwner({ kind: 'journal', date: 'nope' })).toBe(false);
    expect(isPhotoOwner({ kind: 'expense', expenseId: '' })).toBe(false);
    expect(isPhotoOwner(null)).toBe(false);
  });
});

describe('sanitizePhoto — identity required, everything else repairable', () => {
  it('keeps a well-formed row verbatim', () => {
    const m = meta({ caption: 'Warm from the steamer' });
    expect(sanitizePhoto(m)).toEqual(m);
  });

  it('drops a row with no id or a bad owner (identity has no safe default)', () => {
    expect(sanitizePhoto({ ...meta(), id: '' })).toBeNull();
    expect(sanitizePhoto({ ...meta(), owner: { kind: 'journal', date: 'x' } })).toBeNull();
  });

  it('degrades altText → caption → "", and w/h/bytes → 0 (repairable, never a drop)', () => {
    const out = sanitizePhoto({ id: 'ph-9', owner: { kind: 'expense', expenseId: 'exp-2' }, caption: 'Receipt' });
    expect(out).toEqual({
      id: 'ph-9',
      owner: { kind: 'expense', expenseId: 'exp-2' },
      altText: 'Receipt', // fell back to caption
      caption: 'Receipt',
      w: 0,
      h: 0,
      bytes: 0,
      createdAt: '',
    });
  });
});

describe('sanitizePhotos — array guard + dedupe by id', () => {
  it('drops non-arrays and unsalvageable rows, last write per id wins', () => {
    expect(sanitizePhotos('nope')).toEqual([]);
    const dupA = meta({ id: 'ph-x', altText: 'first' });
    const dupB = meta({ id: 'ph-x', altText: 'second' });
    const out = sanitizePhotos([dupA, { id: '' }, dupB]);
    expect(out).toHaveLength(1);
    expect(out[0].altText).toBe('second');
  });
});

describe('owner filter + add/remove', () => {
  it('photosForOwner returns only the matching owner in stored order', () => {
    const a = meta({ id: 'ph-a', owner: { kind: 'journal', date: '2026-12-14' } });
    const b = meta({ id: 'ph-b', owner: { kind: 'journal', date: '2026-12-15' } });
    const c = meta({ id: 'ph-c', owner: { kind: 'expense', expenseId: 'exp-1' } });
    const all = [a, b, c];
    expect(photosForOwner(all, { kind: 'journal', date: '2026-12-14' })).toEqual([a]);
    expect(photosForOwner(all, { kind: 'expense', expenseId: 'exp-1' })).toEqual([c]);
  });

  it('addPhotoMeta appends; removePhotoMeta drops by id (both immutable)', () => {
    const a = meta({ id: 'ph-a' });
    const b = meta({ id: 'ph-b' });
    expect(addPhotoMeta([a], b)).toEqual([a, b]);
    expect(removePhotoMeta([a, b], 'ph-a')).toEqual([b]);
    expect(removePhotoMeta([a], 'ph-missing')).toEqual([a]); // no-op
  });
});

describe('repointExpenseOwner — the sync-on Undo re-point (D-160)', () => {
  it('moves only matching expense owners old→new; leaves journal + other expenses untouched', () => {
    const receipt = meta({ id: 'ph-r', owner: { kind: 'expense', expenseId: 'exp-old' } });
    const journal = meta({ id: 'ph-j', owner: { kind: 'journal', date: '2026-12-14' } });
    const other = meta({ id: 'ph-o', owner: { kind: 'expense', expenseId: 'exp-keep' } });
    const out = repointExpenseOwner([receipt, journal, other], 'exp-old', 'exp-new');
    expect(out[0].owner).toEqual({ kind: 'expense', expenseId: 'exp-new' });
    expect(out[1].owner).toEqual({ kind: 'journal', date: '2026-12-14' });
    expect(out[2].owner).toEqual({ kind: 'expense', expenseId: 'exp-keep' });
  });

  it('is a no-op when old === new (dormant restore keeps the same id)', () => {
    const receipt = meta({ id: 'ph-r', owner: { kind: 'expense', expenseId: 'exp-1' } });
    expect(repointExpenseOwner([receipt], 'exp-1', 'exp-1')).toEqual([receipt]);
  });
});
