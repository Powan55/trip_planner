// (open item B) — bulk move + Undo, in the one place a test can reach.
//
// Bulk move was the only destructive bulk action with no Undo; its two siblings (bulk delete,
// clear day) both have one. They build theirs with the house pattern — capture the payload in a
// closure BEFORE mutating, then hand a restore closure to `showUndoToast` — and this does the
// same, with one difference that is the entire point of the file:
//
// 🔴 THE INVERSE IS BUILT FROM THE LANDED IDS, NEVER THE ORIGINAL ONES. Under sync
// `moveItems` tombstones the source copy and adds a FRESHLY MINTED id at the target, so an
// inverse addressed by the original id resolves a tombstone and does nothing — the toast appears
// and the data stays put. That is the bug-A fixed on the concierge's single-item move, and
// `moveItems` now returns the landed ids precisely so this cannot be reintroduced.
//
// It lives HERE rather than inline in `calendar-planner.tsx` for one reason: the mandated
// discriminating test (`lib/__tests__/use-itinerary-bulk-sync.test.ts` — "the undo puts the items
// BACK") has to drive the REAL inverse construction against the REAL store with sync on, and the
// planner component cannot be mounted in jsdom. Inline, the only thing coverable would be the
// store contract, and the defect class this guards against is a WRONG CALLER over a right store.
//
// Minting another fresh id on undo is correct and matches `restoreDay`: nothing downstream depends
// on id stability across an undo.

import type { ItineraryStore } from '@/hooks/use-itinerary';
import { showUndoToast } from '@/lib/undo-toast';

/**
 * Move `itemIds` from `fromDate` to `toDate` and offer a single Undo that moves whatever
 * actually landed back. A no-op when nothing moved (every target refused by the store guards),
 * so an Undo toast is never shown over an unchanged itinerary.
 */
export function bulkMoveWithUndo(
  moveItems: ItineraryStore['moveItems'],
  itemIds: string[],
  fromDate: string,
  toDate: string,
): void {
  const landed = moveItems(
    itemIds.map((itemId) => ({ itemId, fromDate })),
    toDate,
  );
  if (landed.length === 0) return;
  showUndoToast(`Moved ${landed.length} item${landed.length === 1 ? '' : 's'}`, () => {
    moveItems(
      landed.map((itemId) => ({ itemId, fromDate: toDate })),
      fromDate,
    );
  });
}
