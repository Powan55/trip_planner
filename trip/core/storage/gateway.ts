/**
 * Typed storage gateway — the ONE module that fronts every ad-hoc persisted
 * web-storage key.
 *
 * This is the single place any of the persisted key *literals* is declared and the
 * single place raw `window.localStorage` / `window.sessionStorage` is touched in app
 * code.
 * After a grep for `localStorage.` / `sessionStorage.` outside this file (and the
 * Vault + tests) returns zero app hits — that makes storage-literal rule
 * *structural* rather than a convention.
 *
 * BACK-COMPAT IS ABSOLUTE (the hard constraint for a LIVE, sync-enabled site): the
 * on-disk key *strings* and value *shapes* are byte-identical to the pre-gateway code.
 * The gateway is a typed wrapper over the SAME bytes — the only thing that moved is
 * where each string constant is declared, not what it is. Every deployed browser reads
 * guest flag / name / token / nightlife-pref / today-override identically.
 *
 * Store-per-key: the gateway spans BOTH web-storage backends because
 * `tripPlannerTodayOverride` is genuinely sessionStorage. Each slot declares its
 * `Store`; the gateway does NOT unify or migrate across backends — session vs local is a
 * per-key fact preserved verbatim.
 *
 * SSR-safe + never-throw: every accessor guards on
 * `typeof window === 'undefined'` (read → typed fallback, write → no-op) and wraps every
 * get/set/remove in try/catch so quota / disabled-storage / privacy-mode degrade quietly.
 * The gateway NEVER throws to a caller — the invariant that already held in each source
 * module, made uniform and centrally tested here.
 */

// ── Store selector ──────────────────────────────────────────────────────────
export type Store = 'local' | 'session';

/**
 * Resolve the backing web-storage object for a store, or `null` when it is
 * unavailable (SSR — no window). Kept internal; the primitives call it and degrade to
 * the SSR/no-op path on `null`.
 */
function backing(store: Store): Storage | null {
  if (typeof window === 'undefined') return null;
  return store === 'session' ? window.sessionStorage : window.localStorage;
}

// ── The single key registry ────────────────────────
/**
 * Every persisted web-storage key literal lives here and NOWHERE else. Each entry pins
 * the exact on-disk string (unchanged) and its store. The previously duplicated raw
 * literals (`tripPlannerGuest` across navbar/token-gate/use-active-traveler,
 * `tripPlannerUserName` across identity/token-auth) now collapse to a single reference
 * each.
 *
 * NOTE: the itinerary keys (`nepal_japan_itinerary` + `…_corrupt`) are deliberately NOT
 * here — they stay owned by `lib/itinerary-storage.ts` / the Vault. The
 * `packing_checklist` slot (formerly key 6) was removed in S113D along with the Home
 * packing checklist feature; the key numbering (7 onward) is kept as historical
 * documentation rather than renumbered. This registry is the SIX non-itinerary
 * persisted keys only.
 */
