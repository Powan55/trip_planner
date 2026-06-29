// Tiny, PURE relative-time helper for the cross-friend attribution line.
//
// "by Mei · 2h ago" — the time portion is produced here from an ISO timestamp
// (`ItineraryItem.updatedAt`). Computed directly from `now - then` so it is
// FULLY PURE (the caller injects `now` in tests for determinism; the app defaults to
// the real clock). Deliberately NOT date-fns' `formatDistanceToNow*`, because those
// read the real clock internally (untestable with an injected now) and their unit
// thresholds ("14 days" vs "2 weeks") don't match the compact one-liner we want.
//
// Shape (defensive + compact):
//   - missing / invalid input  -> null (caller renders nothing)
//   - < 45s (incl. small clock-skew negatives) -> "just now"
//   - otherwise the largest sensible unit, abbreviated: "5m ago", "2h ago",
//     "3d ago", "2w ago", "4mo ago", "1y ago".

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY; // approximate, fine for a muted "ago" label
const YEAR = 365 * DAY;

/**
 * Format an ISO timestamp as a short relative-time string ("2h ago", "just now").
 * Returns null for a missing/invalid timestamp so callers can render nothing.
 *
 * @param iso   ISO 8601 timestamp (ItineraryItem.updatedAt), or undefined.
 * @param now   the reference instant (defaults to new Date()); injectable for tests.
 */
export function formatRelativeTime(iso: string | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const diffMs = now.getTime() - then.getTime();
  // Sub-45s (and small negative clock-skew) reads as "just now".
  if (diffMs < 45 * SEC) return 'just now';

  if (diffMs < HOUR) return `${Math.floor(diffMs / MIN)}m ago`;
  if (diffMs < DAY) return `${Math.floor(diffMs / HOUR)}h ago`;
  if (diffMs < WEEK) return `${Math.floor(diffMs / DAY)}d ago`;
  if (diffMs < MONTH) return `${Math.floor(diffMs / WEEK)}w ago`;
  if (diffMs < YEAR) return `${Math.floor(diffMs / MONTH)}mo ago`;
  return `${Math.floor(diffMs / YEAR)}y ago`;
}
