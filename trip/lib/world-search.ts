// Issue #22 — the WORLD half of the map search: a place that is not in the trip at all.
//
// The trip half (curated markers, trip cities, the user's own planned stops) stays exactly where
// it was, in `components/map-section.tsx`, and stays in-bundle. This module is only the fallback
// underneath it: one keyless HTTP lookup, issued ONLY when the user explicitly asks for it.
//
// PROVIDER — Nominatim (OpenStreetMap), https://nominatim.openstreetmap.org/search.
// Free, keyless, no signup, no card: it clears D-088 on D-088's own terms, the same way
// Open-Meteo (D-108) and Frankfurter (D-189) already do. A plain browser `fetch` straight to the
// host — no route handler, no server, no secret, no npm dependency.
//
// 🔴 ITS USAGE POLICY IS A DESIGN INPUT, NOT A README FOOTNOTE. Three clauses shape this file:
//
// 1. **No autocomplete / no search-as-you-type.** The policy forbids querying on keystrokes
//    outright, and debouncing is NOT a compliant substitute — a debounce still turns typing into
//    queries, it just sends fewer of them. So `searchWorldPlaces` is called from a SUBMIT
//    handler and from nowhere else. There is no effect in this repo that calls it on a query
//    change, and adding one would breach the policy, not merely be wasteful.
// 2. **Identify the application.** A browser cannot set `User-Agent` — it is a forbidden header
//    name, so `fetch` silently drops any attempt — which is why the policy accepts a valid
//    `Referer` instead, and the browser sends that automatically (`https://powan55.github.io/…`,
//    same-site default referrer policy; nothing here strips it). Nominatim's other identifying
//    hook, the `email=` parameter, is deliberately NOT used: this repo is public and that would
//    publish a personal contact detail.
// 3. **At most one request per second, absolute.** Enforced here, not hoped for: a module-scope
//    `lastRequestAt` gate makes a second request WAIT out the remainder of the interval, and an
//    identical query is answered from an in-memory memo without touching the network at all.
//
// TOTAL — `searchWorldPlaces` resolves, it never rejects. Every failure comes back as a typed
// outcome (`offline` / `rate-limited` / `failed`) that the caller renders in plain words. No raw
// error string, no thrown `TypeError`, and the trip search keeps working through all of them:
// this app is used on foreign mobile data, where the failure path is the normal path.

/** One resolved world place. Coordinates only — this is NOT a `MapMarker` and never becomes one:
 *  a place outside the trip has no curated `country`/`area`/`description` to honestly claim. */
export interface WorldPlace {
  /** Stable row identity (React key + `data-testid`), always prefixed `world-`. */
  id: string;
  /** The short name — the first line of a result row. */
  name: string;
  /** Nominatim's `display_name`, VERBATIM: the full "…, District, Region, Country" trail. It is
   *  the second line, and it is what lets a user tell two identically-named places apart. Never
   *  paraphrased — the same reason D-279's `derivedFrom` is quoted rather than described. */
  displayName: string;
  lat: number;
  lng: number;
}

/** Why a world lookup produced nothing. Each maps to one sentence in `WORLD_SEARCH_MESSAGES`. */
export type WorldSearchFailure = 'offline' | 'rate-limited' | 'failed';

export type WorldSearchOutcome =
  | { status: 'ok'; places: WorldPlace[] }
  | { status: WorldSearchFailure };

/**
 * The words the user actually reads. They live HERE, next to the states that produce them, so a
 * failure can never be rendered as a raw error string and every branch is asserted by one test.
 * Each one states what broke and what still works — the trip search is unaffected by all three,
 * and saying so is the difference between a degraded feature and an app that looks broken.
 */
export const WORLD_SEARCH_MESSAGES: Record<WorldSearchFailure, string> = {
  offline:
    "You're offline, so places outside your trip can't be looked up right now. Everything on your trip still searches.",
  'rate-limited':
    'The worldwide place lookup is busy right now. Wait a moment and search again — everything on your trip still searches.',
  failed:
    "Couldn't reach the worldwide place lookup. Everything on your trip still searches.",
};

export const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

/** Five rows fill the panel without scrolling it into a wall of near-identical addresses. */
export const WORLD_SEARCH_LIMIT = 5;

/** Matches `lib/currency-rate.ts`'s ceiling: a stalled connection that neither routes nor rejects
 *  must still settle, or "total" degrades into a permanent "Searching…". */
const WORLD_SEARCH_TIMEOUT_MS = 8_000;

/** Nominatim's absolute ceiling. See clause 3 in the module note. */
const MIN_REQUEST_INTERVAL_MS = 1_000;

/** Case/whitespace only — the cache key and the trip-duplicate test both need the same one. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The request URL. Pure and exported so a test can read it without a network: it is the one place
 * that proves this stays keyless (no `key`, `apikey`, `token` or `email` parameter — the D-108
 * check, applied to this provider) and that the query is properly encoded rather than concatenated.
 */
export function buildWorldSearchUrl(query: string, limit: number = WORLD_SEARCH_LIMIT): string {
  const params = new URLSearchParams({
    q: query.trim(),
    format: 'jsonv2',
    limit: String(limit),
    // No address breakdown: `display_name` already carries the full trail this UI renders.
    addressdetails: '0',
  });
  return `${NOMINATIM_SEARCH_URL}?${params.toString()}`;
}

