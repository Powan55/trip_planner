// Night-before readiness ("ready to go?") — the four machine-checkable facts behind
// `components/preflight-checks.tsx`, rendered on `/checklist` under the human-attested
// day-zero list (issue #20). This module is the ADAPTER: it owns the I/O (Cache Storage,
// StorageManager, the real `Date`, the `?today=` override) and keeps the verdict logic in
// small pure functions the tests drive directly.
//
// 🔴 NOTHING HERE MAY TOUCH THE NETWORK. That is the issue's own requirement: this screen is
// meant to be usable on airplane mode the evening before flying. `cache.match()` is a
// cache-only read (never a fetch), `estimate()` is a local quota read, and the clock/sync
// checks read local state only. Do not add a `fetch` here, not even a HEAD, not even to a
// time server — see `evaluateClock`'s documented ceiling.
//
// 🔴 EVERY UNKNOWN RENDERS AS "couldn't check", NEVER AS A PASS. A readiness screen that
// reports a false pass is worse than no screen: the traveler acts on it at 35,000 feet.
// So each check degrades to `'unknown'` when its API is missing (old browser, SSR, privacy
// mode) or throws, and never falls back to an optimistic default.

import { dayInTripFor } from '@/core/dates';
import { zoneAbbrevForOffset } from '@/core/dates/item-time';
import { clockOverride } from '@/core/storage/gateway';
import { getActiveTrip } from '@/core/trips';
import { formatRelativeTime } from '@/lib/relative-time';
import { getNow, tripOffsetMinFor } from '@/lib/trip-now';

/** `'ok'` = verified true. `'attention'` = verified NOT ready. `'unknown'` = we could not tell. */
export type PreflightState = 'ok' | 'attention' | 'unknown';

export interface PreflightCheck {
  /** Stable row id — also the `data-testid` suffix. */
  id: string;
  /** What is being checked (the row's own label). */
  label: string;
  state: PreflightState;
  /** One short verdict line. */
  headline: string;
  /** The honest sentence: what the verdict does and does not mean, and what to do about it. */
  detail: string;
}

/**
 * The near-quota threshold, so the proactive TOAST and this readiness ROW can never disagree
 * about what "nearly full" means. It is DECLARED in `lib/storage-quota.ts` and re-exported here
 * for the readers that already import it from this module.
 *
 * It moved out because `components/storage-persistence.tsx` needs it and is mounted in
 * `app/layout.tsx` — importing it from here put this module's `maplibregl` marker into the root
 * layout's chunk, which cost the whole app offline. See the marker comment below and the header
 * of `lib/storage-quota.ts`. One value, still; a cheaper place to reach it.
 */
export { QUOTA_WARN_THRESHOLD } from '@/lib/storage-quota';
import { QUOTA_WARN_THRESHOLD } from '@/lib/storage-quota';

/** The service worker's content-hashed precache (`scripts/gen-sw.mjs`). */
const PRECACHE_PREFIX = 'trip-precache-';

/**
 * The marker `gen-sw.mjs`'s own `isMaplibreChunk()` uses to find the map engine by CONTENT.
 * It has to be content, not filename: the built chunks are content-hashed and carry no name
 * (D-286), so there is nothing to pattern-match a URL against.
 */
// COUPLED to `scripts/gen-sw.mjs:255`, which uses the identical marker to decide what gets
// precached. Built chunk filenames are content-hashed and carry no name (D-286), so content match
// is the only handle either side has. If gen-sw's marker changes and this one does not, this row
// reports "Map engine not saved yet" to EVERY user while the engine is in fact present — a false
// ALARM rather than a false pass, so it fails safe, but it fails loudly and for everyone. The two
// strings must move together.
//
// 🔴 THIS MODULE IS CONTAGIOUS. KEEP IT OFF THE ROOT LAYOUT'S IMPORT PATH.
// The literal below lands in whatever chunk this module is bundled into, and two independent
// consumers read "chunk body contains that string" as "this chunk IS the map engine":
// `gen-sw.mjs`'s isMaplibreChunk(), which decides what gets precached and which call sites need
// the island boundary, and `e2e/pwa.spec.ts`'s eviction test, which deletes every matching chunk
// to prove the boundary degrades. Neither can tell "carries maplibre" from "looks for maplibre".
//
// `components/storage-persistence.tsx` used to import `QUOTA_WARN_THRESHOLD` from here for one
// number, and it is mounted in `app/layout.tsx` — so the ROOT LAYOUT's chunk carried this marker,
// the eviction deleted it, and `app/global-error.tsx` replaced every route. Not just a test
// artefact: a real storage-pressure eviction of the engine would have taken the whole app offline
// with it. The constant now lives in `lib/storage-quota.ts`; read that file's header before
// re-pointing any import at this one.
//
// Hiding the string does not work and was tried: `['maplibre','gl'].join('')` is constant-folded
// straight back by the minifier, and the built chunk still contained it. Controlling WHERE this
// module is reachable from is the mechanism; obscuring the spelling is not.
const MAPLIBRE_MARKER = 'maplibregl';

