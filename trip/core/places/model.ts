/**
 * My-places domain — the pure, framework-free "imported Google place" core (slice plan
 * `docs/plans/place-link-import-plan.md`). Gateway key 31 stores a `MyPlace[]`
 * (`nepal_japan_my_places`), TRIP-SCOPED + LOCAL-ONLY.
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
  })
  .passthrough();

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
 */
export function sanitizePlace(value: unknown): MyPlace | null {
  const parsed = myPlaceSchema.safeParse(value);
  if (!parsed.success) return null;
  const v = parsed.data;
  const id = v.id.trim();
  const name = v.name.trim();
  const legId = v.legId.trim();
  const addedAt = v.addedAt.trim();
  if (id === '' || name === '' || legId === '' || addedAt === '') return null;

  const place: MyPlace = { id, name, legId, addedAt };
  const sourceUrl = cleanStr(v.sourceUrl);
  const resolvedUrl = cleanStr(v.resolvedUrl);
  const note = cleanStr(v.note);
  const lat = cleanNum(v.lat);
  const lng = cleanNum(v.lng);
  if (sourceUrl !== undefined) place.sourceUrl = sourceUrl;
  if (resolvedUrl !== undefined) place.resolvedUrl = resolvedUrl;
  if (note !== undefined) place.note = note;
  if (lat !== undefined) place.lat = lat;
  if (lng !== undefined) place.lng = lng;
  return place;
}

/**
 * Normalize an unknown (a parsed storage slot) into a valid `MyPlace[]`, deduped by id (FIRST write
 * wins — the array is newest-first, so the first occurrence is the most recent), preserving order,
 * and capped to the newest `PLACES_CAP`. Returns `[]` for a non-array / all-corrupt input (the empty
 * collection is the honest first-load state). TOTAL — never throws.
 */
export function sanitizePlaces(value: unknown): MyPlace[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, MyPlace>();
  for (const raw of value) {
    const place = sanitizePlace(raw);
    if (place !== null && !byId.has(place.id)) byId.set(place.id, place);
  }
  return Array.from(byId.values()).slice(0, PLACES_CAP);
}

/**
 * Prepend a new place (newest-first), dropping any prior place with the same id, then cap to the
 * newest `PLACES_CAP` (drop-oldest). Returns a NEW array. TOTAL.
 */
export function addPlace(list: readonly MyPlace[], place: MyPlace): MyPlace[] {
  const base = Array.isArray(list) ? list : [];
  return [place, ...base.filter((p) => p.id !== place.id)].slice(0, PLACES_CAP);
}

/** Remove the place with `id`. Returns a NEW array; a non-matching id is a no-op. TOTAL. */
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

// ── Google place-link host allow-list ───────────────────────────
// Exact-match host set (no suffix matching) for a shareable Google place link. Shared by the import
// sheet's paste-a-link entry and the /share inbox row's "Import as place" action.
const GOOGLE_PLACE_HOSTS: ReadonlySet<string> = new Set([
  'share.google',
  'goo.gl',
  'maps.app.goo.gl',
  'google.com',
  'www.google.com',
  'maps.google.com',
]);

/**
 * True iff `url` is an `https:` URL whose host is in the Google place-link allow-list. TOTAL —
 * a non-string / unparsable / non-https / foreign-host input returns `false`, never throws.
 */
export function isGooglePlaceUrl(url: unknown): boolean {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && GOOGLE_PLACE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
