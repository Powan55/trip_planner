/**
 * — pure ring-fraction derivation for the Home countdown's radial progress ring.
 * WRAPS (never reimplements) the existing countdown math: `computeCountdown` / `totalDays`
 * are untouched — this takes their OUTPUT and derives a presentational
 * 0..1 fraction only. No clock read.
 *
 * Formula: `1 - min(totalDays, horizonDays) / horizonDays` — the elapsed fraction of a
 * rolling `horizonDays`-day approach window (default 365, i.e. "how far through the last
 * year before departure are we"). The ring is empty (0) at `horizonDays`+ days out and
 * fills to exactly 1.0 the moment `totalDays` reaches 0 (departure) or the trip has
 * already started/passed (`isPast`). Clamped to [0, 1] defensively.
 */
export function ringFraction(totalDays: number, isPast: boolean, horizonDays = 365): number {
  if (isPast || totalDays <= 0) return 1;
  const frac = 1 - Math.min(totalDays, horizonDays) / horizonDays;
  return Math.max(0, Math.min(1, frac));
}