/**
 * The ceiling, stated in the UI rather than hidden in a comment: absolute clock correctness is
 * NOT locally answerable. Detecting that this device's clock is minutes or hours off needs a
 * trusted time source, i.e. a network, which this screen deliberately does not use. What IS
 * locally answerable is the ZONE comparison below. (The HLC skew clamp in `core/sync/hlc.ts`
 * is not a clock check — it absorbs a PEER's clock, per D-228.)
 */
const CLOCK_CEILING =
  ' Offline we can only compare time zones — confirming the exact time needs a trusted time source, which needs a connection.';

/** "UTC+5:45" / "UTC−5:00" — the sign is a real minus glyph, not a hyphen. */
export function formatUtcOffset(offsetMin: number): string {
  const sign = offsetMin < 0 ? '−' : '+';
  const abs = Math.abs(offsetMin);
  return `UTC${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
}

/** "NPT (UTC+5:45)" when the offset is one this trip knows, else the bare offset (D-286-style: never invent a label). */
function zoneLabel(offsetMin: number): string {
  const abbrev = zoneAbbrevForOffset(offsetMin);
  return abbrev ? `${abbrev} (${formatUtcOffset(offsetMin)})` : formatUtcOffset(offsetMin);
}

/** Compact byte size for a quota line. GB above 1e9, else MB — no library, no precision theatre. */
function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

// ── 1. Map shell ────────────────────────────────────────────────────────────────────────────
/**
 * "Is the map ENGINE in the offline install?" — deliberately NOT "is the offline map ready".
 *
 * 🔴 D-286 BINDS THIS COPY. There is no offline map and there is not going to be one: basemap
 * tiles come from `basemaps.cartocdn.com`, which is cross-origin, and the SW's first fetch-handler
 * line passes cross-origin through untouched, so tiles are never cached. Offline PMTiles was
 * closed NO-GO (D-173 → D-197: 180 MB–3.7 GB against a 100 MB cap). The maplibre ENGINE is not
 * precached either (V6-14): it is RUNTIME-cached into the precache on the first ONLINE `/map`
 * visit, and once it is there it buys pins and the route line on a navy canvas — no street
 * imagery. Say that and no more.
 *
 * Cached is not the same as present (never opened `/map` online, storage eviction, a cold or
 * failed install), which is why this is a real check and not a tautology — and since V6-14 the
 * common answer on a fresh install is "not yet", with one online map visit as the fix. We find
 * the engine the same way the build does: by content match over the cached `.js` entries.
 * Largest-first ordering because the engine is the ~1 MB chunk, so the common answer costs one
 * cached read rather than 124.
 */
export async function checkMapShell(cacheStorage: CacheStorage | undefined): Promise<PreflightCheck> {
  const base = { id: 'map-shell', label: 'Map shell' };
  if (!cacheStorage) {
    return {
      ...base,
      state: 'unknown',
      headline: "Couldn't check",
      detail:
        "This browser doesn't let the page read its offline cache, so we can't confirm what's saved.",
    };
  }
  try {
    const precacheName = (await cacheStorage.keys()).find((n) => n.startsWith(PRECACHE_PREFIX));
    if (!precacheName) {
      return {
        ...base,
        state: 'attention',
        headline: 'Not saved yet',
        detail:
          "The offline copy of the app hasn't been stored on this device. Open the app once more while you still have a connection, then check again.",
      };
    }
    const cache = await cacheStorage.open(precacheName);
    const entries: { res: Response; size: number }[] = [];
    for (const req of await cache.keys()) {
      if (!req.url.endsWith('.js')) continue;
      const res = await cache.match(req);
      // KNOWN CEILING: `content-length` is only a HINT for ordering — an entry without one
      // sorts last (size 0) and is STILL read, so a header-less cache costs speed, never
      // correctness. Worst case is one text read per cached `.js` entry (~124 today, ~3 MB),
      // paid once on mount of a screen the traveler opened deliberately.
      if (res) entries.push({ res, size: Number(res.headers.get('content-length')) || 0 });
    }
    entries.sort((a, b) => b.size - a.size);
    for (const { res } of entries) {
      if ((await res.text()).includes(MAPLIBRE_MARKER)) {
        return {
          ...base,
          state: 'ok',
          headline: 'Saved on this device',
          detail:
            "The map's engine is downloaded, so offline you still get your pins and your route. The map background needs a connection — street imagery is never saved.",
        };
      }
    }
    return {
      ...base,
      state: 'attention',
      headline: 'Map engine not saved yet',
      detail:
        "The map's engine is saved the first time you open the map with a connection. Do that once and the map opens offline afterwards, with your pins and your route on it.",
    };
  } catch {
    return {
      ...base,
      state: 'unknown',
      headline: "Couldn't check",
      detail: "Reading the offline cache failed, so we can't confirm what's saved.",
    };
  }
}

// ── 2. Storage room ─────────────────────────────────────────────────────────────────────────
/**
 * `navigator.storage.estimate()`, the same read `components/storage-persistence.tsx` already
 * does — this one renders the ratio as a row instead of throwing a toast at 90%.
 * A browser that reports no usable quota is `'unknown'`, never a pass.
 */
export async function checkStorage(storage: StorageManager | undefined): Promise<PreflightCheck> {
  const base = { id: 'storage', label: 'Storage room' };
  const cannotTell: PreflightCheck = {
    ...base,
    state: 'unknown',
    headline: "Couldn't check",
    detail: "This browser doesn't report how much room is left, so we can't confirm there's space.",
  };
  if (typeof storage?.estimate !== 'function') return cannotTell;
  try {
    const { usage, quota } = await storage.estimate();
    // Typed guards, not falsiness: `usage` of 0 is a LEGITIMATE answer (a fresh profile, and some
    // Safari ITP states) and `!usage` reported that as "couldn't check" — the one reading where
    // having the most room possible looked like having no answer.
    if (typeof usage !== 'number' || typeof quota !== 'number' || quota <= 0) return cannotTell;
    const ratio = usage / quota;
    const used = `Using ${formatBytes(usage)} of ${formatBytes(quota)} (${Math.round(ratio * 100)}%)`;
    return ratio >= QUOTA_WARN_THRESHOLD
      ? {
          ...base,
          state: 'attention',
          headline: 'Nearly full',
          detail: `${used}. Free up space — or export your trip from the Plan page — before you fly.`,
        }
      : {
          ...base,
          state: 'ok',
          headline: 'Room to spare',
          detail: `${used} of what this browser allows the app.`,
        };
  } catch {
    return cannotTell;
  }
}

// ── 3. Clock & time zone ────────────────────────────────────────────────────────────────────
export interface ClockInput {
  /** The DEVICE's real offset, minutes east of UTC (`-new Date().getTimezoneOffset()`). */
  deviceOffsetMin: number;
  /** The offset tonight's leg runs on, or `null` when the trip carries no geography. */
  tripOffsetMin: number | null;
  /** That leg's country label, for the copy ("Nepal runs UTC+5:45"). */
  tripPlace: string;
  /** True once the real clock is inside the trip window — a mismatch only MATTERS then. */
  onTrip: boolean;
  /** The `?today=` simulated day, or `null`. */
  simulatedDay: string | null;
}

/**
 * The clock rows: the zone comparison, plus a SEPARATE simulated-clock row when `?today=` is
 * active. Pure — `readClockChecks()` below does the reading.
 *
 * 🔴 THE `?today=` TRAP. `getNow()` returns local noon of the faked day when the override is set
 * (`lib/trip-now.ts`), so a readiness screen built on `getNow()` would confidently report a
 * correct clock while the clock is deliberately fake. The comparison therefore reads the REAL
 * `new Date()`, and the override gets its own visible row instead of being silently absorbed.
 *
 * A mismatch is only "attention" when we are ON the trip. The night before flying, a phone on
 * home time is the NORMAL state — failing every traveler for it would train them to ignore this
 * screen, so pre-trip it reports the two zones as fact and calls it expected.
 */
export function evaluateClock(input: ClockInput): PreflightCheck[] {
  const { deviceOffsetMin, tripOffsetMin, tripPlace, onTrip, simulatedDay } = input;
  const base = { id: 'clock', label: 'Clock & time zone' };
  const device = zoneLabel(deviceOffsetMin);

  let clock: PreflightCheck;
  if (tripOffsetMin === null) {
    clock = {
      ...base,
      state: 'unknown',
      headline: "Couldn't compare",
      detail: `This trip has no time zone set, so there's nothing to compare your phone's ${device} against.${CLOCK_CEILING}`,
    };
  } else if (tripOffsetMin === deviceOffsetMin) {
    clock = {
      ...base,
      state: 'ok',
      headline: 'Phone is on trip time',
      detail: `Your phone is on ${device}, the same zone as ${tripPlace}.${CLOCK_CEILING}`,
    };
  } else if (onTrip) {
    clock = {
      ...base,
      state: 'attention',
      headline: "Phone isn't on trip time",
      detail: `Your phone is on ${device}, but today's leg — ${tripPlace} — runs ${zoneLabel(tripOffsetMin)}. Times may read wrong until your phone picks up the local zone.${CLOCK_CEILING}`,
    };
  } else {
    clock = {
      ...base,
      state: 'ok',
      headline: 'Phone is on home time',
      detail: `Your phone is on ${device}; ${tripPlace} runs ${zoneLabel(tripOffsetMin)}. That's expected before you fly — the app shows trip times in trip time.${CLOCK_CEILING}`,
    };
  }

  if (simulatedDay === null) return [clock];
  return [
    clock,
    {
      id: 'simulated-clock',
      label: 'Simulated clock',
      state: 'attention',
      headline: 'Simulated clock active',
      detail: `The app is treating ${simulatedDay} as today (the ?today= demo switch), so day numbers and countdowns are demo values, not real ones. Add ?today=off to the address bar to go back to your phone's clock.`,
    },
  ];
}

