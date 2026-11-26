/**
 * Every trip this browser has created or joined. The gateway stores the raw string (key 26);
 * shape, sanitizing and policy live here. `joinTrip` is the only way to switch the active trip,
 * so every switch registers the trip. Callers reload afterwards.
 */
import {
  DEFAULT_TRIP_ID,
  defaultShareReloadGuard,
  getActiveTripId,
  setActiveTripId,
  getKnownTripsRaw,
  setKnownTripsRaw,
  getRemovedTripsRaw,
  setRemovedTripsRaw,
  getSyncCode,
  wipeTripData,
  keyForTrip,
  readJson,
  readString,
  isSafeTripSegment,
  STORAGE_KEYS,
  type TripScopedSlot,
} from '@/core/storage/gateway';
import { outboxDirty, type SyncDomain } from '@/core/sync/outbox';
import { sanitizePhotos } from '@/core/photos/model';
import type { CityCoord } from '@/lib/city-coords';
import { SHARED_TRIP_ID, SHARED_TRIP_USERNAMES } from '@/core/trips/shared-trip';

/** Config for a custom trip, stored inside its TripMeta entry. `updatedAt` is its LWW stamp. */
export type TripConfigBlock = {
  start: string;
  end: string;
  destinations: string[];
  vibe: string;
  currency?: string;
  /** Geocoded coordinates per destination, filled lazily by lib/city-geocode.ts. Optional. */
  cityCoords?: Record<string, CityCoord>;
  /**
   * Multi-city trips: from `date` on, the city is `city` (one of `destinations`). Before the first
   * stop it's `destinations[0]`. Optional; older clients ignore it.
   */
  stops?: { date: string; city: string }[];
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

/** Forget tombstone. A later re-join or rename beats `removedAt` in the merge. */
export type RemovedTrip = { id: string; removedAt: number };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Max trip length in days, shared with the create form. Every day becomes a shell, rendered
 * nodes and one Firestore document, so a year typo (2027 to 2227) would mean 73k writes.
 */
export const TRIP_DAYS_MAX = 730;

const DAY_MS = 86_400_000;

/**
 * `YYYY-MM-DD` to UTC ms, or NaN for a shaped-but-unreal day like 2026-13-45, which `new Date`
 * would roll over. The round-trip compare catches it.
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
 * Clean config or undefined; the entry survives without it. Never throws. Every config source
 * (form, peer doc, synced list, storage) passes through here, so the date checks live here.
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
  const stops = sanitizeStops(c.stops, destinations);
  if (stops) out.stops = stops;
  return out;
}

const STOPS_MAX = 50;

/** Validate raw `stops`: keep only entries with a real ISO day and a city that is verbatim in
 *  `destinations`; sort by date, one per date (first wins), cap at STOPS_MAX. `undefined` when
 *  nothing survives. TOTAL, never throws. */
function sanitizeStops(raw: unknown, destinations: string[]): TripConfigBlock['stops'] {
  if (!Array.isArray(raw)) return undefined;
  const seen = new Set<string>();
  const out: { date: string; city: string }[] = [];
  for (const s of raw) {
    if (s === null || typeof s !== 'object') continue;
    const { date, city } = s as Record<string, unknown>;
    if (typeof date !== 'string' || !ISO_DATE.test(date) || Number.isNaN(isoDayMs(date))) continue;
    // `__proto__` guard as in `sanitizeCityCoords`; `includes` already rejects it as a city, kept explicit.
    if (typeof city !== 'string' || city === '__proto__' || !destinations.includes(city)) continue;
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ date, city });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out.length > 0 ? out.slice(0, STOPS_MAX) : undefined;
}

/** Drop entries with an empty key or an out-of-range lat/lng; undefined when none survive.
 *  Unlike `ranged` in item-schema.ts, a bad number drops the whole city: half a coordinate is
 *  useless to the weather lookup. */
