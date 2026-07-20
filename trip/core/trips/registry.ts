/**
 * Known-trips registry — the data layer that remembers every trip this browser has
 * created or joined, with a user-visible name. Backed by gateway key 26 (`tripPlannerKnownTrips`,
 * APP-SCOPED raw-string transport); ALL shape/sanitize/policy logic lives HERE.
 *
 * `joinTrip` is the ONE shared entry point every active-trip pointer write flows through, so no
 * future surface can switch trips without registering them. It does NOT reload — the caller
 * performs the full page reload.
 *
 * Trip NAME is local-only in this slice (no Firestore sync). (/trips hub) and (home
 * trip strip) consume `listKnownTrips()`.
 */
import {
  DEFAULT_TRIP_ID,
  getActiveTripId,
  setActiveTripId,
  getKnownTripsRaw,
  setKnownTripsRaw,
} from '@/core/storage/gateway';

export type TripMeta = { id: string; name: string; joinedAt: number };

/** Default-pack display name (until renamed). */
const DEFAULT_NAME = 'Nepal × Japan';
/** Fallback name for a trip registered without one (join-by-key, pre-registry self-heal). */
const SHARED_NAME = 'Shared trip';

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
    if (
      typeof e === 'object' &&
      e !== null &&
      typeof (e as TripMeta).id === 'string' &&
      (e as TripMeta).id.length > 0 &&
      typeof (e as TripMeta).name === 'string' &&
      (e as TripMeta).name.length > 0 &&
      typeof (e as TripMeta).joinedAt === 'number' &&
      Number.isFinite((e as TripMeta).joinedAt) &&
      !out.some((t) => t.id === (e as TripMeta).id)
    ) {
      const { id, name, joinedAt } = e as TripMeta;
      out.push({ id, name, joinedAt });
    }
  }
  return out;
}

function writeStored(trips: TripMeta[]): void {
  setKnownTripsRaw(JSON.stringify(trips));
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
  if (hit) hit.name = trimmed;
  else stored.push({ id, name: trimmed, joinedAt: Date.now() });
  writeStored(stored);
}

/**
 * THE shared switch primitive: register the trip, then write the active-trip pointer.
 * Does NOT reload — the caller performs the full page reload.
 */
export function joinTrip(id: string, name?: string): void {
  upsertKnownTrip(id, name);
  setActiveTripId(id);
}