/** Gather the clock I/O — the REAL clock, never `getNow()` — and evaluate it. */
export function readClockChecks(): PreflightCheck[] {
  const real = new Date();
  const tripOffsetMin = tripOffsetMinFor(real);
  const trip = getActiveTrip();
  getNow(); // resolves a URL `?today=` into sessionStorage so the read below sees it
  return evaluateClock({
    deviceOffsetMin: -real.getTimezoneOffset(),
    tripOffsetMin,
    tripPlace:
      trip.legs.find((l) => l.utcOffsetMin === tripOffsetMin)?.countryLabel ?? trip.legs[0].countryLabel,
    onTrip: dayInTripFor(real, tripOffsetMin) !== null,
    simulatedDay: clockOverride.get(),
  });
}

// ── 4. Trip data synced ─────────────────────────────────────────────────────────────────────
/**
 * The outbox count (`hooks/use-sync-status.ts`), which is the durable, reload-surviving,
 * cross-domain fact — not Firestore's per-snapshot `hasPendingWrites` (D-193).
 *
 * The `{pending: 0, lastAckAt: null}` shape is BOTH "dormant/guest build" and "never synced
 * anything yet". It renders neutrally: nothing is queued and the trip is on the device, which is
 * true in every one of those cases — but it never claims a server confirmed anything.
 */