function sanitizeCityCoords(raw: unknown): Record<string, CityCoord> | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, CityCoord> = {};
  for (const [city, v] of Object.entries(raw as Record<string, unknown>)) {
    // JSON.parse yields `__proto__` as an own key; assigning it would replace the prototype.
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
/** Placeholder name for a trip joined without one. Exported so callers can detect it. */
export const SHARED_NAME = 'Shared trip';

/** Read-boundary option, same shape/intent as `core/places/model.ts`'s (D-374): retain keys this
 *  build does not declare, so a merge-and-write-back never strips a newer client's field. */
export interface SanitizeOptions {
  keepUnknownKeys?: boolean;
}

/**
 * One raw entry to a clean TripMeta, or undefined. Never throws. Also used on synced lists, which
 * is why the id is shape-checked here: an id like `A/B/C` would otherwise become a valid Firestore
 * ref under trip A.
 */
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
 * Later of rename and (re-)join time; beating `removedAt` revives the trip. Joins don't stamp
 * `updatedAt` (it would win name LWW), so `joinedAt` is what marks a re-join.
 */
function entryRecency(e: TripMeta): number {
  return Math.max(e.updatedAt ?? 0, e.joinedAt);
}

/** Fold tombstone lists into id to removedAt, latest wins. The sample pack is never tombstoned. */
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
 * Every known trip, the local-only sample pack first (synthesized if not stored). An active trip
 * missing from the list is added back as 'Shared trip'.
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

/** The active trip's geocoded coordinate for a city; callers fall back to lib/city-coords.ts. */
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
    if (readRemoved().some((r) => r.id === id)) return false; // a fresh joinedAt would beat the tombstone (#656)
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
 * Marks a sample-pack share id on the wire (D-546). Share ids and trip ids are both bare uuids,
 * so without it a shared sample pack would be joined as an empty custom trip. Never stored.
 */
export const DEFAULT_SHARE_PREFIX = 'pack:';

const MIN_TRIP_TOKEN_LEN = 20;

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
    // The default pack has one trip. Any other `pack:` id is an old per-account link.
    return id.toLowerCase() === SHARED_TRIP_ID ? { kind: 'default', id: SHARED_TRIP_ID } : null;
  }
  if (!isSafeTripSegment(trimmed)) return null;
  // D-675 (#775) — the shared trip's id, bare, means the pack; taken as a custom trip it would
  // open the shared doc without the pack's legs or content.
  if (trimmed.toLowerCase() === SHARED_TRIP_ID) return { kind: 'default', id: SHARED_TRIP_ID };
  // The legacy account names are account paths (`trips/<Name>/profile/...`), never trips.
  if (isLegacyAccountKey(trimmed)) return null;
  // D-696 (#852) — a token this short is guessable; app-minted ids are uuids. The default
  // pack's own slug is the way back to it, not a guess.
  if (trimmed.length < MIN_TRIP_TOKEN_LEN && trimmed !== DEFAULT_TRIP_ID) return null;
  return { kind: 'custom', id: trimmed };
}

const LEGACY_ACCOUNT_KEYS = new Set<string>(SHARED_TRIP_USERNAMES.map((n) => n.toLowerCase()));

/** A legacy account name (`trips/<Name>/profile/...`), case-folded. Never a trip. */
export function isLegacyAccountKey(id: string): boolean {
  return LEGACY_ACCOUNT_KEYS.has(id.trim().toLowerCase());
}

/** Shareable form of a pack's remote token; '' when it has no remote path yet. */
export function formatShareToken(packId: string, remoteId: string): string {
  if (!remoteId) return '';
  return packId === DEFAULT_TRIP_ID ? `${DEFAULT_SHARE_PREFIX}${remoteId}` : remoteId;
}

/**
 * True when `raw` is this device's own account key (D-504). It's a credential, not a trip
 * (D-239), so joinTrip refuses it; joined, it would end up in share links. Compared on the parsed,
 * case-folded id.
 */
export function isOwnAccountToken(raw: string): boolean {
  const account = getSyncCode();
  // Not parseTripToken: that already refuses every `pack:` id but the shared trip's, and this
  // answer picks the refusal copy.
  const t = (raw ?? '').trim();
  const id = (t.startsWith(DEFAULT_SHARE_PREFIX) ? t.slice(DEFAULT_SHARE_PREFIX.length) : t).trim();
  return !!account && !!id && id.toLowerCase() === account.trim().toLowerCase();
}

