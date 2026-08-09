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
  getKnownTripsRaw,
  setKnownTripsRaw,
  getRemovedTripsRaw,
  setRemovedTripsRaw,
} from '@/core/storage/gateway';

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
 * Validate a stored/caller config block — returns a clean `TripConfigBlock` or `undefined` when
 * malformed (the ENTRY is kept, only its bad config is dropped — Plan D1). TOTAL, never throws.
 */
export function sanitizeTripConfig(raw: unknown): TripConfigBlock | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const c = raw as Record<string, unknown>;
  if (typeof c.start !== 'string' || !ISO_DATE.test(c.start)) return undefined;
  if (typeof c.end !== 'string' || !ISO_DATE.test(c.end)) return undefined;
  if (c.end < c.start) return undefined;
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
  return out;
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
 */
export function sanitizeTripMetaEntry(e: unknown): TripMeta | undefined {
  if (
    typeof e !== 'object' ||
    e === null ||
    typeof (e as TripMeta).id !== 'string' ||
    (e as TripMeta).id.length === 0 ||
    typeof (e as TripMeta).name !== 'string' ||
    (e as TripMeta).name.length === 0 ||
    typeof (e as TripMeta).joinedAt !== 'number' ||
    !Number.isFinite((e as TripMeta).joinedAt)
  ) {
    return undefined;
  }
  const { id, name, joinedAt } = e as TripMeta;
  const entry: TripMeta = { id, name, joinedAt };
  const rawUpdatedAt = (e as TripMeta).updatedAt;
  if (typeof rawUpdatedAt === 'number' && Number.isFinite(rawUpdatedAt)) entry.updatedAt = rawUpdatedAt;
  const config = sanitizeTripConfig((e as TripMeta).config);
  if (config) entry.config = config;
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
 * renamed — synthesized when not stored, so it needs no seeding). Self-heals: an active trip
 * missing from the list (joined before the registry existed) is upserted as `'Shared trip'`.
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
 * Attach/replace a custom trip's config. Upserts the entry if absent (a wizard-created
 * trip that was not join-by-key'd first). Stamps `updatedAt` for the entry-level LWW.
 */
export function setTripConfig(id: string, config: TripConfigBlock): void {
  const clean = sanitizeTripConfig(config);
  if (!id || !clean) return;
  const stored = readStored();
  const hit = stored.find((t) => t.id === id);
  const now = Date.now();
  if (hit) {
    hit.config = clean;
    hit.updatedAt = now;
  } else {
    stored.push({ id, name: SHARED_NAME, joinedAt: now, updatedAt: now, config: clean });
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
 * THE shared switch primitive: register the trip, then write the active-trip pointer.
 * Does NOT reload — the caller performs the full page reload.
 */
export function joinTrip(id: string, name?: string): void {
  if (!id) return;
  upsertKnownTrip(id, name);
  setActiveTripId(id);
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
 */
export function removeKnownTrip(id: string): void {
  if (!id || id === DEFAULT_TRIP_ID) return;
  if (getActiveTripId() === id) setActiveTripId(DEFAULT_TRIP_ID);
  writeStored(readStored().filter((t) => t.id !== id));
  const removed = [{ id, removedAt: Date.now() }, ...readRemoved().filter((r) => r.id !== id)];
  writeRemoved(removed.slice(0, REMOVED_TRIPS_CAP)); // newest-first, drop-oldest cap
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
 * - The DEFAULT pack is NEVER merged or tombstoned in either direction (its id is a per-deployment
 * secret, synthesized locally) — dropped from all four inputs.
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
): { merged: TripMeta[]; localHadExtras: boolean; removed: RemovedTrip[] } {
  const tombstones = mergeRemovedSets(localRemoved, remoteRemoved);
  const merged = new Map<string, TripMeta>();
  for (const raw of local) {
    const e = sanitizeTripMetaEntry(raw);
    if (e && e.id !== DEFAULT_TRIP_ID && !merged.has(e.id)) merged.set(e.id, e);
  }
  const remoteIds = new Set<string>();
  for (const raw of remote) {
    const e = sanitizeTripMetaEntry(raw);
    if (!e || e.id === DEFAULT_TRIP_ID) continue;
    remoteIds.add(e.id);
    const existing = merged.get(e.id);
    if (!existing) {
      merged.set(e.id, e); // remote-only trip → appears locally (the cross-device fix)
    } else if ((e.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
      merged.set(e.id, { ...e, joinedAt: existing.joinedAt }); // remote newer → take name/config, keep local joinedAt
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
 */
export function importRemoteTrips(
  remote: TripMeta[],
  remoteRemoved: RemovedTrip[] = [],
): { localHadExtras: boolean } {
  const stored = readStored();
  const defaultEntry = stored.find((t) => t.id === DEFAULT_TRIP_ID);
  const { merged, localHadExtras, removed } = mergeTripLists(stored, remote, readRemoved(), remoteRemoved);
  writeStored(defaultEntry ? [defaultEntry, ...merged] : merged);
  writeRemoved(removed);
  return { localHadExtras };
}
