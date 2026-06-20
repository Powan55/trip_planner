import type { DayPlan } from './trip-data';
import { SAMPLE_ITINERARY } from './sample-itinerary';

/**
 * Single source of truth for the itinerary localStorage contract.
 *
 * The calendar planner and the dashboard MUST both go through these helpers so they
 * agree on exactly when SAMPLE_ITINERARY is seeded vs. when stored data is respected.
 *
 * The key insight: distinguish three states by the KEY, not by array length —
 *   1. key ABSENT          -> first visit / never saved -> seed SAMPLE_ITINERARY.
 *   2. key PRESENT & valid  -> return it AS-IS, even when it is an empty array [].
 *   3. key PRESENT but corrupt / non-array / parse error -> fall back to SAMPLE_ITINERARY.
 *
 * A deliberately-emptied itinerary ([]) is a legitimate, persisted state and must
 * survive reloads — it must NOT be treated as "no data" and overwritten with samples.
 */
export const ITINERARY_STORAGE_KEY = 'nepal_japan_itinerary';

/**
 * Load itinerary plans from localStorage.
 *
 * - SSR / non-browser: returns SAMPLE_ITINERARY (no window) so first paint matches
 *   the post-hydration "first visit" state.
 * - Key absent or unreadable / unparseable / not an array: SAMPLE_ITINERARY.
 * - Key present and parses to an array (including []): that array, verbatim.
 */
export function loadPlans(): DayPlan[] {
  if (typeof window === 'undefined') return SAMPLE_ITINERARY;
  try {
    const raw = window.localStorage.getItem(ITINERARY_STORAGE_KEY);
    // Key absent -> never saved -> seed sample data.
    if (raw === null) return SAMPLE_ITINERARY;
    const parsed = JSON.parse(raw);
    // Key present: respect it as-is when it is an array (even an empty one).
    if (Array.isArray(parsed)) return parsed as DayPlan[];
    // Present but not an array (corrupt): fall back to sample data.
    return SAMPLE_ITINERARY;
  } catch {
    // Unreadable / unparseable: fall back to sample data.
    return SAMPLE_ITINERARY;
  }
}

/**
 * Persist itinerary plans to localStorage.
 *
 * Always writes — including an empty array — so "delete everything" is a durable
 * state. No length gate. SSR-safe no-op when there is no window.
 */
export function savePlans(plans: DayPlan[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(plans));
  } catch {
    /* ignore (quota / disabled storage) */
  }
}
