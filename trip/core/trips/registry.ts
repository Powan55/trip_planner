/**
 * Known-trips registry — the data layer that remembers every trip this browser has
 * created or joined, with a user-visible name. Backed by gateway key 26 (`tripPlannerKnownTrips`,
 * APP-SCOPED raw-string transport); ALL shape/sanitize/policy logic lives HERE.
 *
 * `joinTrip` is the ONE shared entry point every active-trip pointer write flows through, so no
 * future surface can switch trips without registering them. It does NOT reload — the caller
 * performs the full page reload.
 *
 * Trip NAME is local-only in this change (no Firestore sync). (/trips hub) and (home
 * trip strip) consume `listKnownTrips()`.
 */
import {
  DEFAULT_TRIP_ID,
  getActiveTripId,
  setActiveTripId,
  getDefaultTripShareId,
  setDefaultTripShareId,
  defaultPackHasSyncedData,
  dropDefaultPackSyncedData,
  getKnownTripsRaw,
  setKnownTripsRaw,
  getRemovedTripsRaw,
  setRemovedTripsRaw,
  getSyncCode,
  wipeTripData,
  keyForTrip,
  readJson,
  isSafeTripSegment,
} from '@/core/storage/gateway';
import { outboxDirty, type SyncDomain } from '@/core/sync/outbox';
// Type only — `lib/city-coords.ts` is a leaf module (no imports of its own), so this does not
// pull the map/weather bundles in. #250: a custom trip's resolved city coordinates live HERE, on
// the trip's own record, never written into that shared table.
import type { CityCoord } from '@/lib/city-coords';

/**
 * Per-trip user config for a CUSTOM (non-default-pack) trip. Lives INSIDE the
 * TripMeta entry (gateway key 26) — NO new storage key. `core/trips/custom.ts` synthesizes a
 * single-leg `TripConfig` from this. `updatedAt` is the config's own LWW stamp.
 */
export type TripConfigBlock = {
  start: string;
  end: string;
  destinations: string[];
  vibe: string;
  currency?: string;
  /**
   * #250 — one-shot geocoded coordinates for this trip's OWN destinations, keyed by the exact
   * destination string. Populated lazily by `lib/city-geocode.ts` (Nominatim, via
   * `lib/world-search.ts`'s existing throttled wrapper) after trip creation, never on the
   * weather-fetch path. ADDITIVE + OPTIONAL — absent on every config that predates this field,
   * and on any destination not yet resolved. This is the trip's own cache, not a second copy of
   * `lib/city-coords.ts`'s shared table.
   */
  cityCoords?: Record<string, CityCoord>;
  updatedAt: number;
};

export type TripMeta = {
  id: string;
  name: string;
  joinedAt: number;
  /** Entry-level LWW stamp for name/config changes. ADDITIVE — absent on pre- entries. */
  updatedAt?: number;
  /** Custom-trip config. Absent for the default pack + join-by-key (which use a pack). */
  config?: TripConfigBlock;
};

/**
 * A trip-forget tombstone. `id` is the forgotten trip's id; `removedAt` is the local
 * `Date.now()` at the moment of forgetting — the LWW stamp the Sync-Code merge compares against a
 * trip entry's own recency to decide "stay forgotten" vs "a re-join beats a stale tombstone".
 */
export type RemovedTrip = { id: string; removedAt: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Inclusive day cap on a custom trip's span — the ONE source for both the validator below and the
 * create form (`components/trips-hub.tsx`), so the two cannot drift.
 *
 * There has to be a cap at all because every consumer treats the span as a length it materialises:
 * `TRIP_DATES` and `buildDayShells` produce one entry per day, ~15 components render one node per
 * entry, and `reconcileFirstSnapshot`'s seed branch pushes ONE FIRESTORE DOCUMENT PER DAY against a
 * free-tier write ceiling. A one-digit year typo (`2027` → `2227`) is 73k days, ~4.3 MB of shells,
 * and 73k writes. 730 is two years: past any real trip, and small enough that the worst case is
 * survivable rather than a wedged account.
 */
export const TRIP_DAYS_MAX = 730;

const DAY_MS = 86_400_000;

/**
 * `YYYY-MM-DD` → UTC midnight ms, or `NaN` when the string is ISO-SHAPED but not a real day.
 * `ISO_DATE` alone accepts `2026-13-45`, which `new Date` silently rolls over to 2027-02-14 (or,
 * with the `T00:00:00` suffix the date backbone uses, becomes an Invalid Date and yields an EMPTY
 * `TRIP_DATES` — the state ~15 unguarded `TRIP_DATES[0]` readers crash on). The round-trip compare
 * is what distinguishes "a real day" from "digits in the right places".
 */
function isoDayMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d
    ? ms
    : NaN;
}

