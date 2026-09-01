// Nickname sign-in — a free-text display name a traveler types to identify themselves.
//
// This is *soft* identity (display-only, intentionally spoofable). item 3
// retired the fixed 3-name roster: `resolveToken` now accepts ANY non-empty trimmed name
//, for every pack including the
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
import { identityStore, wipeAllTripData } from '@/core/storage/gateway';
import { isDefaultTrip } from '@/core/trips';
import type { Expense } from '@/core/budget/expenses';

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

/**
 * The display name the token-only door falls back to when this device has none stored (
 * login-token-only amendment: the door does not collect a name).
 *
 * /: it is a TRANSIENT LOCAL PLACEHOLDER, not an identity. The account-identity
 * reconciler (`runAccountIdentitySync` in components/itinerary-provider) overwrites it with the
 * account's real name on the next page load, and MUST NEVER publish it — a device sitting on the
 * placeholder that backfilled it would make "Traveler" the whole account's name on every other
 * device. That rule needs the door and the reconciler to agree on the literal, so it lives here,
 * in the firebase-free identity module both already import, rather than as two copies that drift.
 */
export const DEFAULT_TRAVELER_NAME = 'Traveler';

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
 * The on-brand accent palette, a HAND-SYNCED COPY drawn verbatim from the three brand
 * families in `tailwind.config.ts` (gold / sakura / himalaya, two shades each). A nickname
 * hashes deterministically into this fixed set — no per-person hardcoding, no new
 * dependency, no invented colours.
 *
 * It is a copy with no compiler tie, so it MOVES WHEN THAT CONFIG MOVES or the app ships two
 * palettes. Re-valued here alongside the D-291/D-292/D-293 token layer. Every entry clears
 * AA as text on the page field, which matters because a traveller accent is rendered both as
 * a chip tint and as a dot fill. Those six numbers are not asserted here — all six pairings
 * are in `scripts/contrast-tokens.mjs` and run in CI, so a value that drifts fails a gate
 * rather than a comment.
 *
 * D-334 CHECKED THESE AND MOVED NONE OF THEM, which is worth writing down so the next
 * recolour does not re-derive it. The three brand families this mirrors are frozen in that
 * slice (only the CHROME accent and the surface ramp moved), so the six values still hold;
 * re-measured on the new, darker page field they read 12.25 / 6.07 / 9.28 / 11.62 / 8.30 /
 * 4.96 — every one up, none near the floor. They also stay well clear of the new chrome
 * accent: all six are warm (hues 24-42 and 330) and volt is 192, so a traveller tint can
 * never be mistaken for "this is pressable". `himalaya 600` at 4.96 is the tightest pair in
 * the whole harness and is the one that would bind first if the canvas is ever lightened.
 *
 * The two dark entries take the 400/600 pair, not 400/500: the 500 steps are frozen at the
 * retired values because lib/map-style.ts mirrors them (see the comment on the scales in
 * tailwind.config.ts). A traveller accent has nothing to do with the map, so it takes the
 * merged palette rather than inheriting that freeze.
 */
