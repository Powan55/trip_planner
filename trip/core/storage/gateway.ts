/**
 * Typed storage gateway — the ONE module that fronts every ad-hoc persisted
 * web-storage key.
 *
 * This is the single place any of the persisted key *literals* is declared and the
 * single place raw `window.localStorage` / `window.sessionStorage` is touched in app
 * code (the itinerary slot's raw access lives in `core/vault/**`; tests excepted).
 * A grep for `localStorage.` / `sessionStorage.` outside this file (and the
 * Vault + tests) returns zero app hits — that makes the storage-literal rule
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
 * `packing_checklist` slot (formerly key 6) was removed along with the Home
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
  /** sessionStorage — `YYYY-MM-DD` `?today=` override (clock-override, key 8). */
  todayOverride: 'tripPlannerTodayOverride',
  /**
   * localStorage — `Record<city, WeatherNow>` JSON cache of the last successful Open-Meteo
   * response per trip city (weather-cache, key 9). Enables the offline "last updated"
   * fallback (keyless client fetch, no backend). Value shape is owned by
   * `lib/weather.ts` (the gateway is byte-transport only — it does not know the WeatherNow
   * shape). ADDITIVE: a brand-new key, so no back-compat surface changes.
   */
  weatherCache: 'nepal_japan_weather_cache',
  /**
   * localStorage — JSON `BudgetModel` for the trip budget (budget, key 10). Holds per-leg
   * + per-category budgets in each leg's LOCAL currency, the home/display currency, and the
   * user-overridable (build-seeded) exchange rates. Client-side only, offline-safe, ZERO rate
   * APIs. Value shape is owned by `core/budget/model.ts` (the gateway is byte-
   * transport only — it does not know the BudgetModel shape). ADDITIVE: a brand-new key, so no
   * back-compat surface changes and NO migration (it is NOT part of the itinerary Vault).
   */
  budget: 'nepal_japan_budget',
  /**
   * localStorage — JSON `Expense[]` for logged trip expenses (expenses, key 11). Each
   * entry holds an amount in the leg's LOCAL currency (NPR / JPY, mirroring the budget model),
   * a leg, a category, and optional date/note. Client-side only, offline-safe. Value shape is
   * owned by `core/budget/expenses.ts` (the gateway is byte-transport only
   * — it does not know the Expense shape). ADDITIVE: a brand-new key, so no back-compat surface
   * changes and NO migration (it is NOT part of the itinerary Vault; it mirrors the key-10
   * `budgetStore` pattern exactly). The aggregate feeds the budget `rollUp` `spent` seam.
   */
  expenses: 'nepal_japan_expenses',
  /**
   * localStorage — JSON `JournalEntry[]` for the in-trip per-day text journal (journal, key 12).
   * Each entry holds a `YYYY-MM-DD` trip day (≤ 1 entry per date), a free-text body, an
   * optional mood, and an optional highlight. Client-side only, offline-safe; photos
   * / IndexedDB are OUT (a declared future boundary). Value shape is
   * owned by `core/journal/model.ts` (the gateway is byte-transport only — it does not know the
   * JournalEntry shape). ADDITIVE: a brand-new key, so no back-compat surface changes and NO migration
   * (it is NOT part of the itinerary Vault; it mirrors the key-11 `expensesStore` pattern exactly).
   */
  journal: 'nepal_japan_journal',
  /**
   * sessionStorage — presence flag `'1'` marking that the ChunkLoadError handler has already
   * auto-reloaded ONCE this session (key 13). SESSION store (mirrors the today-override's session
   * precedent): a chunk-load race should be recovered by a single reload; if it recurs after that
   * reload the flag is set, so the handler logs and STOPS instead of looping. Cleared naturally
   * when the tab closes. ADDITIVE: a brand-new key, no back-compat surface changes.
   */
  chunkReloadOnce: 'chunk_reload_once',
  /**
   * localStorage — JSON `string[]` of favorited `Recommendation` ids (favorites, key 14).
   * Guides-scoped bookmarks across both countries' recommendation cards (`na…`/`ja…`
   * ids from `lib/nepal-data.ts` / `lib/japan-data.ts`). Client-side only, offline-safe,
   * local-only (NOT part of any sync/Firebase path). Value shape is owned by
   * `hooks/use-favorites.ts` (the gateway is byte-transport only). ADDITIVE: a brand-new key,
   * no back-compat surface changes and NO migration (it is NOT part of the itinerary Vault;
   * mirrors the key-12 `journalStore` pattern exactly).
   */
  favorites: 'nepal_japan_favorites',
  /**
   * localStorage — JSON `OutboxSlot` for the offline sync push outbox (sync-outbox, key 15).
   * Records WHICH chunks have unconfirmed local changes per synced domain
   * (`{ version, dirty: { itinerary?: string[]; expenses?: string[]; budget?: string[] } }`),
   * so an offline edit survives a reload and is re-pushed exactly once on reconnect. STATE-
   * based (dirty-chunk sets), NOT an op-log. Client-side only; the value shape is owned by
   * `core/sync/outbox.ts` (the gateway is byte-transport only). Written ONLY on a configured +
   * identified-traveler build (the outbox self-gates), so the dormant/guest build NEVER touches
   * this key and stays byte-identical. ADDITIVE: a brand-new key, no back-compat
   * surface changes and NO migration (it is NOT part of the itinerary Vault). NOTE: an earlier
   * sketch reserved key 14 for this slot, but favorites took 14 first — the outbox is
   * the next free number, key 15.
   */
  syncOutbox: 'nepal_japan_sync_outbox',
  /**
   * localStorage — JSON `PhotoMeta[]` photo-metadata index (photos, key 16).
   * METADATA ONLY — blob bytes live in IndexedDB behind `BlobStorePort`, NEVER in web storage.
   * Local-only: NOT part of the itinerary Vault, NOT part of any sync path;
   * NO photo field exists on any synced/Vault schema (the photo↔owner link lives only here). Value
   * shape owned by `core/photos/model.ts` (the gateway is byte-transport only). ADDITIVE: a brand-new
   * key, no back-compat surface changes and NO migration. Mirrors `favoritesStore`/`journalStore`. */
  photos: 'nepal_japan_photos',
  /**
   * localStorage — presence flag `'1'` marking the first-run guided tour has been seen
   * (first-run-tour, key 17). Gates a ≤5-step coach-mark stepper (Today · Plan ·
   * Budget · Journal · Map) shown exactly once, right after the TokenGate first resolves
   * (a traveler signs in OR opts into guest). Local-only (mirrors `chunkReloadGuard`'s
   * presence-flag shape, but on the LOCAL store since this must survive a reload, unlike
   * the session-scoped chunk guard) — NOT part of any sync path. `tourStore.hasSeenTour()`
   * is the presence read; `markTourSeen()` sets it on Skip OR finishing the last step —
   * either path is terminal (exactly-once, reload-proof). ADDITIVE: a brand-new key, no
   * back-compat surface changes and NO migration.
   */
  firstRunTour: 'nepal_japan_first_run_tour_seen',
} as const;

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
 * `clearIdentity` clears BOTH the name AND the token — this is a cross-module ownership
 * risk worth calling out: `token-auth.ts`'s sign-out historically removed
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
 * appeared in THREE places, including the raw literal in `navbar.tsx`.
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
 * CRITICAL: this value is stored as `String(boolean)` (`'true'` / `'false'`),
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
 * (this key is sessionStorage and must NEVER migrate to localStorage). The
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
 * Weather cache slot (key 9) — the last successful Open-Meteo response PER CITY, so the
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
    const map = readJson<Record<string, T>>('local', STORAGE_KEYS.weatherCache, {});
    return Object.prototype.hasOwnProperty.call(map, city) ? map[city] : null;
  },
  set<T>(city: string, value: T): void {
    const map = readJson<Record<string, T>>('local', STORAGE_KEYS.weatherCache, {});
    map[city] = value;
    writeJson('local', STORAGE_KEYS.weatherCache, map);
  },
} as const;