/**
 * Validate a stored/caller config block — returns a clean `TripConfigBlock` or `undefined` when
 * malformed (the ENTRY is kept, only its bad config is dropped — Plan D1). TOTAL, never throws.
 *
 * This is the trust boundary ALL FOUR config sources funnel through (create form, peer trip-meta
 * doc, synced trip list, hand-edited storage), so the real-date and span checks live here rather
 * than at any one of them.
 */
export function sanitizeTripConfig(raw: unknown): TripConfigBlock | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  if (typeof c.start !== 'string' || !ISO_DATE.test(c.start)) return undefined;
  if (typeof c.end !== 'string' || !ISO_DATE.test(c.end)) return undefined;
  if (c.end < c.start) return undefined;
  const startMs = isoDayMs(c.start);
  const endMs = isoDayMs(c.end);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return undefined;
  if ((endMs - startMs) / DAY_MS + 1 > TRIP_DAYS_MAX) return undefined;
  if (!Array.isArray(c.destinations)) return undefined;
  const destinations = c.destinations
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    .map((d) => d.trim());
  if (destinations.length === 0) return undefined;
  if (typeof c.vibe !== 'string' || c.vibe.trim().length === 0) return undefined;
  const out: TripConfigBlock = {
    start: c.start,
    end: c.end,
    destinations,
    vibe: c.vibe.trim(),
    updatedAt: typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt) ? c.updatedAt : 0,
  };
  if (typeof c.currency === 'string' && c.currency.trim().length > 0) out.currency = c.currency.trim();
  const cityCoords = sanitizeCityCoords(c.cityCoords);
  if (cityCoords) out.cityCoords = cityCoords;
  return out;
}

/** Validate a raw `cityCoords` map: drop any entry whose key is empty or whose coordinate isn't a
 *  finite, in-range lat/lng. `undefined` when nothing survives, so an empty/malformed map never
 *  adds a bare `{}` to the sanitized block. TOTAL, never throws.
 *
 *  The bounds arithmetic is the same as `ranged` (core/vault/item-schema.ts), but the RULE is not,
 *  and merging them would be a bug: `ranged` blanks ONE OPTIONAL field and keeps its row, whereas
 *  `CityCoord` has no optional half — blanking a latitude here hands `lib/weather.ts` a coordinate
 *  with one side missing. So a bad number takes its whole city entry with it, and the other cities
 *  survive. */