/** What a paste field says when `isOwnAccountToken` is why the join was refused. */
export const OWN_ACCOUNT_TOKEN_COPY =
  'That’s your own key. It signs you in and can’t be added as a trip. Ask whoever owns the trip for its Trip Token.';

/**
 * Resolve a token and point the browser at the trip it names. A sample-pack token sets the
 * share id instead of registering a trip. Every entrance goes through here. Caller reloads.
 *
 * Returns whether the switch landed: the gateway swallows failed writes, so the pointer is read
 * back here. False, with nothing written, for an unusable token or the device's own key.
 */
export function joinTrip(id: string, name?: string): boolean {
  // A row this browser already holds stays switchable even if parseTripToken now refuses its id:
  // its `trip:{id}:*` data lives under that id. Only new joins are refused.
  const existing = getKnownTrip((id ?? '').trim());
  const token: TripToken | null = existing ? { kind: 'custom', id: existing.id } : parseTripToken(id);
  if (!token || isOwnAccountToken(id)) return false;
  if (token.kind === 'default') {
    // Only switches back to the pack; lib/account-share.ts moves onto the shared trip once the
    // person agrees. A link join lets a declined prompt ask again.
    defaultShareReloadGuard.reset();
    setActiveTripId(DEFAULT_TRIP_ID);
    return getActiveTripId() === DEFAULT_TRIP_ID;
  }
  upsertKnownTrip(token.id, name);
  setActiveTripId(token.id);
  return getActiveTripId() === token.id;
}

export const REPLACE_LOCAL_PLAN_COPY =
  'Their plan replaces the one you have here. Back yours up first if you have edits worth keeping.';

const SYNC_DOMAINS: readonly SyncDomain[] = ['itinerary', 'expenses', 'budget', 'docs', 'places'];

/** Confirm copy naming how many unsynced sample-pack edits would be dropped. Reads the pack's
 * own slot, since a custom trip may be active. */
export function replaceLocalPlanCopy(lead: string = REPLACE_LOCAL_PLAN_COPY): string {
  const n = SYNC_DOMAINS.reduce((sum, d) => sum + outboxDirty(d, DEFAULT_TRIP_ID).length, 0);
  if (n === 0) return lead;
  return `${lead} ${n} unsynced ${n === 1 ? 'edit' : 'edits'} on this device will be lost.`;
}

/** Unsynced edits across all known trips, since sign-out wipes every trip's outbox. */
export function unsyncedEditCount(): number {
  const q = readTripSyncQueue(); // #1125: the wipe drops queued renames and the trip list too
  return listKnownTrips().reduce(
    (sum, t) => sum + unsyncedEditCountFor(t.id),
    personPrefsDirty() + q.meta.length + (q.list ? 1 : 0),
  );
}

/** One trip's unsynced edits (outbox + journal); forgetting it wipes both (#712). */
export function unsyncedEditCountFor(id: string): number {
  return SYNC_DOMAINS.reduce((s, d) => s + outboxDirty(d, id).length, 0) + journalDirty(id);
}

/** Photos stored on this device for a trip; forgetting it deletes their bytes (#712). */
export function localPhotoCountFor(id: string): number {
  return sanitizePhotos(readJson<unknown>('local', keyForTrip(id, 'photos'), null)).length;
}

const DEVICE_ONLY_SLOTS = [
  'packing',
  'shareInbox',
  'favorites',
  'dayAnchors',
  'conciergeChat',
  'journalDraft',
  'itineraryCorrupt',
  'expensesCorrupt',
  'localRescue',
  'ice',
] as const satisfies readonly TripScopedSlot[];

function holdsContent(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v !== 'object' || v === null || Object.keys(v).length > 0;
  } catch {
    return true;
  }
}

/** Data for a trip that only this device has: no remote copy could restore it (#983). Journal
 * entries count until a sync stamp says the account holds them. */
