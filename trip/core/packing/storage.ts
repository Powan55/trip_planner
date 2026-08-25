/**
 * Packing checklist persistence adapter — the ONE load/save path for the
 * `PackingItem[]`, over the typed storage gateway's key-21 `packingStore`. Kept tiny +
 * framework-free: it wires the byte-transport gateway to the domain's `sanitizeItems`, so
 * an absent or corrupt on-disk slot resolves to the built-in template. Mirrors
 * `core/journal/storage.ts` exactly.
 *
 * ABSENT ≠ EMPTY (#328). The template seeds a slot that was NEVER written; a slot holding `[]`
 * is a traveler who deleted every row and it stays empty across reloads. Both sides of the
 * round-trip agree on that — `savePacking` writes an empty list verbatim rather than
 * substituting the template, which is what used to inject the Nepal and Japan leg rows into a
 * custom trip's slot.
 *
 * `loadPacking()` returns a sanitized `PackingItem[]` (the seed when absent/SSR/corrupt).
 * `savePacking(items)` sanitizes then writes the whole list as JSON. Never throws.
 */

import { packingStore, hasKey, keyFor } from '@/core/storage/gateway';
import type { StoragePort } from '@/core/ports';
import { sanitizeItems, DEFAULT_TEMPLATE, type PackingItem } from '@/core/packing/model';
import { isDefaultTrip } from '@/core/trips';

/** What this trip seeds from when nothing was ever persisted: the full 28-row template on the
 * default trip, the `universal`-category rows only on a custom trip (D-355, A-15/#102) — a custom
 * trip must never be handed Nepal/Japan leg content. Exported so the "restore the default
 * checklist" affordance seeds from the same source as a first load. */
export function packingSeed(): readonly PackingItem[] {
  return isDefaultTrip() ? DEFAULT_TEMPLATE : DEFAULT_TEMPLATE.filter((i) => i.category === 'universal');
}

/** Load + sanitize the persisted packing list (the trip's seed template when absent/SSR/corrupt;
 * an empty list when the traveler deleted every row). */
export function loadPacking(): PackingItem[] {
  const seed = packingSeed();
  // Seeding belongs to ABSENT, not empty (#328). Raw key-presence is the only thing that tells
  // "never persisted" apart from "the traveler deleted every row" — a stored `[]` is a real value
  // and must survive the reload, or the trash button silently undoes itself.
  if (!hasKey('local', keyFor('packing'))) return [...seed];
  const raw = packingStore.get<unknown>(seed);
  if (Array.isArray(raw) && raw.length === 0) return [];
  return sanitizeItems(raw, seed);
}

/** Sanitize + persist the whole packing list as JSON. No-op / never-throws under SSR or storage failure. */
export function savePacking(items: PackingItem[]): void {
  // fallback=[]: a write persists what the caller passed and NOTHING else. `sanitizeItems`'
  // default fallback is the full template, so emptying the list used to write all 28 rows —
  // both legs, onto a custom trip too (#328).
  packingStore.set<PackingItem[]>(sanitizeItems(items, []));
}

/**
 * The packing `StoragePort<PackingItem[]>` for `createReactiveStore` — the same
 * load/save contract the hook uses, plus raw key-presence to satisfy the port.
 */
export const packingStoragePort: StoragePort<PackingItem[]> = {
  load: loadPacking,
  save: savePacking,
  has: () => hasKey('local', keyFor('packing')),
};