function sanitizeCityCoords(raw: unknown): Record<string, CityCoord> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, CityCoord> = {};
  for (const [city, v] of Object.entries(raw as Record<string, unknown>)) {
    // `__proto__` arrives as a real own property out of `JSON.parse`, but assigning it hits the
    // `Object.prototype` setter instead of defining a key, so a well-formed coord under that name
    // would REPLACE the prototype of the map we return. Same skip, and the same reason, as the two
    // loops in `core/budget/model.ts` (D-307 family) — this one was missing it (#439).
    if (city === '__proto__') continue;
    if (!city.trim() || v === null || typeof v !== 'object') continue;
    const { latitude, longitude } = v as Record<string, unknown>;
    if (
      typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
    ) {
      out[city] = { latitude, longitude };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Default-pack display name (until renamed). */
const DEFAULT_NAME = 'Nepal × Japan';
/**
 * Fallback name for a trip registered without one (join-by-key, pre-registry self-heal).
 * Exported so the trip-meta self-heal (`lib/trips-remote.ts` caller) can tell "still the
 * placeholder" from "the user already renamed it" without duplicating the literal.
 */
export const SHARED_NAME = 'Shared trip';

/**
 * Validate ONE raw entry into a clean `TripMeta`, or `undefined` when malformed. TOTAL, never throws.
 * Base entry is byte-identical to pre- (3 keys). The additive fields (`updatedAt`, `config`) are
 * attached ONLY when valid/present, so a config-less trip serializes to the exact same 3-key object
 * as before. Shared by the local-store parse below AND the remote-list merge (`mergeTripLists`).
 *
 * #476 — that sharing is why the id is shape-checked HERE and not only at the join: a synced list
 * is a trust boundary of its own. An entry merged in with an id like `A/B/C` never passes through
 * `joinTrip` or `getTripId()`, but `ensureKnownTripMemberships` maps it straight to
 * `doc(db, 'trips', 'A/B/C')` — an even segment count, so a VALID ref that does not throw — and the
 * members map then lands under a document the rules authorize against trip `A`. Dropping the entry
 * also retires the chip such a trip would otherwise draw in the hub, which no join could honour.
 */
/** Read-boundary option, same shape/intent as `core/places/model.ts`'s (D-374): retain keys this
 *  build does not declare, so a merge-and-write-back never strips a newer client's field. */
export interface SanitizeOptions {
  keepUnknownKeys?: boolean;
}

export function sanitizeTripMetaEntry(e: unknown, opts: SanitizeOptions = {}): TripMeta | undefined {
  if (
    typeof e !== 'object' ||
    e === null ||
    typeof (e as TripMeta).id !== 'string' ||
    !isSafeTripSegment((e as TripMeta).id) || // subsumes the old `.length === 0` check
    typeof (e as TripMeta).name !== 'string' ||
    (e as TripMeta).name.length === 0 ||
    typeof (e as TripMeta).joinedAt !== 'number' ||
    !Number.isFinite((e as TripMeta).joinedAt)
  ) {
    return undefined;
  }
  const { id, name, joinedAt } = e as TripMeta;
  const entry: TripMeta = {
    ...(opts.keepUnknownKeys ? (e as TripMeta) : ({} as Partial<TripMeta>)),
    id,
    name,
    joinedAt,
  };
  const rawUpdatedAt = (e as TripMeta).updatedAt;
  if (typeof rawUpdatedAt === 'number' && Number.isFinite(rawUpdatedAt)) entry.updatedAt = rawUpdatedAt;
  else delete entry.updatedAt; // a malformed stamp must not survive the keepUnknownKeys spread — entryRecency compares it
  const config = sanitizeTripConfig((e as TripMeta).config);
  if (config) entry.config = config;
  else delete entry.config; // ditto: a junk config must not survive the spread
  return entry;
}

/** Parse + sanitize the stored list: drop malformed entries, dedupe by id (first wins). */
function readStored(): TripMeta[] {
  const raw = getKnownTripsRaw();
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TripMeta[] = [];
  for (const e of parsed) {
    const entry = sanitizeTripMetaEntry(e);
    if (entry && !out.some((t) => t.id === entry.id)) out.push(entry);
  }
  return out;
}

function writeStored(trips: TripMeta[]): void {
  setKnownTripsRaw(JSON.stringify(trips));
}

/** Validate ONE raw tombstone into a clean `RemovedTrip`, or `undefined`. TOTAL, never throws. */
export function sanitizeRemovedEntry(e: unknown): RemovedTrip | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const r = e as RemovedTrip;
  if (typeof r.id !== 'string' || r.id.length === 0) return undefined;
  if (typeof r.removedAt !== 'number' || !Number.isFinite(r.removedAt)) return undefined;
  return { id: r.id, removedAt: r.removedAt };
}

/** Parse + sanitize the stored tombstone list: drop malformed, dedupe by id keeping the LWW-newest. */
function readRemoved(): RemovedTrip[] {
  const raw = getRemovedTripsRaw();
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...mergeRemovedSets(parsed)].map(([id, removedAt]) => ({ id, removedAt }));
}

function writeRemoved(removed: RemovedTrip[]): void {
  setRemovedTripsRaw(JSON.stringify(removed));
}

/** Every current forget-tombstone this browser holds (pure read). */
export function listRemovedTrips(): RemovedTrip[] {
  return readRemoved();
}

/**
 * A trip entry's recency for the tombstone race: the later of its rename stamp (`updatedAt`) and its
 * (re-)join stamp (`joinedAt`). A plain re-join goes through `upsertKnownTrip`, which stamps a fresh
 * `joinedAt` but NO `updatedAt` (stamping `updatedAt` on join would wrongly win name-LWW), so
 * `joinedAt` is the signal that "this trip was re-joined after the tombstone". Either beating
 * `removedAt` revives the trip.
 */
function entryRecency(e: TripMeta): number {
  return Math.max(e.updatedAt ?? 0, e.joinedAt);
}

/**
 * Fold any number of raw tombstone lists into an id→removedAt map, LWW by `removedAt` (higher wins).
 * The DEFAULT pack is excluded in BOTH directions (it is never in the synced list, so it is never
 * tombstoned). Malformed entries are dropped (`sanitizeRemovedEntry`). Pure, no I/O.
 */
