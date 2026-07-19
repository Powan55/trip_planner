// Author filter — a PRESENTATIONAL, read-only view filter shared across the calendar
// and the timeline. It narrows which itinerary items are SHOWN to All /
// "My edits" / a specific traveler, using the existing `createdBy` / `updatedBy`
// attribution on `ItineraryItem`. It NEVER mutates stored data.
//
// HARD FENCE: this module touches NO localStorage and NO itinerary store. It
// holds only ephemeral, in-memory view state (the active selection). A reload resets the
// filter to "All" and the stored itinerary is byte-for-byte unaffected by it. CRUD and
// persistence are completely independent of anything here.
//
// STATE SHARING (mirrors in a SEPARATE module so it never entangles the itinerary
// store or `itinerary-provider.tsx`): a tiny module-level value plus a same-tab
// `CustomEvent` on `window`. `setAuthorFilter` updates the value and dispatches the event;
// `subscribeAuthorFilter` lets both surfaces re-read on change, so ONE selection narrows
// BOTH views. This is the same lightweight pattern the itinerary store uses for
// `itinerary:changed`, kept entirely independent of it.
//
// SSR-safe: no module-load side effects; `setAuthorFilter` guards the `window` dispatch
// with a `typeof window` check, and the pure helpers below never touch the DOM.

import type { DayPlan, ItineraryItem } from './trip-data';

/** Same-tab CustomEvent name, deliberately distinct from `itinerary:changed`. */
export const AUTHOR_FILTER_CHANGED_EVENT = 'author-filter:changed';

/**
 * The active filter. Two reserved sentinels + any author name:
 * - 'all' → show everything (no filtering).
 * - 'mine' → show only the current user's items (resolved via the live display name).
 * - any other string → that exact author name.
 *
 * Sentinels are bare words ('all' / 'mine'); a real selection is always a non-empty
 * display name. To avoid any theoretical collision with a traveler literally named "all"
 * or "mine", the author options are carried as `{ kind: 'author', name }` at the call
 * sites and matching is name-based — see `itemMatchesAuthor`. The stored value here is the
 * lightweight string form used by the control + the shared event.
 */
export type AuthorFilter =
  | { kind: 'all' }
  | { kind: 'mine' }
  | { kind: 'author'; name: string };

export const ALL_FILTER: AuthorFilter = { kind: 'all' };

// Module-level singleton — the one shared selection. Starts at 'all' (inert) so the
// first paint and the dormant/no-attribution case show every item, unchanged.
let currentFilter: AuthorFilter = ALL_FILTER;

/** Read the active filter (synchronous; safe anywhere, including SSR). */
export function getAuthorFilter(): AuthorFilter {
  return currentFilter;
}

/**
 * Set the active filter and notify subscribers via the same-tab CustomEvent.
 * Read-only w.r.t. persistence: NO localStorage write, NO itinerary-store call.
 * The `window` dispatch is SSR-guarded.
 */
export function setAuthorFilter(filter: AuthorFilter): void {
  currentFilter = filter;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTHOR_FILTER_CHANGED_EVENT));
  }
}

/**
 * Subscribe to filter changes (same-tab). Returns an unsubscribe fn. No-op under SSR.
 * Mirrors the itinerary store's `itinerary:changed` listener wiring.
 */
export function subscribeAuthorFilter(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => onChange();
  window.addEventListener(AUTHOR_FILTER_CHANGED_EVENT, handler);
  return () => window.removeEventListener(AUTHOR_FILTER_CHANGED_EVENT, handler);
}

/**
 * Does an item belong to the given author? An item is "by" an author if EITHER its
 * `updatedBy` (last editor) OR its `createdBy` (original author) equals that name.
 * Matching is exact (the attribution pipeline stamps a single canonical display name).
 *
 * Pure — no storage, no DOM. `myName` is injected (the live display name from
 * lib/identity) so "My edits" stays testable and this module never imports identity.
 *
 * @param item the item under test
 * @param filter the active filter
 * @param myName the current display name, or null/undefined if none is set
 */
export function itemMatchesAuthor(
  item: ItineraryItem,
  filter: AuthorFilter,
  myName: string | null | undefined,
): boolean {
  if (filter.kind === 'all') return true;
  const target = filter.kind === 'mine' ? myName : filter.name;
  // "My edits" with no name set (dormant / no-identity) matches nothing — but the
  // control never offers "My edits" without a name, so this is a defensive floor.
  if (!target) return false;
  return item.updatedBy === target || item.createdBy === target;
}

/**
 * Filter a day's items by the active author filter. A thin, pure `.filter()` over the
 * items SHOWN — it returns a NEW array and never touches the source.
 * 'all' returns the same items (no copy needed for the common path).
 */
export function filterItemsByAuthor(
  items: ItineraryItem[],
  filter: AuthorFilter,
  myName: string | null | undefined,
): ItineraryItem[] {
  if (filter.kind === 'all') return items;
  return items.filter((i) => itemMatchesAuthor(i, filter, myName));
}

/**
 * Derive the distinct author names present across ALL plans, from both `updatedBy` and
 * `createdBy`. Used to build the per-author options. Sorted for a stable control order.
 * When NO item is attributed (the portfolio / dormant case) this returns `[]`, which the
 * control reads as "render nothing / inert" so the portfolio build is visually unchanged.
 *
 * Pure — derived only from the passed plans; no storage, no DOM.
 */
export function distinctAuthors(plans: DayPlan[]): string[] {
  const names = new Set<string>();
  for (const plan of plans) {
    for (const item of plan.items ?? []) {
      if (item.updatedBy) names.add(item.updatedBy);
      if (item.createdBy) names.add(item.createdBy);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