export const STORAGE_KEYS = {
  /** localStorage — plain display-name string (identity, key 3). */
  userName: 'tripPlannerUserName',
  /** localStorage — plain traveler-token string (identity, key 4). */
  token: 'tripPlannerToken',
  /** localStorage — presence flag `'1'` for guest browsing (session/gate, key 5). */
  guest: 'tripPlannerGuest',
  /** localStorage — boolean-as-string (`String(next)`) nightlife visibility (ui-prefs, key 7). */
  nightlifeVisible: 'nightlife_section_visible',
  /** sessionStorage — `YYYY-MM-DD` `?today=` override. */
  todayOverride: 'tripPlannerTodayOverride',
  /**
   * localStorage — `Record<city, WeatherNow>` JSON cache of the last successful Open-Meteo
   * response per trip city. Enables the offline "last updated"
   * fallback. Value shape is owned by
   * `lib/weather.ts` (the gateway is byte-transport only — it does not know the WeatherNow
   * shape). ADDITIVE: a brand-new key, so no back-compat surface changes.
   */
  weatherCache: 'nepal_japan_weather_cache',
  /**
   * localStorage — JSON `BudgetModel` for the trip budget. Holds per-leg
   * + per-category budgets in each leg's LOCAL currency, the home/display currency, and the
   * user-overridable (build-seeded) exchange rates. Client-side only, offline-safe, ZERO rate
   * APIs. Value shape is owned by `core/budget/model.ts` (the gateway is byte-
   * transport only — it does not know the BudgetModel shape). ADDITIVE: a brand-new key, so no
   * back-compat surface changes and NO migration (it is NOT part of the itinerary Vault).
   */
  budget: 'nepal_japan_budget',
  /**
   * localStorage — JSON `Expense[]` for logged trip expenses. Each
   * entry holds an amount in the leg's LOCAL currency (NPR / JPY, mirroring the budget model,
   *), a leg, a category, and optional date/note. Client-side only, offline-safe (/
   *). Value shape is owned by `core/budget/expenses.ts` (the gateway is byte-transport only
   * — it does not know the Expense shape). ADDITIVE: a brand-new key, so no back-compat surface
   * changes and NO migration (it is NOT part of the itinerary Vault; it mirrors the key-10
   * `budgetStore` pattern exactly). The aggregate feeds `rollUp` `spent` seam.
   */
  expenses: 'nepal_japan_expenses',
  /**
   * localStorage — JSON `JournalEntry[]` for the in-trip per-day text journal (journal, key 12;
   *). Each entry holds a `YYYY-MM-DD` trip day (≤ 1 entry per date), a free-text body, an
   * optional mood, and an optional highlight. Client-side only, offline-safe; photos
   * / IndexedDB are OUT (the XL photo phase of #11 is a declared future boundary). Value shape is
   * owned by `core/journal/model.ts` (the gateway is byte-transport only — it does not know the
   * JournalEntry shape). ADDITIVE: a brand-new key, so no back-compat surface changes and NO migration
   * (it is NOT part of the itinerary Vault; it mirrors the key-11 `expensesStore` pattern exactly).
   */
  journal: 'nepal_japan_journal',
  /**
   * sessionStorage — presence flag `'1'` marking that the ChunkLoadError handler has already
   * auto-reloaded ONCE this session. SESSION store: a
   * chunk-load race should be recovered by a single reload; if it recurs after that reload the
   * flag is set, so the handler logs and STOPS instead of looping. Cleared naturally when the tab
   * closes. ADDITIVE: a brand-new key, no back-compat surface changes.
   */
  chunkReloadOnce: 'chunk_reload_once',
  /**
   * localStorage — JSON `string[]` of favorited `Recommendation` ids (favorites, key 14;
   *). Guides-scoped bookmarks across both countries' recommendation cards (`na…`/`ja…`
   * ids from `lib/nepal-data.ts` / `lib/japan-data.ts`). Client-side only, offline-safe,
   * local-only. Value shape is owned by
   * `hooks/use-favorites.ts` (the gateway is byte-transport only). ADDITIVE: a brand-new key,
   * no back-compat surface changes and NO migration (it is NOT part of the itinerary Vault;
   * mirrors the key-12 `journalStore` pattern exactly).
   */
  favorites: 'nepal_japan_favorites',
  /**
   * localStorage — JSON `OutboxSlot` for the offline sync push outbox (sync-outbox, key 15;
   *). Records WHICH chunks have unconfirmed local changes per synced domain
   * (`{ version, dirty: { itinerary?: string[]; expenses?: string[]; budget?: string[] } }`),
   * so an offline edit survives a reload and is re-pushed exactly once on reconnect. STATE-
   * based (dirty-chunk sets), NOT an op-log. Client-side only; the value shape is owned by
   * `core/sync/outbox.ts` (the gateway is byte-transport only). Written ONLY on a configured +
   * identified-traveler build (the outbox self-gates), so the dormant/guest build NEVER touches
   * this key and stays byte-identical. ADDITIVE: a brand-new key, no back-compat
   * surface changes and NO migration (it is NOT part of the itinerary Vault). NOTE: the
   * sketched key 14 for this slot, but favorites took 14 first — the outbox is
   * the next free number, key 15.
   */
  syncOutbox: 'nepal_japan_sync_outbox',
  /**
   * localStorage — JSON `PhotoMeta[]` photo-metadata index.
   * METADATA ONLY — blob bytes live in IndexedDB behind `BlobStorePort`, NEVER in web storage.
   * Local-only: NOT part of the itinerary Vault, NOT part of any sync path;
   * NO photo field exists on any synced/Vault schema (the photo↔owner link lives only here). Value
   * shape owned by `core/photos/model.ts` (the gateway is byte-transport only). ADDITIVE: a brand-new
   * key, no back-compat surface changes and NO migration. Mirrors `favoritesStore`/`journalStore`. */
  photos: 'nepal_japan_photos',
  /**
   * localStorage — presence flag `'1'` marking the first-run guided tour has been seen
   * Gates a ≤5-step coach-mark stepper (Today · Plan ·
   * Budget · Journal · Map) shown exactly once, right after the TokenGate first resolves
   * (a traveler signs in OR opts into guest). Local-only (mirrors `chunkReloadGuard`'s
   * presence-flag shape, but on the LOCAL store since this must survive a reload, unlike
   * the session-scoped chunk guard) — NOT part of any sync path. `tourStore.hasSeenTour()`
   * is the presence read; `markTourSeen()` sets it on Skip OR finishing the last step —
   * either path is terminal (exactly-once, reload-proof). ADDITIVE: a brand-new key, no
   * back-compat surface changes and NO migration.
   */
  firstRunTour: 'nepal_japan_first_run_tour_seen',
  /**
   * localStorage — the active trip-pack id pointer. PACK-INDEPENDENT:
   * this key is NEVER itself namespaced — it is the pointer that drives namespacing. Absent
   * ⇒ the default pack (grandfather). Written only by the switcher, which then does a full
   * reload. APP-SCOPED: deliberately NOT in `TripScopedSlot`, so
   * `keyFor` cannot be handed it (type error). ADDITIVE: a brand-new key, no back-compat surface
   * change and NO migration (an existing browser with no pointer resolves to the default pack).
   */
  activeTrip: 'tripPlannerActiveTrip',
  /**
   * localStorage — boolean-as-string (`String(next)`) Travel Mode outdoor high-legibility
   * toggle. Mirrors `nightlifeVisible`'s (key 7) exact
   * `uiPrefs` shape — lenient `=== 'true'` read, `String(boolean)` write, NOT JSON — this is
   * v5's deliberate TM-LOCAL substitute for a site-wide light mode: flipping it
   * ON stamps `html[data-tm-legibility='high']` (only while mounted on `/travel`, removed on
   * route leave/unmount) so `globals.css` can re-value the semantic tokens for a higher-
   * contrast, larger-type presentation. ADDITIVE: a brand-new key, no back-compat surface
   * changes and NO migration.
   */
  travelLegibility: 'nepal_japan_travel_legibility',
  /**
   * localStorage — Travel Mode gateway flag + arrival-toast "seen" marker (travel-mode, key 19;
   * /). A 3-STATE presence string, NOT JSON: ABSENT = never entered, toast never
   * shown; `'seen'` = the arrival toast was dismissed OR Travel Mode was entered-then-exited
   * (suppress the toast forever, and NO PWA-relaunch re-enter); `'active'` = currently IN Travel
   * Mode (a PWA relaunch re-enters `/travel`). Folded into ONE key deliberately ( — no extra
   * key for "seen"): `'active'` implies seen, so `hasSeen()` is mere key-presence. LOCAL store so it
   * survives a reload/relaunch (unlike the session-scoped chunk guard). GUEST-BLOCKED — never written
   * for a guest. ADDITIVE: brand-new key, no back-compat surface change and NO migration. */
  travelMode: 'nepal_japan_travel_mode',
  /**
   * sessionStorage — the route to restore when Travel Mode is EXITED (travel-return, key 20;
   *). SESSION store: an in-app entry records the exact
   * `pathname+search` it left from so the exit X returns there with NO history trap; a cold start /
   * PWA relaunch / deep link into `/travel` has NO stored value → the exit X falls back to `/`.
   * Cleared on exit and on a relaunch re-enter. Value shape is a plain route string (byte-transport
   * only). ADDITIVE: brand-new key, no back-compat surface change and NO migration. */
  travelReturn: 'tripPlannerTravelReturn',
  /**
   * localStorage — JSON `PackingItem[]` packing checklist. Country-scoped
   * template (Nepal-leg / Japan-leg / universal items) seeded from a fixed built-in template on
   * first load — NO empty state (: this is genuinely a different item set from the-
   * candidate critical-docs checklist). Client-side only, offline-safe. Value shape
   * owned by `core/packing/model.ts` (the gateway is byte-transport only — it does not know the
   * PackingItem shape). ADDITIVE: a brand-new key, no back-compat surface changes and NO migration
   * (it is NOT part of the itinerary Vault). Mirrors `favoritesStore`/`photosStore` exactly. */
  packing: 'nepal_japan_packing',
  /**
   * localStorage — JSON `Record<dateISO, markerId>` per-day map anchors.
   * Records which map pin a trip day is "anchored" to, so the /map day view can re-order that day's
   * stops by client-side haversine distance from the anchor ( free-tools-only — NO routing
   * API). LOCAL-ONLY, presentation-only: NOT part of the itinerary Vault, NOT part of any sync path
   * ( — the reorder is a derived view; the assigned pin itself rides the existing itinerary CRUD,
   * `addItem`, which is the ONE synced write). Self-healing: an anchor id no longer present among a
   * day's stops simply yields no reorder — so no migration/versioning is needed. Value shape owned by
   * `hooks`/`components/map-section.tsx` (the gateway is byte-transport only). ADDITIVE: a brand-new
   * key, no back-compat surface changes and NO migration. Mirrors `favoritesStore` exactly. */
  dayAnchors: 'nepal_japan_day_anchors',
  /**
   * localStorage — JSON `ShareItem[]` OS-share-target triage inbox.
   * The installed PWA registers as a `share_target` (GET, `scripts/gen-sw.mjs::buildManifest()`);
   * shared title/text/url land here as an unassigned item, triaged to a trip day or deleted. Held
   * NEWEST-FIRST, capped at 100 (drop-oldest, `core/share/model.ts` `SHARE_CAP`) so the value stays
   * small. localStorage backend; additive, no migration, LOCAL-ONLY (NOT part of the
   * itinerary Vault, NOT part of any sync path). Value shape owned by `core/share/model.ts` (the
   * gateway is byte-transport only). ADDITIVE: a brand-new key, no back-compat surface changes.
   * Mirrors `favoritesStore`/`packingStore` exactly. */
  shareInbox: 'nepal_japan_share_inbox',
  /**
   * localStorage — the itinerary Vault's main slot. This
   * literal was historically owned by `lib/itinerary-storage.ts` as a bare constant and never
   * routed through the gateway — the ONE trip-scoped domain that predated the registry and was
   * missed by the consolidation. Moved here (byte-identical string) so `keyFor('itinerary')`
   * namespaces a non-default pack's itinerary exactly like every other synced domain (the local-data-
   * bleed fix multi-trip work exposed). The Vault still owns the value SHAPE (versioned
   * envelope, Zod, migrations —); this registry owns only the key string. TRIP-SCOPED. */
  itinerary: 'nepal_japan_itinerary',
  /**
   * localStorage — the itinerary Vault's quarantine slot for corrupt payloads (itinerary-corrupt;
   *). Same move as `itinerary` above — moved verbatim from `lib/itinerary-storage.ts` so
   * a non-default pack quarantines under `trip:{id}:itineraryCorrupt` rather than colliding on the
   * legacy literal. TRIP-SCOPED (paired with `itinerary`). */
  itineraryCorrupt: 'nepal_japan_itinerary_corrupt',
  /**
   * localStorage — a per-device stable id. Minted once via
   * `crypto.randomUUID()` and persisted, read thereafter (mirrors the presence-flag slots' shape).
   * Replaces the Firebase Auth `uid` as the presence heartbeat doc id after the full auth strip
   * with no `request.auth`, presence needs a locally-generated,
   * reload-stable id. APP-SCOPED (NOT in `TripScopedSlot` — it identifies the device, not a trip;
   * one device id is shared across every pack the browser views). ADDITIVE: a brand-new key, no
   * back-compat surface change. */
  deviceId: 'nepal_japan_device_id',
  /**
   * localStorage — JSON `DocItem[]` critical-documents & day-zero-readiness checklist (docs, key 25;
   *). A fixed built-in template (10 critical documents + 8 day-zero readiness items) seeded on
   * first load — check/uncheck + an optional per-item note, NO add/remove. Client-
   * side + offline-safe, AND SYNCED across travelers via the row-merge recipe (a
   * single doc `trips/{tripId}/docs/checklist`, `lib/docs-remote.ts`). TRIP-SCOPED (paired with the
   * remote per-trip doc, like `expenses`/`budget`). Value shape owned by `core/docs/model.ts` (the
   * gateway is byte-transport only). The additive sync stamps (rev/hlc) are written ONLY on a
   * configured build (the hook self-gates), so the dormant/guest slot stays byte-identical.
   * ADDITIVE: a brand-new key, no back-compat surface change and NO migration. */
  docsChecklist: 'nepal_japan_docs_checklist',
  /**
   * localStorage — JSON `TripMeta[]` of known trips. APP-SCOPED (NOT in
   * `TripScopedSlot` — it is the list the pointer selects from, like `activeTrip`). Local-only,
   * additive, no migration. Value shape (parse/sanitize/default-first/self-heal) is owned by
   * `core/trips/registry.ts`.
   */
  knownTrips: 'tripPlannerKnownTrips',
} as const;

