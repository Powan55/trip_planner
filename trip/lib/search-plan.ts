import type { DayPlan, ItineraryItem } from './trip-data';

/**
 * Search-within-plan matcher. Pure, React-free, no runtime imports beyond
 * types — safe to call from both `/plan` (live `plans` from context) and the
 * command palette (an on-demand `loadPlans()` snapshot taken outside the
 * provider). Read-only by construction: it only reads `plans` and returns new
 * result objects, never mutates the input.
 */
export interface PlanSearchResult {
  item: ItineraryItem;
  date: string;
}

// Rank: a title hit beats a notes hit beats a category-only hit. Keeps the
// simplest deterministic ordering — no fuzzy-search dependency (a
// scoring library would be overkill for a 3-field substring match).
export function searchPlanItems(plans: DayPlan[], query: string): PlanSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const ranked: Array<{ result: PlanSearchResult; rank: number }> = [];
  for (const plan of plans) {
    for (const item of plan.items ?? []) {
      // Tombstones are retained for up to 30 days so a delete can propagate and win, and the
      // command palette reads a raw `loadPlans()` snapshot from outside the provider — so the
      // provider's own `visiblePlans` filter never runs on it. Without this a deleted item stayed
      // searchable for a month and selecting it routed to a `?focus=` id nothing could match
      // (#121). `/plan` passes already-filtered plans, where this is a no-op.
      if (item.deleted === true) continue;
      const rank = matchRank(item, q);
      if (rank !== null) ranked.push({ result: { item, date: plan.date }, rank });
    }
  }
  ranked.sort((a, b) => a.rank - b.rank);
  return ranked.map((r) => r.result);
}

function matchRank(item: ItineraryItem, q: string): number | null {
  if (item.title.toLowerCase().includes(q)) return 0;
  if (item.notes && item.notes.toLowerCase().includes(q)) return 1;
  if (item.category && item.category.toLowerCase().includes(q)) return 2;
  return null;
}
