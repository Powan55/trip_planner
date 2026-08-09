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
 * Every name an item is attributed to: its last editor, its original author, AND whoever
 * ticked it off.-B: `doneBy` was missing here, so a traveler who checked six things off
 * but authored none filtered to an EMPTY list — the filter silently denied that they had done
 * anything. `doneBy` is the same identity as `updatedBy` (both are the `getUserName()` display
 * nickname — see `lib/trip-data.ts`), so treating it as attribution is not a widening of the
 * data model, it is reading the field that was already there.
 */
function itemAuthors(item: ItineraryItem): (string | undefined)[] {
  return [item.updatedBy, item.createdBy, item.doneBy];
}

/**
 * Does an item belong to the given author? An item is "by" an author if ANY of its
 * `updatedBy` (last editor) / `createdBy` (original author) / `doneBy` (who ticked it off)
 * equals that name. Matching is exact (the attribution pipeline stamps a single canonical
 * display name).
 *
 * Pure — no storage, no DOM. `myName` / `myPriorNames` are injected (from lib/identity via
 * `useAuthorFilter`) so "My edits" stays testable and this module never imports identity.
 *
 *-C: "My edits" also matches the current user's PRIOR display names. Renaming yourself
 * used to split you into two people — the rename rewrites no stamps, so items stamped before it
 * stopped being "mine". Prior names are RECORDED AT RENAME TIME (`signIn`), never guessed: a
 * heuristic that inferred which stored name "is" you would alias a fellow traveller into your
 * identity, which is worse than the split. Consequence, stated plainly: a rename that ALREADY
 * happened is not repaired — there is no record of that old name to recover.
 *
 * @param item the item under test
 * @param filter the active filter
 * @param myName the current display name, or null/undefined if none is set
 * @param myPriorNames display names this same user previously went by
 */
export function itemMatchesAuthor(
  item: ItineraryItem,
  filter: AuthorFilter,
  myName: string | null | undefined,
  myPriorNames: readonly string[] = [],
): boolean {
  if (filter.kind === 'all') return true;
  // "My edits" with no name set (dormant / no-identity) matches nothing — but the
  // control never offers "My edits" without a name, so this is a defensive floor.
  if (filter.kind === 'mine' && !myName) return false;
  const targets =
    filter.kind === 'mine' ? [myName as string, ...myPriorNames] : [filter.name];
  return itemAuthors(item).some((a) => !!a && targets.includes(a));
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
  myPriorNames: readonly string[] = [],
): ItineraryItem[] {
  if (filter.kind === 'all') return items;
  return items.filter((i) => itemMatchesAuthor(i, filter, myName, myPriorNames));
}

/**
 * Derive the distinct author names present across ALL plans, from `updatedBy`, `createdBy`
 * AND `doneBy`. Used to build the per-author options. Sorted for a stable control order.
 * When NO item is attributed (the portfolio / dormant case) this returns `[]`, which the
 * control reads as "render nothing / inert" so the portfolio build is visually unchanged.
 *
 *
 *-B: `doneBy` is included here for the same reason it is in `itemMatchesAuthor` — a name
 * that can MATCH must also be OFFERABLE, or the traveler who only ticks things off is filterable
 * in principle and unreachable in the UI.
 *
 *-C: any of the current user's `myPriorNames` present in the data COLLAPSES into `myName`,
 * so a rename shows one chip for one human instead of two. Collapsing is display-only; the
 * stored stamps are untouched.
 *
 * Pure — derived only from the passed arguments; no storage, no DOM.
 */
export function distinctAuthors(
  plans: DayPlan[],
  myName?: string | null,
  myPriorNames: readonly string[] = [],
): string[] {
  const names = new Set<string>();
  for (const plan of plans) {
    for (const item of plan.items ?? []) {
      for (const a of itemAuthors(item)) {
        if (!a) continue;
        names.add(myName && myPriorNames.includes(a) ? myName : a);
      }
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}