// ── Active-trip pointer + trip-scoped key namespacing ──
/**
 * Default pack id. The pack-INDEPENDENT `activeTrip` pointer being unset (or holding this value)
 * resolves to the default pack. Its keys are grandfathered VERBATIM. This is the single
 * source of truth for the id; `core/trips` re-exports it and `lib/firebase-config.ts`'s sync gate
 * reads it. Must equal `firebase-config.ts`'s `NEXT_PUBLIC_TRIP_ID` default string.
 */
export const DEFAULT_TRIP_ID = 'nepal-japan-2026';

/**
 * Read the active pack id, or `DEFAULT_TRIP_ID` when the pointer is unset / SSR / unreadable.
 * TOTAL, never-throws (inherits `readString`). Read per call — the id only changes across a full
 * reload, so there is no cache to invalidate and SSR/first-paint ordering stays trivial.
 */
export function getActiveTripId(): string {
  return readString('local', STORAGE_KEYS.activeTrip) ?? DEFAULT_TRIP_ID;
}

/**
 * Write the active pack id. Write-ONLY — the CALLER performs the full page
 * reload. Never throws.
 */
export function setActiveTripId(id: string): void {
  writeString('local', STORAGE_KEYS.activeTrip, id);
}

/**
 * Raw known-trips accessor pair — byte-transport only, mirroring the
 * `activeTrip` pointer pattern. ALL shape/sanitize/policy logic (TripMeta parse, default-pack-
 * first, self-heal) lives in `core/trips/registry.ts`. APP-SCOPED like the pointer:
 * the list the pointer selects from is itself never namespaced. SSR-safe, never throws.
 */
