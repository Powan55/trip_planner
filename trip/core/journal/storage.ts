/**
 * Journal persistence adapter — the ONE load/save path for the `JournalEntry[]`,
 * over the typed storage gateway's key-12 `journalStore`. Kept tiny + framework-free:
 * it wires the byte-transport gateway to the domain's `sanitizeEntries`, so a corrupt or
 * partially-valid on-disk slot always resolves to a valid list (the "make it safe" policy lives in
 * the domain, not the transport). Mirrors `core/budget/storage.ts`'s expenses adapter exactly.
 *
 * `loadJournal()` returns a sanitized `JournalEntry[]` (empty list when absent / SSR / corrupt).
 * `saveJournal(entries)` sanitizes then writes the whole list as JSON. Never throws (the gateway
 * swallows quota / disabled-storage / cyclic-value failures). Sanitizing on write keeps a corrupt
 * caller value from ever reaching disk.
 */

import { journalStore, hasKey, STORAGE_KEYS } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizeEntries, type JournalEntry } from '@/core/journal/model';

/** Load + sanitize the persisted journal list (empty list when absent / SSR / corrupt). */
export function loadJournal(): JournalEntry[] {
  const raw = journalStore.get<unknown>([]);
  return sanitizeEntries(raw);
}

/** Sanitize + persist the whole journal list as JSON. No-op / never-throws under SSR or storage failure. */
export function saveJournal(entries: JournalEntry[]): void {
  journalStore.set<JournalEntry[]>(sanitizeEntries(entries));
}

/**
 * The journal `StoragePort<JournalEntry[]>` for `createReactiveStore` — the same
 * load/save contract the hook already used, plus raw key-presence to satisfy the port.
 * `has()` is not consulted by the factory skeleton; it completes the contract for parity with the
 * itinerary port.
 */
export const journalStoragePort: StoragePort<JournalEntry[]> = {
  load: loadJournal,
  save: saveJournal,
  has: () => hasKey('local', STORAGE_KEYS.journal),
};
