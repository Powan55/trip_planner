/**
 * My-places domain: the pure, framework-free "imported Google place" core.
 * Gateway key 31 stores a `MyPlace[]` (`nepal_japan_my_places`), TRIP-SCOPED and — since the
 * D-229 addendum (issue #17) — SYNCED on a custom trip (the default sample pack has no remote id,
 * so it stays local-only there). The row therefore carries the Sync-v2 stamps (`rev`/`hlc`/
 * `deleted`); the merge itself lives in `core/places/merge.ts`, not here.
 *
 * FRAMEWORK-FREE: plain TypeScript — no
 * React, no window, no storage. Every function is TOTAL (a bad/missing/corrupt input degrades to
 * a safe value, never a throw). `id` generation + `addedAt` timestamping are I/O concerns and stay
 * in the domain hook (`hooks/use-my-places.ts`), NOT here — this module only shapes, sanitizes,
 * and transforms already-materialized places, and answers the two pure classification questions
 * (`inferLegId`, `isGooglePlaceUrl`).
 *
 * Parse-don't-validate: `myPlaceSchema` is the ONE read-boundary schema,
 * deliberately LENIENT — required id/name/legId/addedAt, everything else optional, unknown
 * keys pass through, so a place written by a future build is never dropped wholesale. `sanitizePlace`
 * then narrows a parsed value to a clean `MyPlace`, dropping an unparsable coord rather than the whole
 * place. Cap at 200 (`PLACES_CAP`), drop-oldest, newest-first — the value can never grow unbounded.
 * The cap is applied to LIVE rows and to TOMBSTONES separately (`capPlaces`): a tombstone that
 * counted against the 200 would silently evict a real place, and a merged list is mostly live rows.
 *
 * NO image field: og:image hotlinking is fragile/ToS-risky; card art is the vibe-gradient
 * + icon. The card links out to `resolvedUrl ?? sourceUrl`.
 */

import { z } from 'zod';
import type { TripConfig } from '@/core/trips/model';

/** Hard cap on stored places; overflow drops the oldest. */
export const PLACES_CAP = 200;

export interface MyPlace {
  id: string;
  /** Required, trimmed, non-empty display name. */
  name: string;
  /** Owning leg id — 'nepal' | 'japan' on the default pack; 'main' on a custom trip. */
  legId: string;
  /** The raw shared/pasted link (linkified on the card). */
  sourceUrl?: string;
  /** The Worker's resolved final URL when resolution succeeded (preferred link-out). */
  resolvedUrl?: string;
  lat?: number;
  lng?: number;
  note?: string;
  /** ISO-8601 instant the place was imported (set by the hook at add time). */
  addedAt: string;

  // ── Sync v2 stamps (issue #17). All optional and all ABSENT on the local-only path (the
  // default sample pack / a dormant build), so those bytes stay exactly as they were. Written
  // only by `hooks/use-my-places.ts` under `isTripRemoteConfigured()`.
  /** Monotonic per-row version. NOT the ordering key — `hlc` is. */
  rev?: number;
  /** The serialized HLC: the primary merge order key (`core/sync/hlc.ts`). */
  hlc?: string;
  /** Tombstone flag. A delete under sync flips this instead of dropping the row, so the
   * removal PROPAGATES; `useMyPlaces` filters tombstones out of the exposed list. */
  deleted?: boolean;
}

/**
 * Lenient read-boundary schema: required `id`/`name`/`legId`/`addedAt`, everything else
 * optional, unknown keys pass through. A value that fails even this is genuinely corrupt → dropped
 * by `sanitizePlace`.
 */
const myPlaceSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    legId: z.string().min(1),
    sourceUrl: z.string().optional(),
    resolvedUrl: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    note: z.string().optional(),
    addedAt: z.string().min(1),
    rev: z.number().optional(),
    hlc: z.string().optional(),
    deleted: z.boolean().optional(),
  })
  .passthrough();

/** Read-boundary options. Absent ⇒ STRICT: a caller that does not ask gets the allowlist rebuild. */
export interface SanitizeOptions {
  /**
   * Retain keys this build does not declare (#138 / D-374). Set ONLY on the REMOTE read, where the
   * sanitized row is merged and written straight back to Firestore. Never on a LOCAL path — the
   * rebuild is what keeps the zero-egress guarantee structural rather than a discipline.
   */
  keepUnknownKeys?: boolean;
}

/** A non-empty trimmed string, or `undefined`. Keeps blank/whitespace content out of storage. */
function cleanStr(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t === '' ? undefined : t;
}