export function getKnownTripsRaw(): string | null {
  return readString('local', STORAGE_KEYS.knownTrips);
}

export function setKnownTripsRaw(raw: string): void {
  writeString('local', STORAGE_KEYS.knownTrips, raw);
}

/**
 * The trip-scoped slots — the ONLY slots `keyFor` accepts. App-scoped slots (`userName`, `token`,
 * `guest`, `todayOverride`, `chunkReloadOnce`, `firstRunTour`, `nightlifeVisible`, `activeTrip`)
 * are STRUCTURALLY excluded: they are not in this union, so passing one to `keyFor` is a compile
 * error.
 */
export type TripScopedSlot =
  | 'weatherCache'
  | 'budget'
  | 'expenses'
  | 'journal'
  | 'favorites'
  | 'syncOutbox'
  | 'photos'
  | 'itinerary'
  | 'itineraryCorrupt'
  | 'docsChecklist'
  | 'packing'
  | 'dayAnchors'
  | 'shareInbox';

/**
 * Resolve the on-disk key for a trip-scoped slot under the ACTIVE pack:
 * - default pack (id-equality with `DEFAULT_TRIP_ID`, NOT key-absence) ⇒ the legacy literal from
 * `STORAGE_KEYS[slot]` VERBATIM — grandfather, forever byte-identical;
 * - any other pack ⇒ `trip:{activeTripId}:{slot}`, where `slot` is the registry NAME (e.g.
 * `'journal'`), not the legacy literal.
 *
 * Changes ONLY the key STRING — never the `Store`: each slot keeps its own local/session fact
 * `todayOverride` is app-scoped and never routes here, so its sessionStorage fact
 * is untouched. TOTAL, never-throws.
 */