const ACCENT_PALETTE = [
  '#FFC43D', // gold 400     — marigold
  '#C08400', // gold 600     — the marigold lip
  '#FF8FC7', // sakura 400   — Japan pink
  '#FFB1D8', // sakura 300
  '#FF8A3D', // himalaya 400 — Nepal orange
  '#C2692E', // himalaya 600
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
 * The default expense-split roster — three FABRICATED demo travellers. This is NO LONGER
 * the sign-in gate — it survives ONLY as
 * the fixed member list the expense-split UI (`expense-dialog` / `settle-up-summary` /
 * `budget-panel`) offers on the default trip. Accents kept as the original brand tints so those
 * surfaces are visually unchanged. Out of this change's scope to make dynamic.
 */
export const TRAVELERS: readonly Traveler[] = [
  // Same three hand-assigned brand tints, re-valued with the families they name.
  { name: 'Alina', token: 'Alina', accent: '#FFC43D' }, // gold 400
  { name: 'Rhea', token: 'Rhea', accent: '#FF8FC7' }, // sakura 400
  { name: 'Milo', token: 'Milo', accent: '#FF8A3D' }, // himalaya 400
] as const;

/**
 * Accent for a split/settlement chip. A default-pack TRAVELER keeps its
 * fixed hand-assigned brand tint (so the default trip's split/settle surfaces are
 * PIXEL-IDENTICAL), any other name (a custom trip's derived roster) falls back to the
 * deterministic `accentForName` hash — no new colours. Case-insensitive match.
 */
export function rosterAccent(name: string): string {
  const match = TRAVELERS.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  return match?.accent ?? accentForName(name);
}

/**
 * The expense-split roster for the ACTIVE trip.
 *
 * Default pack → exactly the fixed `TRAVELERS` names (pixel-identical, zero behaviour change).
 * Custom trip → the distinct union, in first-seen order, of the current traveler's name ("me",
 * listed FIRST so a zero-expense custom trip still offers self to create the first split) and
 * every name that appears in the trip's expense history: each expense's `paidBy`, its `split[]`
 * members, and `createdBy`. De-dupe is case-insensitive (first-seen casing wins), matching the
 * presence bar's name-collapse. No active traveler on a custom trip with no expenses ⇒
 * an empty roster — the same honest degrade the default trip's split UI has always shown
 * (no new UI); the /plan gate makes a signed-in traveler the norm.
 *
 * Reads `isDefaultTrip()` + `getActiveTraveler()` (the gateway pointer + identity slot) — callers
 * already sit behind the client-only expense surfaces, and SSR resolves the default pack.
 */
export function rosterForActiveTrip(expenses: readonly Expense[]): string[] {
  if (isDefaultTrip()) return TRAVELERS.map((t) => t.name);

  const seen = new Set<string>();
  const roster: string[] = [];
  const add = (raw: string | undefined | null) => {
    const name = raw?.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    roster.push(name);
  };

  add(getActiveTraveler()?.name); // "me" first — the zero-expense self case
  for (const e of expenses) {
    add(e.paidBy);
    if (Array.isArray(e.split)) for (const m of e.split) add(m);
    add(e.createdBy);
  }
  return roster;
}

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
 *
 *-C — this is also the ONE place a rename happens. Every rename path routes through here
 * (the Settings rename form, and the account-identity reconciler ADOPTING a name renamed on
 * another device, `itinerary-provider.tsx`), so recording the outgoing name here covers both
 * without either call site knowing about it. Renaming rewrites no `createdBy`/`updatedBy`
 * stamps, so without this the user's own pre-rename items stopped being "theirs" and they
 * appeared twice in the traveller filter.
 *
 * ⚖️ It is safe to treat "a name is already stored and it differs" as a rename rather than as a
 * DIFFERENT person signing in: the front door only renders when there is no active traveler,
 * and `signOut` clears the name with the token. Recording only here — and never inferring an
 * alias from stored attribution — is what stops a fellow traveller's name being absorbed into
 * this identity.
 */
export function signIn(raw: string): Traveler | null {
  const traveler = resolveToken(raw);
  if (!traveler) return null;
  const outgoing = identityStore.getName();
  if (outgoing && outgoing !== traveler.name) identityStore.addPriorName(outgoing);
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
 * Sign out: a FULL LOCAL TEARDOWN, not just an identity clear — a shared/handed-down
 * device must not leak the previous traveler's trip names, dates, itinerary, budget, journal or
 * account/sync pointers to the next person. Clears, in order:
 * 1. Identity (`identityStore.clearIdentity()` — keys 3 + 4).
 * 2. Every trip-scoped domain in BOTH namespaces + the app-scoped pointers/lists + `travelMode`
 * (`wipeAllTripData()` — see `core/storage/gateway.ts` for the full list and the reasoning).
 * 3. The reactive signal (step 4 below).
 *
 * ORDERING IS LOAD-BEARING: the wipe runs BETWEEN `clearIdentity()` and `emitIdentityChanged()`.
 * Emitting first would re-render every listener (the gate, the chip, the remote-subscribe teardown)
 * against HALF-DELETED state. Already-stamped createdBy / updatedBy on data written before this
 * sign-out are historical and are not (and cannot be) touched.
 *
 * Deliberately does NOT reload here — mirrors (a trip-pointer switch's pure function doesn't
 * reload either; the UI CALLER does, after this returns) so this stays a plain, SSR-safe, always-
 * unit-testable function. Every call site (Settings identity row, the navbar desktop chip, the
 * mobile `/more/` row) confirms first via `<SignOutConfirm>`, which reloads after calling this
 * (Ruling 3 — the local domain stores only re-read on their own event or a cross-tab `storage`
 * event, which never fires in the tab that made the write, so a reload is what makes every mounted
 * store stop showing stale data).
 *
 * No-op / never throws during SSR or with disabled storage (handled inside the gateway).
 */
export function signOut(): void {
  // #10 — deliberately does NOT sign out of Firebase: the anonymous uid is DEVICE identity, not
  // account identity, and dropping it would orphan this device's entry in every trip's members map.
  identityStore.clearIdentity();
  wipeAllTripData();
  // Reactive signal: re-show the gate + clear the chip + tear down remote-subscribe
  // live. Dispatched after every key is cleared so listeners re-read "signed out" against
  // fully-torn-down state, never half-deleted.
  emitIdentityChanged();
}
