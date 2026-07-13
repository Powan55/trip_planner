/**
 * Shared generator for itinerary-item ids.
 *
 * Lifted verbatim from `calendar-planner.tsx`'s former local `generateId()` so the
 * calendar and (later) the add-to-itinerary dialog share ONE generator and never
 * drift into two id schemes. `id` is the per-placement identity; `sourceId`
 * is the shared back-link.
 *
 * Uses `crypto.randomUUID()` when available (all evergreen browsers, and Node 19+),
 * else falls back to the original `'item_' + base36(time) + '_' + base36(rand)` form.
 */
export function generateItemId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof (crypto as Crypto).randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
}
