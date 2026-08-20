/**
 * Itinerary domain model — the read-boundary sanitizer for `ItineraryItem` rows (issue #123).
 *
 * The sibling domains each own one of these (`core/places/model.ts` `sanitizePlace`,
 * `core/docs/model.ts` `sanitizeItem`, `core/budget/expenses.ts` `sanitizeExpense`); the
 * itinerary — the one domain whose loss hurts most — did not have one, so `docToDayPlan`
 * cast raw Firestore bytes straight to `ItineraryItem[]` and a single `null` element in a
 * remote `days/{date}.items` array threw inside `mergeItems` (which dereferences `it.id`
 * unconditionally) on every device that received the snapshot.
 *
 * THE RULE IS THE VAULT'S OWN, NOT A SECOND ONE. `itineraryItemSchema` (core/vault/schema.ts)
 * is already the declared lenient read contract for an item — `category` a plain string, no
 * range clamps, `.passthrough()` for forward keys. Re-stating it here would give the remote
 * boundary and the on-disk boundary two rules that could drift apart, so this imports it. The
 * resulting import cycle (schema.ts also imports this module, for `parseItineraryPayload`) is
 * safe by construction: neither side touches the other at module-init time, only inside a
 * function body.
 *
 * LENIENT, and deliberately so: dropping a good row is a worse bug than the one this fixes.
 * Nothing is coerced, nothing absent is defaulted, unknown forward keys survive, and rows are
 * NOT deduped by id (`mergeItems` already resolves same-id rows, and dropping a duplicate here
 * would silently discard the loser of a merge that has not happened yet).
 *
 * Framework-free and TOTAL — no React, no window, no storage, never throws.
 */

import type { ItineraryItem } from '@/lib/trip-data';
import { itineraryItemSchema } from '@/core/vault/schema';

/**
 * Narrow one untrusted value into an `ItineraryItem`, or `null` when it is unsalvageable:
 * not an object, or failing the vault's lenient item contract (in practice: no `id`, no
 * `title`, no `category`, or a declared field present with the wrong type). A BLANK `id` is
 * rejected on top of the schema — the schema tolerates `''`, but `id` is the merge key every
 * sync path buckets on, so an empty one is not a row that can survive a round trip.
 *
 * The parsed value is returned as-is, so `.passthrough()` keys a future build wrote are kept.
 */
export function sanitizeItineraryItem(value: unknown): ItineraryItem | null {
  const parsed = itineraryItemSchema.safeParse(value);
  if (!parsed.success || parsed.data.id.trim() === '') return null;
  return parsed.data as ItineraryItem;
}

/**
 * Normalize an unknown (a Firestore `items` field, a vault day's `items`) into a valid
 * `ItineraryItem[]`: `[]` for a non-array, and each unsalvageable entry dropped while every
 * other row survives verbatim. TOTAL — never throws.
 */
export function sanitizeItineraryItems(value: unknown): ItineraryItem[] {
  if (!Array.isArray(value)) return [];
  const out: ItineraryItem[] = [];
  for (const raw of value) {
    const item = sanitizeItineraryItem(raw);
    if (item !== null) out.push(item);
  }
  return out;
}
