/**
 * Same-tab storage-liveness event names — one home for every domain's `*_CHANGED_EVENT`.
 *
 * Each name is dispatched on `window` by that domain's single write path and listened for by
 * `createReactiveStore` (alongside the cross-tab `storage` event), so every mounted consumer
 * re-reads without a reload. The names are the on-the-wire contract between a writer and a
 * listener — plain string constants, no React, no storage access, no imports.
 *
 * They used to live on the hooks that consume them, which forced `lib/*-remote.ts` (five
 * domains — itinerary, budget, docs, expenses, my-places) to import from `hooks/` just to name
 * an event, closing a `lib -> hooks -> lib` cycle through each domain's `*-ports.ts` (issue
 * #163). It also gave `core/vault/export-import.ts` a runtime `core -> hooks` edge, which D-099
 * forbids. Consolidating here breaks both: `core/storage/events.ts` has no imports of its own,
 * so nothing can cycle back through it. The hooks re-export their own constant verbatim, so no
 * existing consumer import changes.
 *
 * `SYNC_OUTBOX_CHANGED_EVENT` is deliberately NOT here: it is not a user-facing domain event,
 * and it already lives framework-free in `core/sync/outbox.ts` with no cycle to fix.
 */

export const BUDGET_CHANGED_EVENT = 'budget:changed';
export const DOCS_CHANGED_EVENT = 'docs:changed';
export const EXPENSES_CHANGED_EVENT = 'expenses:changed';
export const FAVORITES_CHANGED_EVENT = 'favorites:changed';
export const ITINERARY_CHANGED_EVENT = 'itinerary:changed';
export const JOURNAL_CHANGED_EVENT = 'journal:changed';
export const MY_PLACES_CHANGED_EVENT = 'myplaces:changed';
export const PACKING_CHANGED_EVENT = 'packing:changed';
export const PHOTOS_CHANGED_EVENT = 'photos:changed';
export const SHARE_CHANGED_EVENT = 'share:changed';
