// Nickname sign-in — a free-text display name a traveler types to identify themselves.
//
// This is *soft* identity (display-only, intentionally spoofable). item 3
// retired the fixed 3-name roster: `resolveToken` now accepts ANY non-empty trimmed name
// (a reversion to the pre-M10 name-prompt validation), for every pack including the
// default. On sign-in we reuse the existing display-name pipeline (`setUserName` from
// /identity) so attribution (createdBy / updatedBy stamping, "last edited by X") needs
// zero changes. The name itself is persisted separately (the identity "token" slot) so
// the gate can recognise a returning traveler.
//
// NAMING: the capability secret is the "Trip Key" (settings-panel / handshake);
// this personal identity is a plain "nickname" — the two must never both be called a
// "token" in UI copy.
//
// This module is firebase-free and carries no auth credential — the unspoofable
// security id (anonymous-auth uid) is a separate, backend-greenlight-only concern and
// is NOT handled here.
//
// SSR-safe: every localStorage / window access is guarded by a `typeof window` check so
// these helpers are inert during static export / server render (return null / no-op).
// `resolveToken` is deliberately pure (no storage) so it can be unit-tested anywhere.

import { setUserName } from './identity';
import { identityStore } from '@/core/storage/gateway';

// the token key literal AND the raw localStorage access now live in
// the typed storage gateway (`core/storage/gateway.ts`). The duplicated
// `tripPlannerUserName` literal that used to sit here is gone — the cross-module clear on
// sign-out (token + name, owned by./identity) is `identityStore.clearIdentity()`, which
// clears BOTH keys. On-disk key strings and value shapes are unchanged.

/**
 * Same-tab reactive signal for identity changes. Mirrors the itinerary store's
 * `itinerary:changed` pattern: a sign-in/sign-out dispatches this CustomEvent on
 * `window` so the navbar chip, the gate, and the gated remote-subscribe re-evaluate LIVE
 * — without a manual reload. SSR-guarded at each call site (no-op when `window` is absent).
 */
export const IDENTITY_CHANGED_EVENT = 'identity:changed';

function emitIdentityChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(IDENTITY_CHANGED_EVENT));
}

export interface Traveler {
  /** Display name stamped onto items via the identity pipeline. */
  name: string;
  /** The trimmed nickname the traveler typed (persisted so a return visit is recognised). */
  token: string;
  /** On-brand accent for per-traveler tint/chip — deterministic hash of the name. */
  accent: string;
}

/**
 * The existing on-brand accent palette, drawn verbatim from the
 * three brand families in `tailwind.config.ts` (gold / sakura / himalaya, two shades each).
 * A nickname hashes deterministically into this fixed set — no per-person hardcoding, no
 * new dependency, no invented colours.
 */
const ACCENT_PALETTE = [
  '#f0c760', // gold 400 (brand primary)
  '#d4a843', // gold 500
  '#f7a0b3', // sakura 400
  '#ffb7c5', // sakura 300
  '#ff8c42', // himalaya 400
  '#e67635', // himalaya 500
] as const;

/**
 * Deterministic name → accent. Case-insensitive over the trimmed name so a
 * traveler keeps the same tint across sign-ins regardless of casing. Pure; safe anywhere.
 */
export function accentForName(name: string): string {
  const key = name.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return ACCENT_PALETTE[hash % ACCENT_PALETTE.length];
}

/**
 * The default expense-split roster (the three actual Nepal×Japan friends). This is NO LONGER
 * the sign-in gate — it survives ONLY as
 * the fixed member list the expense-split UI (`expense-dialog` / `settle-up-summary` /
 * `budget-panel`) offers on the default trip. Accents kept as the original brand tints so those
 * surfaces are visually unchanged. Out of this slice's scope to make dynamic.
 */
export const TRAVELERS: readonly Traveler[] = [
  { name: 'Powan', token: 'Powan', accent: '#f0c760' }, // gold (brand primary)
  { name: 'Sushil', token: 'Sushil', accent: '#f7a0b3' }, // sakura
  { name: 'Uttam', token: 'Uttam', accent: '#ff8c42' }, // himalaya
] as const;

/**
 * Resolve a raw nickname to a traveler, or null if it is empty/whitespace.
 * Any non-empty trimmed string is accepted — the name is preserved verbatim (only trimmed),
 * and its accent is the deterministic name-hash. Pure, no storage — safe anywhere (incl. SSR
 * / tests).
 */
export function resolveToken(raw: string): Traveler | null {
  const name = raw.trim();
  if (!name) return null;
  return { name, token: name, accent: accentForName(name) };
}

/**
 * Sign in with a raw nickname. On a non-empty name: persist the display name (via the
 * existing identity pipeline) and the name itself, then return the traveler. Returns null
 * only for an empty/whitespace input. No-op persistence during SSR or if storage fails.
 */
export function signIn(raw: string): Traveler | null {
  const traveler = resolveToken(raw);
  if (!traveler) return null;
  setUserName(traveler.name);
  identityStore.setToken(traveler.token);
  // Reactive signal: let the chip / gate / remote-subscribe pick up the sign-in
  // live. Dispatched after persistence so any listener that re-reads sees the new token.
  emitIdentityChanged();
  return traveler;
}

/**
 * Return the currently signed-in traveler by reading the persisted token, or null
 * if none is stored / it no longer resolves / during SSR.
 */
export function getActiveTraveler(): Traveler | null {
  const token = identityStore.getToken();
  return token ? resolveToken(token) : null;
}

/**
 * Sign out: clear the persisted token AND the display name via the gateway's
 * `clearIdentity` (which removes both keys 4 + 3 — the cross-module ownership the gateway
 * now centralizes; behavior byte-identical to the prior direct removals). Already-stamped
 * createdBy / updatedBy on stored items are historical and are NOT touched. No-op / never
 * throws during SSR or with disabled storage (handled inside the gateway).
 */
export function signOut(): void {
  identityStore.clearIdentity();
  // Reactive signal: re-show the gate + clear the chip + tear down remote-subscribe
  // live, no reload. Dispatched after the keys are cleared so listeners re-read "signed out."
  emitIdentityChanged();
}
