/**
 * Expenses — whole-store JSON export / restore.
 *
 * the Trip Vault's export/import schema as itinerary-only — expenses get their OWN
 * export file + schema rather than an extension of the Vault envelope. This module is the expense
 * analog of `core/vault/export-import.ts`: same envelope idiom (`makeEnvelope`, reused as-is — it is
 * a generic wrapper, not part of the Vault's itinerary schema), same fail-safe-on-any-error +
 * quarantine-the-bad-blob shape, same `{ ok }` discriminated result the UI switches on.
 *
 * TRUST BOUNDARY: `sanitizeExpenses` (`core/budget/expenses.ts`) — the SAME lenient/total validator
 * the storage read path already uses (`core/budget/storage.ts#loadExpenses`), so an imported file is
 * held to exactly the guarantee an on-disk slot already is. No new schema/migration machinery: v1 is
 * the only version so far; a future bump can add a migration step the way the Vault's did, when a
 * concrete v2 exists (YAGNI otherwise).
 *
 * NO WRITE HAPPENS HERE — `parseExpenseBackup` only validates. The caller (the Settings UI) hands
 * the parsed `Expense[]` to `useExpenses().restoreExpenses()`, which applies it as a tombstone-
 * replace merge under sync or a plain overwrite dormant — mirroring how
 * `backup-restore.tsx` calls `parseBackup()` + `restorePlans()` rather than a blind overwrite.
 */
import { makeEnvelope } from '@/core/vault/envelope';
import { sanitizeExpenses, type Expense } from '@/core/budget/expenses';

export const EXPENSE_EXPORT_VERSION = 1;
export const EXPENSE_QUARANTINE_KEY = 'nepal_japan_expenses_corrupt';

export type ExpenseParseResult = { ok: true; expenses: Expense[] } | { ok: false; error: string };

/** Serialize the given expenses as a pretty-printed, versioned envelope JSON string. */
export function exportExpenses(expenses: readonly Expense[]): string {
  const envelope = makeEnvelope(EXPENSE_EXPORT_VERSION, expenses, new Date().toISOString());
  return JSON.stringify(envelope, null, 2);
}

/** Quarantine a rejected import blob verbatim so its raw bytes are recoverable. */
function quarantine(raw: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.localStorage.getItem(EXPENSE_QUARANTINE_KEY) === null) {
      window.localStorage.setItem(EXPENSE_QUARANTINE_KEY, raw);
    }
    console.warn('[expenses] rejected expenses import; original preserved at', EXPENSE_QUARANTINE_KEY);
  } catch {
    /* ignore (quota / disabled storage) — never throw from a preserve attempt */
  }
}

/**
 * Validate a whole-expenses-store JSON string WITHOUT writing. Fails safe: a parse error or an
 * unrecognized envelope shape rejects (and quarantines the raw text); any other payload is run
 * through `sanitizeExpenses` — the SAME lenient/total boundary the storage read path uses — so a
 * malformed individual row is dropped rather than rejecting the whole file.
 */
export function parseExpenseBackup(rawText: string): ExpenseParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    quarantine(rawText);
    return { ok: false, error: 'That file is not valid JSON. No changes were made to your expenses.' };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { schemaVersion?: unknown }).schemaVersion !== 'number' ||
    !Array.isArray((parsed as { payload?: unknown }).payload)
  ) {
    quarantine(rawText);
    return {
      ok: false,
      error: 'That file is not a recognized expenses export. No changes were made to your expenses.',
    };
  }

  const expenses = sanitizeExpenses((parsed as { payload: unknown }).payload);
  return { ok: true, expenses };
}
