// @vitest-environment jsdom
//
// S160 — EGRESS PROOFS (D-159, the zero-egress invariant). Two of the four proofs are Vitest-level and
// live here; the other two are (b) a Playwright network intercept (e2e/photos.spec.ts) and (d) a grep
// gate (`indexedDB` only under core/photos/**). These assert, on a real run, that photo bytes AND refs
// never enter a synced or exported shape — BY CONSTRUCTION (the Expense/DayPlan carry no photo field;
// the link lives only in the key-16 index).
//
//   (a) sync-payload: an expense — even with a receipt attached in key 16 — serializes with no photo
//       content, and sanitizeExpense (the allowlist that builds the synced row) strips any injected
//       photo field.
//   (c) export: exportItinerary() output, with journal + expense photos present in storage, contains
//       no 'ph-' id, no 'nepal_japan_photos', no 'data:image'.

import { describe, it, expect, beforeEach } from 'vitest';
import { sanitizeExpense, sanitizeExpenses, type Expense } from '@/core/budget/expenses';
import { savePhotos } from '@/core/photos/storage';
import { expensesStore, STORAGE_KEYS } from '@/core/storage/gateway';
import { exportItinerary } from '@/core/vault/export-import';
import type { PhotoMeta } from '@/core/photos/model';

const PHOTO_METAS: PhotoMeta[] = [
  {
    id: 'ph-secret-journal',
    owner: { kind: 'journal', date: '2026-12-14' },
    altText: 'A momo stall',
    caption: 'data:image/should-not-leak',
    w: 1600,
    h: 1200,
    bytes: 200_000,
    createdAt: '2026-12-14T10:00:00.000Z',
  },
  {
    id: 'ph-secret-receipt',
    owner: { kind: 'expense', expenseId: 'exp-1' },
    altText: 'Ramen receipt',
    w: 1200,
    h: 1600,
    bytes: 180_000,
    createdAt: '2026-12-14T12:00:00.000Z',
  },
];

const PHOTO_MARKERS = ['ph-secret', 'ph-test', 'data:image', 'nepal_japan_photos'];

beforeEach(() => {
  localStorage.clear();
});

describe('(a) sync-payload — an expense carries no photo content, by construction', () => {
  it('sanitizeExpense STRIPS any injected photo field (allowlist build — nothing to leak)', () => {
    // A hostile/legacy row that tries to smuggle photo refs onto the synced shape.
    const rogue = {
      id: 'exp-1',
      leg: 'nepal',
      category: 'food',
      amount: 500,
      createdAt: 't',
      // none of these are on the Expense allowlist → must be dropped by sanitizeExpense:
      photoIds: ['ph-secret-receipt'],
      photo: 'data:image/jpeg;base64,AAAA',
      receipt: 'ph-secret-receipt',
    } as unknown;
    const clean = sanitizeExpense(rogue)!;
    expect(clean).not.toBeNull();
    expect(clean).not.toHaveProperty('photoIds');
    expect(clean).not.toHaveProperty('photo');
    expect(clean).not.toHaveProperty('receipt');
    // The serialized row (what a sync push would carry) has no photo trace of any kind.
    const wire = JSON.stringify(clean);
    for (const marker of PHOTO_MARKERS) expect(wire).not.toContain(marker);
  });

  it('a real logged expense + a receipt in key 16: the expenses slot has no photo data', () => {
    // Attach a receipt in the SEPARATE key-16 index, and log the expense in key 11.
    savePhotos(PHOTO_METAS);
    const expense: Expense = { id: 'exp-1', leg: 'nepal', category: 'food', amount: 500, createdAt: 't' };
    expensesStore.set<Expense[]>(sanitizeExpenses([expense]));

    // The expenses slot (the sync/merge source) never references the photo.
    const wire = localStorage.getItem(STORAGE_KEYS.expenses)!;
    for (const marker of PHOTO_MARKERS) expect(wire).not.toContain(marker);
    // …while the photo IS genuinely present in its own local index (non-vacuous).
    expect(localStorage.getItem(STORAGE_KEYS.photos)).toContain('ph-secret-receipt');
  });
});

describe('(c) export — exportItinerary() output is free of any photo data', () => {
  it('with journal + expense photos in storage, the export string has no ph-/data:image/photos key', () => {
    savePhotos(PHOTO_METAS);
    expensesStore.set<Expense[]>([{ id: 'exp-1', leg: 'nepal', category: 'food', amount: 500, createdAt: 't' }]);

    const exported = exportItinerary();
    for (const marker of PHOTO_MARKERS) expect(exported).not.toContain(marker);
    // Sanity: the photos ARE in storage at export time, so the absence is meaningful, not vacuous.
    expect(localStorage.getItem(STORAGE_KEYS.photos)).toContain('ph-secret-journal');
  });
});
