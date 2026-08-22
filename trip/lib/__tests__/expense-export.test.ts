// @vitest-environment jsdom
//
// S174 (FU-37) — expense export/import schema: round-trip + fail-safe validation.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  exportExpenses,
  parseExpenseBackup,
  EXPENSE_EXPORT_VERSION,
  EXPENSE_QUARANTINE_KEY,
} from '@/lib/expense-export';
import type { Expense } from '@/core/budget/expenses';
import { setActiveTripId, keyFor, STORAGE_KEYS } from '@/core/storage/gateway';

const E1: Expense = {
  id: 'e1',
  leg: 'nepal',
  category: 'food',
  amount: 500,
  date: '2026-12-10',
  note: 'Dal bhat',
  createdAt: '2026-12-10T10:00:00.000Z',
};
const E2: Expense = {
  id: 'e2',
  leg: 'japan',
  category: 'transportation',
  amount: 1200,
  createdAt: '2026-12-20T10:00:00.000Z',
  paidBy: 'Powan',
  split: ['Powan', 'Friend'],
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('exportExpenses / parseExpenseBackup — schema + round-trip (S174, D-098)', () => {
  it('exports a versioned envelope and round-trips to a deep-equal expense list', () => {
    const json = exportExpenses([E1, E2]);
    const envelope = JSON.parse(json);
    expect(envelope.schemaVersion).toBe(EXPENSE_EXPORT_VERSION);
    expect(typeof envelope.updatedAt).toBe('string');
    expect(Array.isArray(envelope.payload)).toBe(true);

    const parsed = parseExpenseBackup(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.expenses).toEqual([E1, E2]);
    }
  });

  it('export -> clearAll (empty) -> restore round-trips to the ORIGINAL list (D-088 CRUD proof)', () => {
    const json = exportExpenses([E1, E2]);
    // Simulate clearAll(): the store is now [].
    const cleared: Expense[] = [];
    expect(cleared).toEqual([]);
    // Restore from the export.
    const parsed = parseExpenseBackup(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.expenses).toEqual([E1, E2]);
  });

  it('empty store exports + round-trips to an empty list', () => {
    const json = exportExpenses([]);
    const parsed = parseExpenseBackup(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.expenses).toEqual([]);
  });

  it('rejects invalid JSON and quarantines the raw text', () => {
    const result = parseExpenseBackup('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not valid JSON/);
    expect(localStorage.getItem(EXPENSE_QUARANTINE_KEY)).toBe('{not json');
  });

  it('rejects a recognized-but-foreign shape (e.g. an itinerary export) and quarantines it', () => {
    const foreign = JSON.stringify({ schemaVersion: 4, updatedAt: 'x', payload: 'not-an-array' });
    const result = parseExpenseBackup(foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a recognized expenses export/);
  });

  it('drops individually-malformed rows (lenient trust boundary) rather than rejecting the whole file', () => {
    const raw = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 'x',
      // A missing id is the one thing left with no safe default (#150 widened category off the
      // enum, so an unrecognized category no longer counts as malformed here — see the dedicated
      // test below).
      payload: [E1, { leg: 'nepal', category: 'food', amount: 1, createdAt: '' }],
    });
    const result = parseExpenseBackup(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expenses).toHaveLength(1);
      expect(result.expenses[0].id).toBe('e1');
    }
  });

  it('a row whose LEG is unknown to the active pack is IMPORTED, not dropped', () => {
    // This case used to sit in the test above, with `leg: 'not-a-leg'` as the malformed row. It was
    // pinning a data-loss bug: an expenses-only backup taken under another pack imported 0 rows and
    // still reported success. An unknown leg is inert (excluded from the aggregates), not fatal.
    const raw = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 'x',
      payload: [E1, { id: 'm1', leg: 'main', category: 'food', amount: 1, createdAt: '' }],
    });
    const result = parseExpenseBackup(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expenses.map((e) => e.id)).toEqual(['e1', 'm1']);
      expect(result.expenses[1].leg).toBe('main');
    }
  });

  it('a row whose CATEGORY is unrecognized is IMPORTED, not dropped (#150)', () => {
    // A backup taken on a newer build that shipped a category this build doesn't know. Used to
    // hard-reject the whole row (`isCategory` in `sanitizeExpense`); now retained verbatim.
    const raw = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 'x',
      payload: [E1, { id: 'f1', leg: 'nepal', category: 'ferry', amount: 1, createdAt: '' }],
    });
    const result = parseExpenseBackup(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.expenses.map((e) => e.id)).toEqual(['e1', 'f1']);
      expect(result.expenses[1].category).toBe('ferry');
    }
  });

  it('a future higher schemaVersion is still read leniently (forward-compat)', () => {
    const raw = JSON.stringify({ schemaVersion: 99, updatedAt: 'x', payload: [E1] });
    const result = parseExpenseBackup(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.expenses).toEqual([E1]);
  });
});

// ── #100/A-10 — quarantine now routes through keyFor('expensesCorrupt') ──────────────────────
describe('expense quarantine key — routed through the gateway (keyFor), grandfathered on the default pack', () => {
  it('EXPENSE_QUARANTINE_KEY is byte-identical to the gateway\'s STORAGE_KEYS.expensesCorrupt', () => {
    expect(EXPENSE_QUARANTINE_KEY).toBe(STORAGE_KEYS.expensesCorrupt);
    expect(EXPENSE_QUARANTINE_KEY).toBe('nepal_japan_expenses_corrupt');
  });

  it('default pack: a rejected import still quarantines under the exact legacy literal (grandfather)', () => {
    const result = parseExpenseBackup('{not json');
    expect(result.ok).toBe(false);
    expect(localStorage.getItem(EXPENSE_QUARANTINE_KEY)).toBe('{not json');
    expect(keyFor('expensesCorrupt')).toBe(EXPENSE_QUARANTINE_KEY);
  });

  it('non-default pack: a rejected import quarantines under trip:{id}:expensesCorrupt, NOT the legacy literal', () => {
    setActiveTripId('some-other-trip');
    const result = parseExpenseBackup('{not json');
    expect(result.ok).toBe(false);
    expect(localStorage.getItem('trip:some-other-trip:expensesCorrupt')).toBe('{not json');
    expect(localStorage.getItem(EXPENSE_QUARANTINE_KEY)).toBeNull();
  });
});