function mergeRemovedSets(...lists: unknown[][]): Map<string, number> {
  const map = new Map<string, number>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const e = sanitizeRemovedEntry(raw);
      if (!e || e.id === DEFAULT_TRIP_ID) continue;
      const prev = map.get(e.id);
      if (prev === undefined || e.removedAt > prev) map.set(e.id, e.removedAt);
    }
  }
  return map;
}

/**
 * Every trip this browser knows, default pack ALWAYS first (name `'Nepal × Japan'` unless
 * renamed — synthesized when not stored, so it needs no seeding). The default entry is the
 * LOCAL-ONLY SAMPLE (#10): it has no remote path and never syncs; it exists so every browser
 * opens onto something. Self-heals: an active trip missing from the list (joined before the
 * registry existed) is upserted as `'Shared trip'`.
 */
export function listKnownTrips(): TripMeta[] {
  const active = getActiveTripId();
  if (active !== DEFAULT_TRIP_ID && !readStored().some((t) => t.id === active)) {
    upsertKnownTrip(active, SHARED_NAME); // self-heal: persist the pre-registry trip
  }
  const stored = readStored();
  const def =
    stored.find((t) => t.id === DEFAULT_TRIP_ID) ??
    ({ id: DEFAULT_TRIP_ID, name: DEFAULT_NAME, joinedAt: 0 } as TripMeta);
  return [def, ...stored.filter((t) => t.id !== DEFAULT_TRIP_ID)];
}

/** A single stored trip by id (pure read, no self-heal side effect). Undefined when unknown. */
export function getKnownTrip(id: string): TripMeta | undefined {
  return readStored().find((t) => t.id === id);
}

/**
 * #250 — the ACTIVE trip's own resolved coordinate for a city, or `undefined` when this trip has
 * none stored yet (a config-less/default trip, or a destination never geocoded). Callers
 * (`lib/weather.ts` via its `coordsOverride` param) fall back to `lib/city-coords.ts`'s static
 * table on `undefined` — this is the trip-specific override, never a second table of its own.
 */
export function getActiveTripCityCoord(city: string): CityCoord | undefined {
  const coords = getKnownTrip(getActiveTripId())?.config?.cityCoords;
  return coords && Object.prototype.hasOwnProperty.call(coords, city) ? coords[city] : undefined;
}

/**
 * Attach/replace a custom trip's config. Upserts the entry if absent (a wizard-created
 * trip that was not join-by-key'd first). Stamps `updatedAt` for the entry-level LWW unless
 * `touch` is false (a per-device write such as geocoded coordinates, which must not outrank a peer).
 */
export function setTripConfig(id: string, config: TripConfigBlock, touch = true): void {
  const clean = sanitizeTripConfig(config);
  if (!id || !clean) return;
  const stored = readStored();
  const hit = stored.find((t) => t.id === id);
  const now = Date.now();
  if (hit) {
    hit.config = clean;
    if (touch) hit.updatedAt = now;
  } else {
    stored.push({ id, name: SHARED_NAME, joinedAt: now, ...(touch ? { updatedAt: now } : {}), config: clean });
  }
  writeStored(stored);
}

/** Add a trip if missing; an existing entry keeps its name (rename is explicit, below). */
export function upsertKnownTrip(id: string, name?: string): void {
  if (!id) return;
  const stored = readStored();
  if (stored.some((t) => t.id === id)) return;
  // The default pack keeps its canonical name regardless of the caller's label (e.g. pasting the
  // default key into Join-by-key passes 'Shared trip') — rename is the ONLY way to rename it.
  const name_ =
    id === DEFAULT_TRIP_ID ? DEFAULT_NAME : name?.trim() || SHARED_NAME;
  stored.push({ id, name: name_, joinedAt: Date.now() });
  writeStored(stored);
}

/** Rename a known trip (upserts if absent, so renaming the synthesized default persists). */
export function renameKnownTrip(id: string, name: string): void {
  const trimmed = name.trim();
  if (!id || !trimmed) return;
  const stored = readStored();
  const hit = stored.find((t) => t.id === id);
  if (hit) {
    hit.name = trimmed;
    hit.updatedAt = Date.now(); // entry-level LWW stamp
  } else stored.push({ id, name: trimmed, joinedAt: Date.now() });
  writeStored(stored);
}

/**
 * D-600 — fold a peer's `meta/info` into the local entry, last-write-wins on `updatedAt`. A missing
 * stamp counts as 0 (oldest). The remote's stamp is adopted as-is so an unchanged doc is a no-op on
 * the next boot. Two carve-outs: a local placeholder name/config is always filled (the joiner heal),
 * and a remote placeholder name never replaces a real one (an old client can write one). Returns
 * whether the name or config changed.
 */