function toFiniteNumber(v: unknown): number | null {
  // Nominatim serialises lat/lon as STRINGS ("27.7172"), which is the single most likely place
  // for a naive parse to produce `NaN` coordinates and fly the camera to the null island.
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Nominatim body → `WorldPlace[]`. PURE and TOTAL: any row that is not a usable place is dropped,
 * never rendered half-formed, and a body that is not an array at all yields `[]` rather than
 * throwing. A row must carry a real in-range coordinate and a display name to survive — a result
 * we cannot fly to is not a search result.
 */
export function parseNominatim(json: unknown): WorldPlace[] {
  if (!Array.isArray(json)) return [];
  const places: WorldPlace[] = [];
  const seen = new Set<string>();
  json.forEach((raw, i) => {
    if (!raw || typeof raw !== 'object') return;
    const row = raw as Record<string, unknown>;
    const lat = toFiniteNumber(row.lat);
    const lng = toFiniteNumber(row.lon);
    if (lat === null || lng === null) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    const displayName = typeof row.display_name === 'string' ? row.display_name.trim() : '';
    if (!displayName) return;
    const shortName =
      typeof row.name === 'string' && row.name.trim() !== ''
        ? row.name.trim()
        : displayName.split(',')[0].trim();
    if (!shortName) return;
    // `place_id` is Nominatim's own row id. Sanitised because it becomes a `data-testid`, and
    // fallen back to the array index so a body missing it still yields distinct React keys.
    const rawId =
      typeof row.place_id === 'number' || typeof row.place_id === 'string'
        ? String(row.place_id).replace(/[^a-zA-Z0-9._-]/g, '')
        : '';
    const id = `world-${rawId || i}`;
    if (seen.has(id)) return;
    seen.add(id);
    places.push({ id, name: shortName, displayName, lat, lng });
  });
  return places;
}

/**
 * TRIP PLACES WIN. A world row naming something the trip search already returned is dropped, so
 * "Kathmandu" is one result (yours), not two.
 *
 * Matched on the NAME only, deliberately not on proximity: two genuinely different temples 400 m
 * apart are two places, and a distance-based merge would silently delete the second one. A false
 * duplicate costs a row; a false merge costs a result the user asked for.
 */
export function dropTripDuplicates(
  places: WorldPlace[],
  tripNames: readonly string[],
): WorldPlace[] {
  const taken = new Set(tripNames.map(normalize).filter(Boolean));
  return places.filter((p) => !taken.has(normalize(p.name)));
}

export interface WorldSearchOptions {
  /** Injectable so unit tests drive the fetch deterministically (the `lib/currency-rate.ts` idiom). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** The 1 req/s policy gate. Tests pass 0 so they do not sit through it. */
  minIntervalMs?: number;
}

// In-memory, per-session memo: query → results. Not localStorage, deliberately — nothing here is
// worth a gateway key (D-097) or a stale-cache story, and the whole point is to spend fewer
// requests inside one sitting. Failures are NOT cached: a retry after the wifi comes back has to
// actually retry.
// KNOWN CEILING: unbounded, holding ≤5 rows per distinct query typed in one session — bounded in
// practice by how much a human types before a reload. Cap it (LRU, or just clear on close) only if
// some surface ever starts issuing these programmatically.
const resultCache = new Map<string, WorldPlace[]>();
let lastRequestAt = 0;

/** Test seam — resets the memo and the rate gate so cases cannot leak into each other. */
export function resetWorldSearchState(): void {
  resultCache.clear();
  lastRequestAt = 0;
}

/**
 * Look up a place anywhere in the world. Call this from a SUBMIT handler only (module note,
 * clause 1). Never throws.
 *
 * Order of business:
 *  0. Empty query → `ok` with no results, no request.
 *  1. Memo hit → those results, no request, no rate-gate wait.
 *  2. `navigator.onLine === false` → `offline` WITHOUT issuing the request. `onLine` false is the
 *     one reliable direction of that signal, and a doomed cross-origin fetch prints a browser-level
 *     console error no application code can suppress (the `lib/currency-rate.ts` finding).
 *  3. Otherwise fetch, honouring the 1 req/s gate. HTTP 429 → `rate-limited`; any other non-2xx,
 *     network error, timeout or unparsable body → `failed`.
 */
export async function searchWorldPlaces(
  query: string,
  {
    fetchImpl = fetch,
    timeoutMs = WORLD_SEARCH_TIMEOUT_MS,
    minIntervalMs = MIN_REQUEST_INTERVAL_MS,
  }: WorldSearchOptions = {},
): Promise<WorldSearchOutcome> {
  const key = normalize(query);
  if (!key) return { status: 'ok', places: [] };

  const cached = resultCache.get(key);
  if (cached) return { status: 'ok', places: cached };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline' };
  }

  const wait = lastRequestAt + minIntervalMs - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();

  try {
    // Signal built PER CALL — `AbortSignal.timeout` is single-use, so a module-scope one would
    // already be expired by the second search (the same trap `lib/currency-rate.ts` documents).
    const res = await fetchImpl(buildWorldSearchUrl(query), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) return { status: 'rate-limited' };
    if (!res.ok) return { status: 'failed' };
    const places = parseNominatim(await res.json());
    resultCache.set(key, places);
    return { status: 'ok', places };
  } catch {
    return { status: 'failed' };
  }
}