export function keyFor(slot: TripScopedSlot): string {
  const id = getActiveTripId();
  return id === DEFAULT_TRIP_ID ? STORAGE_KEYS[slot] : `trip:${id}:${slot}`;
}

// ── Low-level typed primitives (store-aware, SSR-safe, never-throw) ──────────
// These are the ONLY functions in app code that touch raw web storage. The domain
// accessors below are the public API; keep these lean and total.

/** Read a raw string, or `null` when absent / SSR / storage unreadable. */
export function readString(store: Store, key: string): string | null {
  const s = backing(store);
  if (s === null) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string. No-op during SSR or if storage is unavailable. Never throws. */
export function writeString(store: Store, key: string, value: string): void {
  const s = backing(store);
  if (s === null) return;
  try {
    s.setItem(key, value);
  } catch {
    /* ignore (quota / disabled storage) */
  }
}

/** Remove a key. No-op during SSR or if storage is unavailable. Never throws. */
export function removeKey(store: Store, key: string): void {
  const s = backing(store);
  if (s === null) return;
  try {
    s.removeItem(key);
  } catch {
    /* ignore (disabled storage) */
  }
}

/**
 * Key-presence test: true iff the key is PRESENT, regardless of value
 * (including a stored empty string). False during SSR or if storage is unreadable.
 */
export function hasKey(store: Store, key: string): boolean {
  const s = backing(store);
  if (s === null) return false;
  try {
    return s.getItem(key) !== null;
  } catch {
    return false;
  }
}

/**
 * Read + `JSON.parse` a slot, returning `fallback` on absent / SSR / parse error.
 * Used by the checklist accessor (the only JSON-shaped non-itinerary slot). NOT used for
 * the nightlife pref — that is `String(boolean)`, not JSON (see `uiPrefs`).
 */
export function readJson<T>(store: Store, key: string, fallback: T): T {
  const raw = readString(store, key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** `JSON.stringify` + write a slot. No-op / never-throw exactly like `writeString`. */
export function writeJson<T>(store: Store, key: string, value: T): void {
  // stringify can throw on a cyclic value; keep the whole op total.
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return;
  }
  writeString(store, key, serialized);
}

// ── Domain accessors — the actual public API ───────────────

/**
 * Identity slot (keys 3 + 4). `getName`/`setName` back `lib/identity.ts`;
 * `getToken`/`setToken` back `lib/token-auth.ts`.
 *
 * `clearIdentity` clears BOTH the name AND the token — this is the cross-module ownership
 * the calls out (risk 2): `token-auth.ts`'s sign-out historically removed
 * `tripPlannerUserName` (owned by `identity.ts`) as well as its own token. Centralizing
 * both removals here keeps that behavior exact while removing the duplicated literal.
 *
 * `setName` trims (matching the prior `identity.setUserName` contract verbatim). Tokens
 * are stored as-passed (the caller already resolved the canonical `traveler.token`).
 */
export const identityStore = {
  getName(): string | null {
    return readString('local', STORAGE_KEYS.userName);
  },
  setName(name: string): void {
    writeString('local', STORAGE_KEYS.userName, name.trim());
  },
  getToken(): string | null {
    return readString('local', STORAGE_KEYS.token);
  },
  setToken(token: string): void {
    writeString('local', STORAGE_KEYS.token, token);
  },
  /** Clear BOTH token and name (sign-out). Order is immaterial — both are best-effort. */
  clearIdentity(): void {
    removeKey('local', STORAGE_KEYS.token);
    removeKey('local', STORAGE_KEYS.userName);
  },
} as const;

/**
 * Guest/session gate slot (key 5). The flag is a presence string `'1'`; `isGuest` matches
 * the exact prior semantics (`=== '1'`). `setGuest` writes `'1'`; `clearGuest` removes it
 * (re-arming the Trip Token wall). This is the single home for the flag that previously
 * appeared in THREE places, including the raw literal in `navbar.tsx` (risk 1).
 */
export const sessionGate = {
  isGuest(): boolean {
    return readString('local', STORAGE_KEYS.guest) === '1';
  },
  setGuest(): void {
    writeString('local', STORAGE_KEYS.guest, '1');
  },
  clearGuest(): void {
    removeKey('local', STORAGE_KEYS.guest);
  },
} as const;

/**
 * UI preferences slot (key 7) — the nightlife section's visibility.
 *
 * CRITICAL (risk 3): this value is stored as `String(boolean)` (`'true'` / `'false'`),
 * NOT JSON. The read parses it leniently with `=== 'true'` (any other stored string,
 * including a legacy value, reads as `false`) — it must NOT use `JSON.parse`. The write
 * uses `String(next)`, byte-identical to the component's prior behavior.
 *
 * `getNightlifeVisible` returns `null` when the key is ABSENT so the caller can keep its
 * own default (the component defaults `visible` to `true` and only overrides when a value
 * was actually stored — `if (saved !== null) setVisible(saved === 'true')`). Returning a
 * boolean here instead would silently change that first-visit default.
 */
export const uiPrefs = {
  /** `true`/`false` if a value is stored (lenient `=== 'true'`), or `null` if absent. */
  getNightlifeVisible(): boolean | null {
    const raw = readString('local', STORAGE_KEYS.nightlifeVisible);
    if (raw === null) return null;
    return raw === 'true';
  },
  setNightlifeVisible(value: boolean): void {
    writeString('local', STORAGE_KEYS.nightlifeVisible, String(value));
  },
} as const;

/**
 * Clock-override slot (key 8) — the `?today=` simulation date. SESSION store only
 * The
 * gateway wraps the raw string read/write/remove; all resolution/validation/precedence
 * logic stays in `lib/trip-now.ts` (the gateway is byte-transport only, not policy).
 */
export const clockOverride = {
  get(): string | null {
    return readString('session', STORAGE_KEYS.todayOverride);
  },
  set(value: string): void {
    writeString('session', STORAGE_KEYS.todayOverride, value);
  },
  clear(): void {
    removeKey('session', STORAGE_KEYS.todayOverride);
  },
} as const;

/**
 * Weather cache slot — the last successful Open-Meteo response PER CITY, so the
 * weather card can fall back to a "last updated …" value when a fetch fails (offline / network
 * / non-200). localStorage backend; the whole slot is a `Record<city, T>` JSON map.
 *
 * The gateway is byte-transport only: it does NOT know the `WeatherNow` shape —
 * the value type is a caller-supplied generic `T`, owned by `lib/weather.ts`. `get(city)`
 * returns the cached value or `null` (absent / SSR / corrupt); `set(city, value)` merges the
 * one city into the existing map and writes the whole map back (so caching one city never
 * evicts the other). Never throws (inherits `readJson`/`writeJson`'s total, SSR-safe behavior).
 */
export const weatherCache = {
  get<T>(city: string): T | null {
    const map = readJson<Record<string, T>>('local', keyFor('weatherCache'), {});
    return Object.prototype.hasOwnProperty.call(map, city) ? map[city] : null;
  },
  set<T>(city: string, value: T): void {
    const map = readJson<Record<string, T>>('local', keyFor('weatherCache'), {});
    map[city] = value;
    writeJson('local', keyFor('weatherCache'), map);
  },
} as const;

/**
 * Budget slot — the trip `BudgetModel` JSON. localStorage backend;
 * additive, no migration, NOT part of the itinerary Vault.
 *
 * The gateway is byte-transport only: it does NOT know the `BudgetModel` shape —
 * the value type is a caller-supplied generic `T`, owned by `core/budget/model.ts`. `get(fallback)`
 * returns the parsed slot or `fallback` (absent / SSR / corrupt JSON); the CALLER is responsible
 * for normalizing a partially-valid parsed value into a safe model (`normalizeModel`) — keeping
 * the "make a corrupt slot safe" policy in the budget domain, not in this transport layer.
 * `set(model)` writes the whole model as JSON. Never throws (inherits `readJson`/`writeJson`).
 */
export const budgetStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('budget'), fallback);
  },
  set<T>(model: T): void {
    writeJson('local', keyFor('budget'), model);
  },
} as const;