export function applyRemoteTripMeta(
  id: string,
  remote: { name: string; config?: TripConfigBlock; updatedAt?: number },
): boolean {
  if (!id) return false;
  const stored = readStored();
  let hit = stored.find((t) => t.id === id);
  if (!hit) {
    hit = { id, name: SHARED_NAME, joinedAt: Date.now() };
    stored.push(hit);
  }
  const remoteAt = remote.updatedAt ?? 0;
  const newer = remoteAt > (hit.updatedAt ?? 0);
  const name = remote.name.trim();
  let changed = false;
  if (name && name !== SHARED_NAME && name !== hit.name && (newer || hit.name === SHARED_NAME)) {
    hit.name = name;
    changed = true;
  }
  if (remote.config && (newer || !hit.config)) {
    const config = { ...remote.config };
    // Coordinates are geocoded per device and not always pushed; keep ours rather than drop them.
    if (!config.cityCoords && hit.config?.cityCoords) config.cityCoords = hit.config.cityCoords;
    if (JSON.stringify(config) !== JSON.stringify(hit.config)) {
      hit.config = config;
      changed = true;
    }
  }
  if (newer) hit.updatedAt = remoteAt;
  if (newer || changed) writeStored(stored);
  return changed;
}

/**
 * D-546 — the WIRE form of a default-pack share id. A share id and a pack id are both bare uuids,
 * so a token on its own cannot say which namespace it belongs to; every entrance resolved the
 * ambiguity the same wrong way, sending a `?trip=<shareId>` joiner through `joinTrip` into a
 * single-leg custom trip (`utcOffsetMin: 0` ⇒ `tripOffsetMinFor` null ⇒ NPT +345 / JST +540 lost,
 * `contentRef: 'empty'` ⇒ every guide gone). The prefix is transport only: it is stripped here and
 * never reaches a Firestore path.
 */
export const DEFAULT_SHARE_PREFIX = 'pack:';

/** What a pasted/linked token turns out to be. */
export type TripToken =
  | { kind: 'default'; id: string }
  | { kind: 'custom'; id: string };

/**
 * Resolve a raw token (pasted, or off a `?trip=` link) into the namespace it names, or `null` when
 * it can never be used. Pure and total — callers branch on `null` to refuse rather than writing
 * half of a join.
 */
export function parseTripToken(raw: string): TripToken | null {
  const trimmed = (raw ?? '').trim();
  if (trimmed.startsWith(DEFAULT_SHARE_PREFIX)) {
    const id = trimmed.slice(DEFAULT_SHARE_PREFIX.length).trim();
    return isSafeTripSegment(id) ? { kind: 'default', id } : null;
  }
  if (!isSafeTripSegment(trimmed)) return null;
  return { kind: 'custom', id: trimmed };
}

/**
 * The inverse: the copyable/linkable form of a pack's remote token. `''` when the pack has no
 * remote path yet (the default pack before D-542's opt-in), which is what every share affordance
 * already disables itself on.
 */
export function formatShareToken(packId: string, remoteId: string): string {
  if (!remoteId) return '';
  return packId === DEFAULT_TRIP_ID ? `${DEFAULT_SHARE_PREFIX}${remoteId}` : remoteId;
}

/**
 * D-504 — true when `raw` names this device's own account key (`getSyncCode()`, the User Token).
 * That key is an account credential, never a trip capability (D-239), so `joinTrip` refuses it:
 * joined as a custom trip it would become a registry row and a Firestore path segment, and joined
 * as a `pack:` share id every share link would then print it. Compared on the PARSED id, so the
 * `pack:` prefix cannot smuggle it past, and case-folded, because a uuid pasted in capitals is
 * still the same key to whoever reads it. Callers that refuse on a `false` from `joinTrip` use
 * this to say which refusal it was: "your own key" is a different sentence from "unusable".
 */
export function isOwnAccountToken(raw: string): boolean {
  const account = getSyncCode();
  const id = parseTripToken(raw)?.id;
  return !!account && !!id && id.toLowerCase() === account.trim().toLowerCase();
}

/** What a paste field says when `isOwnAccountToken` is why the join was refused. */
export const OWN_ACCOUNT_TOKEN_COPY =
  'That’s your own key. It signs you in and can’t be added as a trip. Ask whoever owns the trip for its Trip Token.';