/**
 * Budget slot (key 10) — the trip `BudgetModel` JSON. localStorage backend;
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
    return readJson<T>('local', STORAGE_KEYS.budget, fallback);
  },
  set<T>(model: T): void {
    writeJson('local', STORAGE_KEYS.budget, model);
  },
} as const;

/**
 * Expenses slot (key 11) — the trip `Expense[]` JSON list. localStorage backend;
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
    return readJson<T>('local', STORAGE_KEYS.expenses, fallback);
  },
  set<T>(expenses: T): void {
    writeJson('local', STORAGE_KEYS.expenses, expenses);
  },
} as const;

/**
 * Journal slot (key 12) — the in-trip per-day `JournalEntry[]` JSON list. localStorage backend;
 * additive, no migration, NOT part of the itinerary Vault. Mirrors `expensesStore` exactly.
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
    return readJson<T>('local', STORAGE_KEYS.journal, fallback);
  },
  set<T>(entries: T): void {
    writeJson('local', STORAGE_KEYS.journal, entries);
  },
} as const;

/**
 * Chunk-reload guard slot (key 13) — a one-shot-per-session flag for the ChunkLoadError
 * auto-reload. SESSION store (mirrors the `?today=` sessionStorage handling above): `hasReloaded()`
 * is the presence signal, `markReloaded()` sets it before the handler triggers `window.location
 * .reload()`. This lets the handler recover a dev/first-load chunk race with a single reload while
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
 * Favorites slot (key 14) — the guides-scoped bookmarked-recommendation `string[]` of
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
    return readJson<T>('local', STORAGE_KEYS.favorites, fallback);
  },
  set<T>(ids: T): void {
    writeJson('local', STORAGE_KEYS.favorites, ids);
  },
} as const;

/**
 * Photos slot (key 16) — the `PhotoMeta[]` photo-metadata index JSON. localStorage backend;
 * additive, no migration, local-only (NOT part of the itinerary Vault, NOT part of any
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
    return readJson<T>('local', STORAGE_KEYS.photos, fallback);
  },
  set<T>(metas: T): void {
    writeJson('local', STORAGE_KEYS.photos, metas);
  },
} as const;

/**
 * First-run tour slot (key 17) — a one-shot-ever presence flag. LOCAL store (unlike
 * `chunkReloadGuard`'s session-scoped one-shot-per-session flag): the tour must stay
 * dismissed across a reload/new tab, forever, until storage is explicitly cleared.
 * `hasSeenTour()` reads presence (any stored value counts); `markTourSeen()`
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