/**
 * Expenses slot — the trip `Expense[]` JSON list. localStorage backend;
 * additive, no migration, NOT part of the itinerary Vault. Mirrors `budgetStore` exactly.
 *
 * The gateway is byte-transport only: it does NOT know the `Expense` shape — the
 * value type is a caller-supplied generic `T`, owned by `core/budget/expenses.ts`. `get(fallback)`
 * returns the parsed slot or `fallback` (absent / SSR / corrupt JSON); the CALLER normalizes a
 * partially-valid parsed value into a safe `Expense[]` (`sanitizeExpenses`) — keeping the "make a
 * corrupt slot safe" policy in the expense domain, not this transport layer. `set(expenses)` writes
 * the whole list as JSON. Never throws (inherits `readJson`/`writeJson`).
 */
export const expensesStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('expenses'), fallback);
  },
  set<T>(expenses: T): void {
    writeJson('local', keyFor('expenses'), expenses);
  },
} as const;

/**
 * Journal slot — the in-trip per-day `JournalEntry[]` JSON list. localStorage backend
 *; additive, no migration, NOT part of the itinerary Vault. Mirrors `expensesStore` exactly.
 *
 * The gateway is byte-transport only: it does NOT know the `JournalEntry` shape — the
 * value type is a caller-supplied generic `T`, owned by `core/journal/model.ts`. `get(fallback)`
 * returns the parsed slot or `fallback` (absent / SSR / corrupt JSON); the CALLER normalizes a
 * partially-valid parsed value into a safe `JournalEntry[]` (`sanitizeEntries`) — keeping the "make a
 * corrupt slot safe" policy in the journal domain, not this transport layer. `set(entries)` writes the
 * whole list as JSON. Never throws (inherits `readJson`/`writeJson`).
 */
