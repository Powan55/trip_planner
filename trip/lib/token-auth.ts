// Trip Token gate — maps a shared "Trip Token" to a known traveler identity.
//
// This is *soft* identity (display-only, intentionally spoofable). A token is just a
// shared word the three of us type to say "this is me"; on a match we reuse the
// existing display-name pipeline (`setUserName` from ./identity) so attribution
// (createdBy / updatedBy stamping, "last edited by X") needs zero changes. The token
// itself is persisted separately so the gate can recognise a returning traveler.
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

// The token key literal AND the raw localStorage access now live in
// the typed storage gateway (`core/storage/gateway.ts`). The duplicated
// `tripPlannerUserName` literal that used to sit here is gone — the cross-module clear on
// sign-out (token + name, owned by ./identity) is `identityStore.clearIdentity()`, which
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
  /** Shared word the traveler types to sign in (matched trim + case-insensitively). */
  token: string;
  /** On-brand accent for per-traveler tint/chip. */
  accent: string;
}

/** The known travelers. Token == name by design; accents are the three brand families. */
export const TRAVELERS: readonly Traveler[] = [
  { name: 'Powan', token: 'Powan', accent: '#f0c760' }, // gold (brand primary)
  { name: 'Sushil', token: 'Sushil', accent: '#f7a0b3' }, // sakura
  { name: 'Uttam', token: 'Uttam', accent: '#ff8c42' }, // himalaya
] as const;

/**
 * Resolve a raw token string to a traveler, or null if it matches none.
 * Pure: trims and matches case-insensitively against each traveler's `token`.
 * No storage access — safe to call anywhere (including during SSR / in tests).
 */
export function resolveToken(raw: string): Traveler | null {
  const candidate = raw.trim().toLowerCase();
  if (!candidate) return null;
  return TRAVELERS.find((t) => t.token.toLowerCase() === candidate) ?? null;
}

/**
 * Sign in with a raw token. On a valid token: persist the display name (via the
 * existing identity pipeline) and the token itself, then return the traveler.
 * Returns null on an invalid token. No-op persistence during SSR or if storage fails.
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
