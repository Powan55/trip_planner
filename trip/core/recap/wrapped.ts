/**
 * Trip Wrapped — the pure, framework-free derivation over EVERY existing read-only domain
 * (slice the M19 Phase-5 capstone; lives alongside `core/recap/model.ts`, the recap
 * module's home).: read-only, ZERO writes, no new persisted state, no new gateway key —
 * this file only COMPOSES existing pure selectors (`expensesToSpent`, `packingProgress`,
 * `docsCompletion`, `elapsedTripDates`/`isPostTrip`) into one headline-stat summary.
 *
 * FRAMEWORK-FREE: plain TypeScript — no React, no window, no clock, no storage.
 * `deriveWrapped(inputs, nowDateStr)` takes the already-resolved clock string (the component
 * owns the I/O boundary — same split as `core/recap/model.ts`) and every already-loaded domain
 * array; every function is TOTAL (a null/malformed domain array degrades that stat to its zero
 * value, never throws).
 */

import type { DayPlan, ItineraryCategory } from '@/lib/trip-data';
import type { Expense } from '@/core/budget/expenses';
import { expensesToSpent } from '@/core/budget/expenses';
import type { Leg } from '@/core/budget/model';
import type { JournalEntry } from '@/core/journal/model';
import type { PhotoMeta } from '@/core/photos/model';
import type { PackingItem } from '@/core/packing/model';
import { packingProgress } from '@/core/packing/model';
import type { DocItem } from '@/core/docs/model';
import { docsCompletion } from '@/core/docs/model';
import { TRIP_DATES } from '@/core/dates';
import { elapsedTripDates, isPostTrip } from '@/core/recap/model';

/** Honest gating for the entry card's copy: 'pre' (nothing elapsed yet), 'mid' ("so far"),
 * 'post' (the full "wrapped" — every trip day has happened). */
export type WrappedStatus = 'pre' | 'mid' | 'post';

export interface WrappedLegSpend {
  /** Total logged spend on this leg, in the leg's local currency. */
  total: number;
  /** The single highest-spend category on this leg, or `null` when nothing was logged. */
  topCategory: { category: ItineraryCategory; amount: number } | null;
}

export interface WrappedStats {
  status: WrappedStatus;
  /** Trip days that have already happened as of the clock (0..32). */
  daysElapsed: number;
  /** The fixed trip length (`TRIP_DATES.length`, currently 32). */
  totalTripDays: number;
  activitiesDone: number;
  activitiesPlanned: number;
  spend: Record<Leg, WrappedLegSpend>;
  journalCount: number;
  photoCount: number;
  packing: { checked: number; total: number };
  docs: { done: number; total: number };
}

/** Every already-loaded domain the wrapped summary composes — one array per existing store. */
export interface WrappedInputs {
  plans: readonly DayPlan[] | null | undefined;
  expenses: readonly Expense[] | null | undefined;
  journalEntries: readonly JournalEntry[] | null | undefined;
  photos: readonly PhotoMeta[] | null | undefined;
  packingItems: readonly PackingItem[] | null | undefined;
  docItems: readonly DocItem[] | null | undefined;
}

const LEGS: readonly Leg[] = ['nepal', 'japan'];

function emptyLegSpend(): WrappedLegSpend {
  return { total: 0, topCategory: null };
}

/**
 * Compose every existing read-only domain into ONE headline-stat summary. TOTAL: a null/
 * non-array domain input degrades that stat to its zero value (never throws), mirroring every
 * other pure selector in `core/`. `nowDateStr` gates `status` exactly like `isPostTrip` /
 * `elapsedTripDates` (a malformed clock ⇒ 'pre', 0 elapsed days — an unusable clock is never
 * "post-trip" nor "mid-trip", the same never-lie-about-progress invariant `isPostTrip` already
 * holds).
 */
export function deriveWrapped(inputs: WrappedInputs, nowDateStr: string): WrappedStats {
  const plans = Array.isArray(inputs.plans) ? inputs.plans : [];
  const elapsed = elapsedTripDates(nowDateStr);
  const status: WrappedStatus = isPostTrip(nowDateStr) ? 'post' : elapsed.length > 0 ? 'mid' : 'pre';

  let activitiesDone = 0;
  let activitiesPlanned = 0;
  for (const plan of plans) {
    if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.items)) continue;
    for (const item of plan.items) {
      if (item === null || typeof item !== 'object') continue;
      activitiesPlanned += 1;
      if (item.done === true) activitiesDone += 1;
    }
  }

  const spentInput = expensesToSpent(inputs.expenses);
  const spend: Record<Leg, WrappedLegSpend> = { nepal: emptyLegSpend(), japan: emptyLegSpend() };
  for (const leg of LEGS) {
    const total = spentInput.byLeg?.[leg] ?? 0;
    let top: WrappedLegSpend['topCategory'] = null;
    const cats = spentInput.byCategory?.[leg];
    if (cats) {
      for (const [category, amount] of Object.entries(cats) as Array<[ItineraryCategory, number]>) {
        if (typeof amount === 'number' && Number.isFinite(amount) && (top === null || amount > top.amount)) {
          top = { category, amount };
        }
      }
    }
    spend[leg] = { total, topCategory: top };
  }

  const journalCount = Array.isArray(inputs.journalEntries) ? inputs.journalEntries.length : 0;
  const photoCount = Array.isArray(inputs.photos) ? inputs.photos.length : 0;
  const packing = packingProgress(Array.isArray(inputs.packingItems) ? inputs.packingItems : []);
  const docs = docsCompletion(Array.isArray(inputs.docItems) ? inputs.docItems : []);

  return {
    status,
    daysElapsed: elapsed.length,
    totalTripDays: TRIP_DATES.length,
    activitiesDone,
    activitiesPlanned,
    spend,
    journalCount,
    photoCount,
    packing: { checked: packing.checked, total: packing.total },
    docs: { done: docs.done, total: docs.total },
  };
}