export function evaluateSync(
  status: { pending: number; blocked?: number; lastAckAt: string | null },
  now: Date = new Date()
): PreflightCheck {
  const base = { id: 'sync', label: 'Trip data' };
  // #267 — checked BEFORE `pending`, of which it is a subset. The pending row promises these
  // "will upload on their own next time you're online", and for a change the rules REFUSED that
  // sentence is false: no amount of connectivity lands it. This module's whole rule is that
  // anything unknown or stuck has to say so, so a refusal gets its own row rather than hiding
  // inside a count that reads as merely offline. Optional so existing callers are unaffected.
  const blocked = status.blocked ?? 0;
  if (blocked > 0) {
    return {
      ...base,
      state: 'attention',
      headline: `${blocked} change${blocked === 1 ? '' : 's'} the shared trip refused`,
      detail:
        "They're saved on this device and nothing is lost, but they will not upload on their own. If you were just added to this trip, reload the page; otherwise ask a member to add this device in Settings, under Trip access.",
    };
  }
  if (status.pending > 0) {
    const n = status.pending;
    return {
      ...base,
      state: 'attention',
      headline: `${n} change${n === 1 ? '' : 's'} waiting to upload`,
      detail:
        "They're saved on this device and will upload on their own next time you're online. Nothing is lost if you fly now.",
    };
  }
  const relative = formatRelativeTime(status.lastAckAt ?? undefined, now);
  if (relative) {
    return {
      ...base,
      state: 'ok',
      headline: "Everything's uploaded",
      detail: `Nothing is queued; the last upload was confirmed ${relative}.`,
    };
  }
  return {
    ...base,
    state: 'ok',
    headline: 'Nothing waiting to upload',
    detail: 'Your trip is saved on this device, and nothing is queued to upload.',
  };
}

/**
 * The three environment checks (map shell, storage, clock) — everything except sync, which the
 * component reads reactively from `useSyncStatus()`. Client-only: on the server every API here
 * is absent, which is exactly the `'unknown'` path.
 */
export async function runEnvironmentChecks(): Promise<PreflightCheck[]> {
  const [mapShell, storage] = await Promise.all([
    checkMapShell(typeof caches === 'undefined' ? undefined : caches),
    checkStorage(typeof navigator === 'undefined' ? undefined : navigator.storage),
  ]);
  return [mapShell, storage, ...readClockChecks()];
}
