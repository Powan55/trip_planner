import { legCurrency } from '@/core/budget/model';
import type { Expense } from '@/core/budget/expenses';

/**
 * Expense → CSV export — a pure, framework-free serializer (: no CSV dependency;
 * this is a few lines of native string-building). The caller Blob-downloads the result
 * (`components/settings-panel.tsx`, mirroring `core/vault/export-import.ts`'s existing
 * `exportItinerary()`/Blob idiom).
 *
 * RFC-4180: CRLF (`\r\n`) row separators, a field is quoted iff it contains a comma, a double
 * quote, or a line break, and an interior double quote is escaped by doubling it. Currency is
 * DERIVED from the leg.
 * `paidBy`/`split` are flattened read-only: `Paid By` as-is, `Split With` the
 * member names semicolon-joined; both are absent on the (default) unsplit fast path.
 *
 * Read-only over `Expense[]` — no store/schema change. Empty input still produces the header
 * row (a valid, openable CSV with zero data rows) rather than an empty string.
 */

const CSV_HEADERS = [
  'Date',
  'Leg',
  'Category',
  'Currency',
  'Amount',
  'Note',
  'Paid By',
  'Split With',
] as const;

/** Quote a field iff it contains a comma, a double quote, or a line break; double interior quotes. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function expensesToCsv(expenses: readonly Expense[]): string {
  const rows = [CSV_HEADERS.map(csvField).join(',')];
  for (const e of expenses) {
    const fields = [
      e.date ?? '',
      e.leg,
      e.category,
      legCurrency(e.leg),
      String(e.amount),
      e.note ?? '',
      e.paidBy ?? '',
      e.split?.join('; ') ?? '',
    ];
    rows.push(fields.map(csvField).join(','));
  }
  return rows.join('\r\n') + '\r\n';
}