/**
 * THE shared switch primitive: resolve the token, then write the pointer it names.
 * Does NOT reload — the caller performs the full page reload.
 *
 * D-546 — a default-pack token sets the share id (D-542's mechanism, the same one the code-paste
 * dialog uses) and points the browser at the pack, instead of registering the share id as a trip
 * of its own. Every entrance routes through here, so the `?trip=` link, the front door's held
 * invitation, the handshake and both paste boxes agree by construction.
 *
 * RETURNS whether the switch actually landed. The gateway swallows a blocked/full-storage write by
 * contract, so a call returning is not evidence anything was stored; the pointer is read back
 * here rather than at each call site, where three of the five forgot to. It also returns `false`,
 * writing nothing, for an unusable token or this device's own account key (`isOwnAccountToken`).
 */
export function joinTrip(id: string, name?: string): boolean {
  const token = parseTripToken(id);
  if (!token || isOwnAccountToken(id)) return false;
  if (token.kind === 'default') {
    // #572 — an unshared pack's local rows would otherwise merge into the joined trip.
    if (getDefaultTripShareId() === '') dropDefaultPackSyncedData();
    setDefaultTripShareId(token.id);
    setActiveTripId(DEFAULT_TRIP_ID);
    return getDefaultTripShareId() === token.id && getActiveTripId() === DEFAULT_TRIP_ID;
  }
  upsertKnownTrip(token.id, name);
  setActiveTripId(token.id);
  return getActiveTripId() === token.id;
}

/** True when `joinTrip(id)` would drop this device's copy of the default pack's plan (D-561):
 * moving off one shared trip onto another, or joining from an unshared pack that holds data.
 * Paste boxes confirm before that. */
export function joinReplacesLocalPlan(id: string): boolean {
  const token = parseTripToken(id);
  if (token?.kind !== 'default' || isOwnAccountToken(id)) return false;
  const current = getDefaultTripShareId();
  return current === '' ? defaultPackHasSyncedData() : current !== token.id;
}

export const REPLACE_LOCAL_PLAN_COPY =
  'Their plan replaces the one you have here. Back yours up first if you have edits worth keeping.';

const SYNC_DOMAINS: readonly SyncDomain[] = ['itinerary', 'expenses', 'budget', 'docs', 'places'];

/** Confirm copy for `joinReplacesLocalPlan`, naming how many queued-but-unsynced edits the
 * default pack's outbox would drop (issue #526). Reads the default pack's own slot, not the
 * active trip's — the join box is reachable while a custom trip is active. */
export function replaceLocalPlanCopy(): string {
  const n = SYNC_DOMAINS.reduce((sum, d) => sum + outboxDirty(d, DEFAULT_TRIP_ID).length, 0);
  if (n === 0) return REPLACE_LOCAL_PLAN_COPY;
  return `${REPLACE_LOCAL_PLAN_COPY} ${n} unsynced ${n === 1 ? 'edit' : 'edits'} on this device will be lost.`;
}

/** Total unsynced edits across every pack this browser knows (#623): sign-out's
 * `wipeAllTripData()` clears the default pack's outbox AND every `trip:{id}:syncOutbox`, not just
 * the active one, so the warning shown before that wipe sums `listKnownTrips()` the same way. */
export function unsyncedEditCount(): number {
  return listKnownTrips().reduce(
    (sum, t) => sum + SYNC_DOMAINS.reduce((s, d) => s + outboxDirty(d, t.id).length, 0),
    0,
  );
}

/**
 * Tombstone cap. The prior "grows unbounded" debt note proposed a purge pass keyed on
 * a device set this app doesn't track; a fixed cap needs none. Mirrors `PLACES_CAP`'s exact idiom
 * (`core/places/model.ts`'s `addPlace`): prepend-newest then `.slice(0, CAP)` on a newest-first
 * array — NOT a FIFO shift.
 */
const REMOVED_TRIPS_CAP = 200;

