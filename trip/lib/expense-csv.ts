import { legCurrency } from '@/core/budget/model';
import type { Expense } from '@/core/budget/expenses';

/**
 * Expense → CSV export — a pure, framework-free serializer (: no CSV dependency;
 * this is a few lines of native string-building). The caller Blob-downloads the result
 * (`components/settings-panel.tsx`, mirroring `core/vault/export-import.ts`'s existing
 * `exportItinerary()`/Blob idiom).
 *
 * RFC-4180: CRLF (`\r\n`) row separators, a field is quoted iff it contains a comma, a double
 * quote, or a line break, and an interior double quote is escaped by doubling it. Quoting is NOT
 * the whole story: RFC-4180 is a transport encoding and says nothing about what a spreadsheet does
 * with the decoded text, so `csvField` ALSO neutralizes a leading formula trigger before quoting
 * (#115). Currency is DERIVED from the leg.
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

/**
 * Excel/Sheets/LibreOffice evaluate a cell whose text begins with `=`, `+`, `-` or `@` as a live
 * formula (`=cmd|'/c calc'!A1`, or a `=HYPERLINK(...)` that exfiltrates the row) — and TAB / CR / LF
 * count too, because they are stripped as leading whitespace before that test. Every one of those
 * seven is a trigger here. Note text is written by ANY traveller in the trip and read by whoever
 * exports, so the payload author and the victim are different people (#115).
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r\n]/;
/**
 * ...but a field that is ENTIRELY a number literal is exempt: `String(e.amount)` puts `-42` in the
 * Amount column, and prefixing it would turn a summable numeric cell into text — a real regression
 * in the export. Safe because the exemption requires the WHOLE value to match, leaving no room for
 * a payload after the digits (`-1+cmd|...` is not a number literal, so it is still neutralized).
 */
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/**
 * Neutralize a leading formula trigger with an apostrophe (which spreadsheets strip on display and
 * never evaluate), THEN quote iff the result contains a comma, a double quote, or a line break,
 * doubling interior quotes. That order is load-bearing: the apostrophe must land INSIDE the quotes
 * — `=1,2` → `"'=1,2"`, never `'"=1,2"`, which is not valid RFC-4180 and leaves the formula intact.
 */
function csvField(value: string): string {
  const safe = FORMULA_TRIGGER.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
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