export const journalStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('journal'), fallback);
  },
  set<T>(entries: T): void {
    writeJson('local', keyFor('journal'), entries);
  },
} as const;

/**
 * Chunk-reload guard slot — a one-shot-per-session flag for the ChunkLoadError
 * auto-reload. SESSION store (mirrors the `?today=` sessionStorage handling above): `hasReloaded()`
 * is the presence signal, `markReloaded()` sets it before the handler triggers `window.location
 * reload()`. This lets the handler recover a dev/first-load chunk race with a single reload while
 * refusing to loop if the error persists after that reload. SSR-safe + never-throw (inherited).
 */
export const chunkReloadGuard = {
  hasReloaded(): boolean {
    return readString('session', STORAGE_KEYS.chunkReloadOnce) === '1';
  },
  markReloaded(): void {
    writeString('session', STORAGE_KEYS.chunkReloadOnce, '1');
  },
} as const;

/**
 * Favorites slot — the guides-scoped bookmarked-recommendation `string[]` of
 * ids. localStorage backend; additive, no migration, NOT part of the itinerary Vault,
 * NOT part of any sync path. Mirrors `journalStore`/`expensesStore` exactly.
 *
 * The gateway is byte-transport only: it does NOT know the id shape beyond "a
 * JSON array" — the value type is a caller-supplied generic `T`, owned by `hooks/use-favorites.ts`.
 * `get(fallback)` returns the parsed slot or `fallback` (absent / SSR / corrupt JSON); the CALLER
 * sanitizes a partially-valid parsed value into a safe `string[]` — keeping the "make a corrupt
 * slot safe" policy in the favorites domain, not this transport layer. `set(ids)` writes the whole
 * list as JSON. Never throws (inherits `readJson`/`writeJson`).
 */
export const favoritesStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('favorites'), fallback);
  },
  set<T>(ids: T): void {
    writeJson('local', keyFor('favorites'), ids);
  },
} as const;

/**
 * Photos slot — the `PhotoMeta[]` photo-metadata index JSON. localStorage backend
 *; additive, no migration, local-only (: NOT part of the itinerary Vault, NOT part of any
 * sync path). Mirrors `favoritesStore`/`journalStore` exactly. BLOB BYTES ARE NOT HERE — they live in
 * IndexedDB behind `core/photos/blob-store.ts`; this slot carries only small JSON metadata.
 *
 * The gateway is byte-transport only: it does NOT know the `PhotoMeta` shape — the value
 * type is a caller-supplied generic `T`, owned by `core/photos/model.ts`. `get(fallback)` returns the
 * parsed slot or `fallback` (absent / SSR / corrupt JSON); the CALLER sanitizes (`sanitizePhotos`).
 * `set(metas)` writes the whole list as JSON. Never throws (inherits `readJson`/`writeJson`).
 */
export const photosStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('photos'), fallback);
  },
  set<T>(metas: T): void {
    writeJson('local', keyFor('photos'), metas);
  },
} as const;

/**
 * First-run tour slot — a one-shot-ever presence flag. LOCAL store (unlike
 * `chunkReloadGuard`'s session-scoped one-shot-per-session flag): the tour must stay
 * dismissed across a reload/new tab, forever, until storage is explicitly cleared.
 * `hasSeenTour()` reads presence; `markTourSeen()`
 * writes the `'1'` flag. SSR-safe + never-throw (inherited from `hasKey`/`writeString`).
 */
export const tourStore = {
  hasSeenTour(): boolean {
    return hasKey('local', STORAGE_KEYS.firstRunTour);
  },
  markTourSeen(): void {
    writeString('local', STORAGE_KEYS.firstRunTour, '1');
  },
} as const;

/**
 * Travel Mode outdoor high-legibility toggle slot. Mirrors `uiPrefs`
 * exactly (RISK 3 shape): `String(boolean)`, NOT JSON, lenient `=== 'true'` parse. `get()`
 * returns `null` when the key is ABSENT so the caller (the TM toggle) can start from an
 * explicit "off" default without conflating "never set" and "set false". `set(value)` writes
 * `String(value)`. SSR-safe + never-throw (inherited from `readString`/`writeString`).
 */
export const legibilityPrefs = {
  get(): boolean | null {
    const raw = readString('local', STORAGE_KEYS.travelLegibility);
    if (raw === null) return null;
    return raw === 'true';
  },
  set(value: boolean): void {
    writeString('local', STORAGE_KEYS.travelLegibility, String(value));
  },
} as const;