/**
 * Forget a trip: drop it from the local known list AND record a tombstone (key 29), so
 * the Sync-Code merge purges it from the additive union instead of resurrecting it. This NEVER
 * deletes the trip's remote Firestore data — anyone with the link/key can still open it, and pasting
 * the key re-joins (a fresh `joinedAt` beats the stale tombstone). Does NOT reload:
 * - REFUSES `DEFAULT_TRIP_ID` (the main pack is never removable) — no-op.
 * - Forgetting the ACTIVE trip first switches the pointer to the default pack ( semantics: the
 * CALLER performs the reload), so the browser lands on a valid pack.
 * - A-10/#100: also sweeps every `trip:{id}:*` slot (`wipeTripData`) — a forgotten trip no longer
 * leaves its itinerary/expenses/budget/etc. on disk forever, and a dirty `syncOutbox` for that id
 * can never survive to replay stale local edits over the live remote on a later re-join.
 * - …AND that trip's photo BYTES. `wipeTripData` only sweeps localStorage, so it deletes the photo
 * meta index — the only thing naming those blob ids — while the blobs themselves sit in the
 * app-scoped IndexedDB forever, unreachable from every UI and still costing origin quota. The
 * index is read here BEFORE the wipe; the delete itself is fire-and-forget (this function is
 * synchronous and its callers reload). The blob store is imported DYNAMICALLY: this module is
 * pulled in by the date backbone, i.e. by every route, and IndexedDB code has no business on that
 * first-load chunk.
 */
export function removeKnownTrip(id: string): void {
  if (!id || id === DEFAULT_TRIP_ID) return;
  if (getActiveTripId() === id) setActiveTripId(DEFAULT_TRIP_ID);
  writeStored(readStored().filter((t) => t.id !== id));
  const removed = [{ id, removedAt: Date.now() }, ...readRemoved().filter((r) => r.id !== id)];
  writeRemoved(removed.slice(0, REMOVED_TRIPS_CAP)); // newest-first, drop-oldest cap
  wipeForgottenTripData(id);
}

/**
 * The wipe half of forgetting a trip — `trip:{id}:*` (`wipeTripData`) plus its photo BYTES —
 * shared by `removeKnownTrip` (a local forget) and `importRemoteTrips` (#518: a tombstone arriving
 * from another device dropped the entry from the list but left this exact data on disk forever,
 * because only the local-forget path ran it). Never call for `DEFAULT_TRIP_ID` — see
 * `removeKnownTrip`'s docblock for why the pack is never wiped.
 */
function wipeForgottenTripData(id: string): void {
  const photoMeta = readJson<unknown>('local', keyForTrip(id, 'photos'), null);
  wipeTripData(id);
  if (photoMeta !== null) {
    import('@/core/photos/storage')
      .then((m) => m.deletePhotoBlobs(photoMeta))
      .catch((err) => console.warn('[trips] could not clear the forgotten trip\'s photos:', err));
  }
}

/**
 * Pure merge of two known-trips lists + their forget-tombstones for the Sync Code ( — no
 * I/O, unit-testable).
 *
 * - Union by id: a trip present on either side survives, UNLESS a tombstone forgets it (below).
 * - name/config conflicts resolve by `updatedAt` LWW: the higher stamp wins; a MISSING `updatedAt`
 * counts as 0, so it loses to any present stamp. On a tie, LOCAL wins (stable, no needless churn).
 * When remote wins, the merged entry keeps LOCAL's `joinedAt` (a per-device "when I joined" fact,
 * not a synced field).
 * - TOMBSTONES: the two removed-sets fold LWW by `removedAt` (`mergeRemovedSets`). A tombstoned
 * id is DROPPED from the union UNLESS the surviving entry's recency (`entryRecency` = the later of
 * `updatedAt`/`joinedAt`) is newer than `removedAt` — a re-join or post-forget rename beats a stale
 * tombstone, and that stale tombstone is then discarded from the merged removed-set.
 * - The DEFAULT pack is NEVER merged or tombstoned in either direction (it is the local-only
 * sample, synthesized locally on every browser — #10) — dropped from all four inputs.
 * - Malformed entries are dropped (re-sanitized via `sanitizeTripMetaEntry` / `sanitizeRemovedEntry`).
 *
 * `localHadExtras` is true when local held a (non-default) trip OR a tombstone the remote lacked — the
 * caller pushes the union back so the removal/addition propagates. `removed` is the merged tombstone
 * list to persist/push. `localRemoved`/`remoteRemoved` default to `[]` so an old-shape doc with no
 * `removed` field is tolerated.
 */
