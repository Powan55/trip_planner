// Single on/off gate for the AI concierge chat feature. Mirrors
// `lib/firebase-config.ts`'s `isRemoteConfigured()` pattern: one module owns the env read and
// the on/off decision, so no other module reads `process.env.NEXT_PUBLIC_CONCIERGE_URL` directly.
//
// ABSENCE => the feature stays entirely inert (no trigger, no panel, no fetch). This is the
// DEFAULT state of every build today — the Worker (`worker/`) is not deployed yet
// (`worker/README.md`); the operator sets this var post-deploy. `NEXT_PUBLIC_*` so it's inlined at build
// time.

import { isDefaultTrip } from '@/core/trips';

/** The deployed Worker's URL, or '' when unset (the default, dormant state). */
export const CONCIERGE_URL = process.env.NEXT_PUBLIC_CONCIERGE_URL || '';

/** True only once the Worker is deployed and the env var set. */
export function isConciergeConfigured(): boolean {
  return Boolean(CONCIERGE_URL);
}

/**
 * ✅ THE CUSTOM-TRIP GATE, AND IT IS NOW DELIBERATELY OPEN.
 *
 * The precondition was **met, not bypassed**: on **2026-08-09** the owner deployed
 * `trip-planner-concierge` **v1.8.0** (Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`) to
 * https://trip-planner-concierge.official-shadowverse.workers.dev with its predeploy gate green
 * (typecheck + 104/104 worker tests), so the live system prompt is trip-aware and the constant was
 * flipped to `true`. Pinned by `lib/__tests__/travel-concierge-gating.test.ts`, which also records
 * the deploy — re-closing this means rolling the Worker back, and updating both together.
 *
 * WHY IT WAS CLOSED UNTIL THEN (keep this; it is the reason the flip is deploy-ordered). Deploys
 * here are manual and owner-run, so the client half and the Worker half land in the
 * same tree but reach users on different days. Before the deploy the live Worker's system prompt
 * was still the hardcoded Nepal × Japan persona fenced to 2026-12-09 → 2027-01-09, and unhiding
 * the panel then would not have delivered the ruling — it would ship the exact bug the gate
 * exists to prevent:
 * 1. the concierge answers an Iceland trip as a Kathmandu guide, and
 * 2. every plan change it proposes is dropped SILENTLY, because `validateOps`
 * only accepts dates that are in the ACTIVE trip's
 * `TRIP_DATES` and the model was fenced to a different trip's dates. The user sees a reply
 * with no proposal chip and no explanation — the failure class at full strength.
 *
 * One plain constant on purpose (not an env var, not a Settings toggle): the precondition is a
 * manual deploy, so the only person who can know it happened is the person who ran it.
 */
export const CONCIERGE_ON_CUSTOM_TRIPS = true;

/**
 * May the concierge mount for the trip that is active right now?
 *
 * THE ONE COPY of that rule: both mounts — `components/navbar.tsx` and
 * `components/travel-concierge.tsx` — call this instead of re-deriving it, so flipping the
 * constant above moves both, and neither can drift from the other. The remaining gates
 * (`isConciergeConfigured()` + an active traveler) stay inside `ConciergeChat` itself.
 */
export function isConciergeAllowedForActiveTrip(): boolean {
  return CONCIERGE_ON_CUSTOM_TRIPS || isDefaultTrip();
}