/** A finite number, or `undefined`. Keeps NaN/Infinity/non-number coords out of storage. */
function cleanNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Narrow an unknown (a parsed-from-storage slot entry, or a freshly-built place) into a clean
 * `MyPlace`, or `null` when too malformed to salvage (no id, no name, no legId, or no addedAt).
 * An unparsable coord/url/note is DROPPED (the place survives) rather than rejecting the whole
 * place. TOTAL — never throws.
 *
 * ── UNDECLARED keys: DROPPED by default, kept only for `keepUnknownKeys` (#138 / D-374) ────────
 * The default is the declared-field rebuild this has always been, and `.passthrough()` on the
 * schema buys nothing downstream because of it. That is correct on every LOCAL path
 * (`loadMyPlaces`/`saveMyPlaces`, backup). It is NOT correct at the REMOTE read: `docToPlaceRows`'
 * output is merged and written straight back up by `pushPlacesMerged`, so the strict rebuild let an
 * older client erase a newer one's fields from the server on every sync. Under the flag the row is
 * built by spreading the source and normalizing each DECLARED field on top, so validation is
 * identical either way — only undeclared keys differ.
 */
export function sanitizePlace(value: unknown, opts: SanitizeOptions = {}): MyPlace | null {
  const parsed = myPlaceSchema.safeParse(value);
  if (!parsed.success) return null;
  const v = parsed.data;
  const id = v.id.trim();
  const name = v.name.trim();
  const legId = v.legId.trim();
  const addedAt = v.addedAt.trim();
  if (id === '' || name === '' || legId === '' || addedAt === '') return null;

  const place: MyPlace = {
    ...(opts.keepUnknownKeys ? (value as MyPlace) : ({} as Partial<MyPlace>)),
    id,
    name,
    legId,
    addedAt,
  };
  const sourceUrl = cleanStr(v.sourceUrl);
  const resolvedUrl = cleanStr(v.resolvedUrl);
  const note = cleanStr(v.note);
  const lat = cleanNum(v.lat);
  const lng = cleanNum(v.lng);
  if (sourceUrl !== undefined) place.sourceUrl = sourceUrl;
  else delete place.sourceUrl;
  if (resolvedUrl !== undefined) place.resolvedUrl = resolvedUrl;
  else delete place.resolvedUrl;
  if (note !== undefined) place.note = note;
  else delete place.note;
  if (lat !== undefined) place.lat = lat;
  else delete place.lat;
  if (lng !== undefined) place.lng = lng;
  else delete place.lng;
  // Sync stamps: declared so they SURVIVE the narrowing (unknown keys are dropped here despite
  // `.passthrough()` on the schema — an undeclared stamp would be stripped on every save and the
  // merge would lose its order key). `deleted:false` is normalized to absent: "no flag" is the
  // canonical live row, and the local-only path never writes the key at all.
  const rev = cleanNum(v.rev);
  const hlc = cleanStr(v.hlc);
  if (rev !== undefined) place.rev = rev;
  else delete place.rev;
  if (hlc !== undefined) place.hlc = hlc;
  else delete place.hlc;
  if (v.deleted === true) place.deleted = true;
  else delete place.deleted;
  return place;
}

/**
 * Apply `PLACES_CAP` to LIVE rows and to TOMBSTONES INDEPENDENTLY, so a tombstone can never
 * evict a real place (and the stored value still can't grow unbounded — it is bounded by 2×cap).
 * Under the cap on both counts the input array is returned VERBATIM, so the local-only path —
 * which never produces a tombstone — is byte-for-byte unchanged. Order is otherwise preserved;
 * both halves are already newest-first by the time they get here (`addPlace` prepends,
 * `mergePlaces` sorts), so slicing keeps the NEWEST. TOTAL.
 */
function capPlaces(rows: MyPlace[]): MyPlace[] {
  const live = rows.filter((p) => p.deleted !== true);
  if (live.length <= PLACES_CAP && rows.length === live.length) return rows;
  const dead = rows.filter((p) => p.deleted === true);
  return [...live.slice(0, PLACES_CAP), ...dead.slice(0, PLACES_CAP)];
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `MyPlace[]`, deduped by id (FIRST write
 * wins — the array is newest-first, so the first occurrence is the most recent), preserving order,
 * and capped to the newest `PLACES_CAP`. Returns `[]` for a non-array / all-corrupt input (the empty
 * collection is the honest first-load state). `opts` is threaded through unchanged; absent ⇒ strict
 * (see `sanitizePlace`). TOTAL — never throws.
 */
export function sanitizePlaces(value: unknown, opts: SanitizeOptions = {}): MyPlace[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, MyPlace>();
  for (const raw of value) {
    const place = sanitizePlace(raw, opts);
    if (place !== null && !byId.has(place.id)) byId.set(place.id, place);
  }
  return capPlaces(Array.from(byId.values()));
}

/**
 * Prepend a new place (newest-first), dropping any prior place with the same id, then cap to the
 * newest `PLACES_CAP` (drop-oldest). Returns a NEW array. TOTAL.
 *
 * Dropping the prior same-id row is also how an UNDO-of-delete works under sync: the caller
 * re-adds with the SAME id carrying a strictly-later `hlc`, which replaces the tombstone.
 */
export function addPlace(list: readonly MyPlace[], place: MyPlace): MyPlace[] {
  const base = Array.isArray(list) ? list : [];
  return capPlaces([place, ...base.filter((p) => p.id !== place.id)]);
}

/**
 * PHYSICALLY remove the place with `id` — the LOCAL-ONLY delete (default sample pack / dormant
 * build). Returns a NEW array; a non-matching id is a no-op. TOTAL.
 *
 * NOT the delete used under sync: a physical removal is indistinguishable from "this device has
 * not seen that row yet", so the peer's copy would re-enter on the next snapshot. `useMyPlaces`
 * writes a TOMBSTONE instead whenever `isTripRemoteConfigured()`.
 */
export function removePlace(list: readonly MyPlace[], id: string): MyPlace[] {
  const base = Array.isArray(list) ? list : [];
  return base.filter((p) => p.id !== id);
}

// ── Country/leg assignment ─────────────────────────────────────────
// Disjoint bounding boxes for the default pack's two legs. A resolved coordinate inside a box
// pre-selects that country's radio in the import sheet; a miss on both leaves it undetermined.
interface Bbox {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}
const NEPAL_BBOX: Bbox = { latMin: 26.3, latMax: 30.5, lngMin: 80.0, lngMax: 88.3 };
const JAPAN_BBOX: Bbox = { latMin: 24.0, latMax: 45.9, lngMin: 122.9, lngMax: 146.1 };

function inBbox(box: Bbox, lat: number, lng: number): boolean {
  return lat >= box.latMin && lat <= box.latMax && lng >= box.lngMin && lng <= box.lngMax;
}

/**
 * Infer the owning leg for a place from the active trip config + optional resolved coords.
 * TOTAL:
 * - a SINGLE-leg config (a custom trip) always returns that one leg's id (coords ignored — there is
 * no choice to make);
 * - the default pack (≥2 legs) uses disjoint point-in-bbox: a Nepal point ⇒ 'nepal', a Japan point
 * ⇒ 'japan', a miss on both (or absent coords) ⇒ `undefined` (the user picks in the sheet).
 */
export function inferLegId(config: TripConfig, lat?: number, lng?: number): string | undefined {
  const legs = config.legs;
  if (legs.length === 1) return legs[0].id;
  if (typeof lat !== 'number' || typeof lng !== 'number') return undefined;
  if (inBbox(NEPAL_BBOX, lat, lng)) return 'nepal';
  if (inBbox(JAPAN_BBOX, lat, lng)) return 'japan';
  return undefined;
}

// ── Google place-link host allow-list ────────────
// DUPLICATED from the Worker's `worker/src/resolve.ts` `isAllowedGoogleHost` on purpose: that
// copy is the actual security boundary (re-applied server-side to the resolved final URL before
// it's ever echoed back); THIS copy is a UX affordance — it decides whether "Look up" enables and
// whether the rejection line shows. The two lists must stay in agreement; widen one, widen the
// other. Anchored both ends so `evil-google.com` / `google.com.attacker.net` never match. The
// regex admits Google's ccTLD hosts (`google.co.jp`, `google.de`) because a share link copied on
// a phone abroad carries the local domain — a plain exact-match set silently rejected those.
const GOOGLE_HOST_RE = /^(www\.|maps\.)?google\.(com|co\.[a-z]{2}|[a-z]{2,3})$/;
const GOOGLE_SHORT_HOSTS: ReadonlySet<string> = new Set(['share.google', 'goo.gl', 'maps.app.goo.gl']);

/**
 * True iff `url` is an `https:` URL whose host is in the Google place-link allow-list. TOTAL —
 * a non-string / unparsable / non-https / foreign-host input returns `false`, never throws.
 */
export function isGooglePlaceUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (GOOGLE_SHORT_HOSTS.has(u.hostname) || GOOGLE_HOST_RE.test(u.hostname));
  } catch {
    return false;
  }
}