export function mergeTripLists(
  local: TripMeta[],
  remote: TripMeta[],
  localRemoved: RemovedTrip[] = [],
  remoteRemoved: RemovedTrip[] = [],
  opts: SanitizeOptions = {},
): { merged: TripMeta[]; localHadExtras: boolean; removed: RemovedTrip[] } {
  const tombstones = mergeRemovedSets(localRemoved, remoteRemoved);
  const merged = new Map<string, TripMeta>();
  for (const raw of local) {
    const e = sanitizeTripMetaEntry(raw, opts);
    if (e && e.id !== DEFAULT_TRIP_ID && !merged.has(e.id)) merged.set(e.id, e);
  }
  const remoteIds = new Set<string>();
  for (const raw of remote) {
    const e = sanitizeTripMetaEntry(raw, opts);
    if (!e || e.id === DEFAULT_TRIP_ID) continue;
    remoteIds.add(e.id);
    const existing = merged.get(e.id);
    if (!existing) {
      merged.set(e.id, e); // remote-only trip → appears locally (the cross-device fix)
    } else if ((e.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      merged.set(e.id, { ...e, joinedAt: existing.joinedAt }); // remote newer → take name/config, keep local joinedAt
    } else if (opts.keepUnknownKeys) {
      // Local wins (newer or a tie) on the DECLARED fields, but `local` is the strict-parsed
      // read of local storage (#519 - the common case): without this, the remote's undeclared
      // keys are dropped here even though the caller asked to retain them for the write-back.
      // `id`/`name`/`joinedAt`/`updatedAt`/`config` are stripped off `e` first — those are
      // DECLARED fields local already won on, so a remote value (e.g. a config local lacks)
      // must not fill in behind the winner's back.
      const { id: _id, name: _name, joinedAt: _joinedAt, updatedAt: _updatedAt, config: _config, ...unknown } = e;
      merged.set(e.id, { ...unknown, ...existing });
    }
  }
  // Apply tombstones: drop the forgotten trip unless it was re-joined/renamed AFTER the forget.
  for (const [id, entry] of merged) {
    const removedAt = tombstones.get(id);
    if (removedAt === undefined) continue;
    if (entryRecency(entry) > removedAt) tombstones.delete(id); // re-join beats a stale tombstone
    else merged.delete(id);
  }
  const removed = [...tombstones].map(([id, removedAt]) => ({ id, removedAt }));
  const remoteTombstoneIds = new Set(mergeRemovedSets(remoteRemoved).keys());
  const localHadExtras =
    [...merged.keys()].some((id) => !remoteIds.has(id)) ||
    [...tombstones.keys()].some((id) => !remoteTombstoneIds.has(id));
  return { merged: [...merged.values()], localHadExtras, removed };
}

/**
 * Apply a remote known-trips list + its tombstones into local storage: merge, then
 * persist BOTH the trip list and the folded tombstone set. Preserves a stored (possibly renamed)
 * DEFAULT pack entry verbatim — `mergeTripLists` strips the default, so we re-attach the local one,
 * first, if present. Returns `localHadExtras` so the caller can push back. `remoteRemoved` defaults to
 * `[]` (old-shape doc tolerated).
 *
 * An incoming tombstone for the ACTIVE trip also moves the pointer, exactly as `removeKnownTrip`
 * does for a local forget. Without it the forget undoes itself: the merge drops the entry but the
 * pointer keeps naming it, so the next `listKnownTrips()` self-heals the entry back in with a fresh
 * `joinedAt`, `entryRecency` then outranks `removedAt`, and the next merge deletes the tombstone and
 * re-pushes the trip to every device — including the one that forgot it. Moving the pointer removes
 * the state the self-heal reacts to, so no second guard is needed. As with `removeKnownTrip`, the
 * CALLER is responsible for reloading; the pack is re-resolved on the next load.
 */
export function importRemoteTrips(
  remote: TripMeta[],
  remoteRemoved: RemovedTrip[] = [],
): { localHadExtras: boolean } {
  const stored = readStored();
  const defaultEntry = stored.find((t) => t.id === DEFAULT_TRIP_ID);
  const { merged, localHadExtras, removed } = mergeTripLists(
    stored,
    remote,
    readRemoved(),
    remoteRemoved,
    { keepUnknownKeys: true },
  );
  writeStored(defaultEntry ? [defaultEntry, ...merged] : merged);
  writeRemoved(removed);
  const active = getActiveTripId();
  if (removed.some((r) => r.id === active)) setActiveTripId(DEFAULT_TRIP_ID);
  // #518 — a tombstone that arrived through THIS merge (not one already dropped before it) wipes
  // the id's local data, same as a local forget. Scoped to ids that (a) actually had data here —
  // `stored`, never the whole `merged` universe — and (b) are still gone AFTER the merge, so an id
  // re-added in the same merge (a race-losing re-join) is never wiped.
  const mergedIds = new Set(merged.map((t) => t.id));
  for (const t of stored) {
    if (t.id !== DEFAULT_TRIP_ID && !mergedIds.has(t.id)) wipeForgottenTripData(t.id);
  }
  return { localHadExtras };
}