export function hasDeviceOnlyData(id: string): boolean {
  if (DEVICE_ONLY_SLOTS.some((slot) => holdsContent(readString('local', keyForTrip(id, slot))))) return true;
  const raw = readString('local', keyForTrip(id, 'journal'));
  if (raw === null) return false;
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    return true;
  }
  if (!Array.isArray(entries)) return holdsContent(raw);
  const stamps = readJson<Record<string, unknown>>('local', keyForTrip(id, 'journalSync'), {});
  return entries.some((e) => {
    const date = (e as { date?: unknown } | null)?.date;
    return typeof date !== 'string' || !stamps[date];
  });
}

/** Person prefs not yet on the account (#672); the wipe deletes key 48 with them. */
export function personPrefsDirty(): number {
  const prefs = readJson<unknown>('local', STORAGE_KEYS.personPrefs, null);
  if (typeof prefs !== 'object' || prefs === null) return 0;
  return Object.values(prefs).filter((e) => (e as { dirty?: unknown } | null)?.dirty === true).length;
}

/** Trip renames and the trip list waiting to push (key 58, D-880). Malformed reads as empty. */
export type TripSyncQueue = { meta: string[]; list?: string };

export function readTripSyncQueue(): TripSyncQueue {
  const raw = readJson<{ meta?: unknown; list?: unknown } | null>('local', STORAGE_KEYS.tripSyncQueue, null);
  const meta = Array.isArray(raw?.meta) ? raw.meta.filter((id): id is string => typeof id === 'string') : [];
  return typeof raw?.list === 'string' && raw.list ? { meta, list: raw.list } : { meta };
}

/** Journal days waiting to push (#631). They queue in key 50, not the outbox, and the wipe drops them too. */
export function journalDirty(id: string): number {
  return journalDirtyDates(id).length;
}

export function journalDirtyDates(id: string): string[] {
  const meta = readJson<unknown>('local', keyForTrip(id, 'journalSync'), null);
  if (typeof meta !== 'object' || meta === null) return [];
  return Object.entries(meta)
    .filter(([, m]) => (m as { dirty?: unknown } | null)?.dirty === true)
    .map(([d]) => d);
}

/** Tombstone cap; newest first, sliced. */
const REMOVED_TRIPS_CAP = 200;

/**
 * Forget a trip locally and record a tombstone so the synced list doesn't bring it back. Remote
 * data is untouched; re-joining beats the tombstone. No-op for the sample pack. Forgetting the
 * active trip switches to the sample pack; caller reloads. Also wipes the trip's local slots
 * (a stale outbox could otherwise replay on re-join) and its photo blobs.
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
 * Wipes a forgotten trip's slots and photo blobs, for local forgets and synced tombstones alike.
 * The photo index is read before the wipe; blob deletion is fire-and-forget and imported lazily
 * to keep IndexedDB code off every route's first load. Never call for the sample pack.
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
 * Pure merge of two trip lists and their tombstones.
 * - Union by id. Name/config resolve by `updatedAt` (missing = 0, tie goes to local); `joinedAt`
 *   always stays local.
 * - A tombstoned id is dropped unless the entry is newer than `removedAt`, in which case the
 *   tombstone is discarded.
 * - The sample pack is stripped from all inputs.
 * `localHadExtras` tells the caller to push the union back.
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
      // Local won the declared fields, but keep the remote's unknown keys for the write-back.
      // Declared fields are stripped first so a remote value can't fill in behind the winner.
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
 * Merge a remote list into storage, keeping the local sample-pack entry. Returns
 * `localHadExtras` for the push-back.
 *
 * A tombstone for the active trip also moves the pointer. Otherwise listKnownTrips would
 * self-heal the entry with a fresh joinedAt, which beats the tombstone and resurrects the trip
 * everywhere. Caller reloads.
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
  // Wipe local data for trips this merge removed: only ids stored here and still gone after it.
  const mergedIds = new Set(merged.map((t) => t.id));
  for (const t of stored) {
    if (t.id === DEFAULT_TRIP_ID || mergedIds.has(t.id)) continue;
    // Unsynced edits, photos and other device-only data survive another device's forget (#843, #983).
    if (unsyncedEditCountFor(t.id) > 0 || localPhotoCountFor(t.id) > 0 || hasDeviceOnlyData(t.id)) continue;
    wipeForgottenTripData(t.id);
  }
  return { localHadExtras };
}