/**
 * Packing checklist slot — the `PackingItem[]` JSON list. localStorage backend
 *; additive, no migration, NOT part of the itinerary Vault. Mirrors `favoritesStore`/
 * `photosStore` exactly.
 *
 * The gateway is byte-transport only: it does NOT know the `PackingItem` shape —
 * the value type is a caller-supplied generic `T`, owned by `core/packing/model.ts`. `get(fallback)`
 * returns the parsed slot or `fallback` (absent/SSR/corrupt JSON); the CALLER seeds the built-in
 * template when the slot is absent/corrupt/empty (`sanitizeItems`) — keeping that policy in the
 * packing domain, not this transport layer. `set(items)` writes the whole list as JSON. Never
 * throws (inherits `readJson`/`writeJson`).
 */
export const packingStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('packing'), fallback);
  },
  set<T>(items: T): void {
    writeJson('local', keyFor('packing'), items);
  },
} as const;

/**
 * Day-anchors slot — the `Record<dateISO, markerId>` per-day map anchor map.
 * localStorage backend; additive, no migration, LOCAL-ONLY (: NOT part of the
 * itinerary Vault, NOT part of any sync path — it is presentation state driving a derived,
 * client-side proximity reorder). Mirrors `favoritesStore`/`packingStore` exactly.
 *
 * The gateway is byte-transport only: it does NOT know the map's key/value shape
 * beyond "a JSON object" — the value type is a caller-supplied generic `T`, owned by
 * `components/map-section.tsx`. `get(fallback)` returns the parsed slot or `fallback` (absent /
 * SSR / corrupt JSON); `set(map)` writes the whole map as JSON. Never throws (inherits
 * `readJson`/`writeJson`). Self-healing: a stale anchor id simply produces no reorder.
 */
export const dayAnchorStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('dayAnchors'), fallback);
  },
  set<T>(map: T): void {
    writeJson('local', keyFor('dayAnchors'), map);
  },
} as const;

/**
 * Share-inbox slot — the `ShareItem[]` OS-share-target triage inbox JSON list.
 * localStorage backend; additive, no migration, LOCAL-ONLY (NOT part of the itinerary
 * Vault, NOT part of any sync path). Mirrors `favoritesStore`/`packingStore` exactly.
 *
 * The gateway is byte-transport only: it does NOT know the `ShareItem` shape — the
 * value type is a caller-supplied generic `T`, owned by `core/share/model.ts`. `get(fallback)`
 * returns the parsed slot or `fallback` (absent / SSR / corrupt JSON); the CALLER sanitizes
 * (`sanitizeItems`). `set(items)` writes the whole list as JSON. Never throws (inherits
 * `readJson`/`writeJson`).
 */
export const shareInboxStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('shareInbox'), fallback);
  },
  set<T>(items: T): void {
    writeJson('local', keyFor('shareInbox'), items);
  },
} as const;

/**
 * Device-id slot — a per-browser stable id, minted once and persisted.
 * APP-SCOPED (never namespaced by pack). Replaces the Firebase Auth uid as the presence heartbeat
 * doc id after the full auth strip. `getId()` returns the persisted id, minting +
 * writing one via `crypto.randomUUID()` on first need (read thereafter, reload-stable). SSR-safe:
 * with no window the read/write no-op and a fresh (non-persisted) uuid is returned — harmless, since
 * presence only ever runs client-side (its start guards on `window`). Never throws (inherited).
 */
export const deviceStore = {
  getId(): string {
    const existing = readString('local', STORAGE_KEYS.deviceId);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    writeString('local', STORAGE_KEYS.deviceId, id);
    return id;
  },
} as const;

/**
 * Docs-checklist slot — the `DocItem[]` critical-documents & day-zero-readiness
 * checklist JSON list. localStorage backend; SYNCED but the LOCAL slot is
 * byte-transport only, exactly like `expensesStore`. Mirrors `packingStore`/`expensesStore`.
 *
 * The gateway does NOT know the `DocItem` shape — the value type is a caller-supplied generic `T`,
 * owned by `core/docs/model.ts`. `get(fallback)` returns the parsed slot or `fallback` (absent /
 * SSR / corrupt JSON); the CALLER seeds the built-in template when absent/corrupt/empty
 * (`sanitizeItems`). `set(items)` writes the whole list as JSON. Never throws (inherits readJson/
 * writeJson).
 */
export const docsStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('docsChecklist'), fallback);
  },
  set<T>(items: T): void {
    writeJson('local', keyFor('docsChecklist'), items);
  },
} as const;

// NOTE: the Travel Mode accessors for keys 19/20 (`travelModeGate` / `travelReturn`) do NOT
// live here — they are in `core/storage/travel-mode-store.ts`. They compose THIS file's primitives
// (`readString`/`writeString`/`removeKey`) over the `STORAGE_KEYS.travelMode` / `.travelReturn`
// literals declared above, so holds (raw storage + key literals stay in this module). They
// were split out for ONE reason: `gateway.ts` sits in the app-wide First Load chunk (via
// `sessionGate` → `use-active-traveler` → `TokenGate`), and only the non-shared Travel Mode code
// (Home hero / the lazy navbar + toast/exit/relaunch islands) consume these accessors — keeping the
// object literals out of the shared module holds the route budgets at the 106/107 kB line (they were
// otherwise retained in the shared chunk, +~0.6 kB, tipping several routes 106→107).
