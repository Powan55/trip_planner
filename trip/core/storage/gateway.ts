/**
 * Typed storage gateway: the only place app code declares a persisted key literal or touches
 * localStorage/sessionStorage directly (the Vault and tests aside).
 *
 * Key strings and value shapes are existing on-disk data. Never change one without a
 * migration.
 *
 * Each key declares its store (local or session). Every accessor is SSR-safe and never
 * throws: reads fall back, writes no-op, and quota or blocked storage degrade quietly.
 */

import { SHARED_TRIP_ID } from '@/core/trips/shared-trip';

// ── Store selector ──────────────────────────────────────────────────────────
export type Store = 'local' | 'session';

/**
 * The storage object, or null on the server or when access throws. The try/catch matters: with
 * site data blocked, reading `window.localStorage` itself throws SecurityError, and the active
 * trip is resolved at module scope, so unguarded the app wouldn't boot.
 */
function backing(store: Store): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return store === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Every persisted key literal, with its store. Numbers ("key 26") are stable ids used in comments
 * elsewhere; retired numbers are never reused. Scopes:
 * - trip-scoped: listed in TripScopedSlot, namespaced per trip by keyFor, wiped with the trip
 * - app-scoped: device or person data, not namespaced
 * - lifetime: survives every wipe and sign-out (D-314)
 * Value shapes are owned by the module named on each key; the gateway only moves bytes.
 */
export const STORAGE_KEYS = {
  /** localStorage — plain display-name string (identity, key 3). */
  userName: 'tripPlannerUserName',
  /** localStorage — plain traveler-token string (identity, key 4). */
  token: 'tripPlannerToken',
  /**
   * local, JSON string[]: names this user previously went by, so "My edits" still matches items
   * stamped before a rename. Never used to guess who an unknown name is. App-scoped; cleared on
   * sign-out.
   */
  priorNames: 'tripPlannerPriorNames',
  /** localStorage — boolean-as-string (`String(next)`) nightlife visibility (ui-prefs, key 7). */
  nightlifeVisible: 'nightlife_section_visible',
  /** sessionStorage — `YYYY-MM-DD` `?today=` override. */
  todayOverride: 'tripPlannerTodayOverride',
  /** local, JSON Record<city, WeatherNow>: last forecast per city for offline. lib/weather.ts. */
  weatherCache: 'nepal_japan_weather_cache',
  /** local, JSON BudgetModel (key 10): per-leg budgets, display currency, rates. core/budget/model.ts. */
  budget: 'nepal_japan_budget',
  /** local, JSON Expense[] (key 11), amounts in the leg's currency. core/budget/expenses.ts. */
  expenses: 'nepal_japan_expenses',
  /** local, JSON JournalEntry[] (key 12), at most one per day. core/journal/model.ts. */
  journal: 'nepal_japan_journal',
  /** session, '1' (key 13): the ChunkLoadError handler already reloaded once; stops a reload loop. */
  chunkReloadOnce: 'chunk_reload_once',
  /** local, JSON string[] (key 14): favourited guide and map ids. Not synced. hooks/use-favorites.ts. */
  favorites: 'nepal_japan_favorites',
  /**
   * local, JSON OutboxSlot (key 15): which chunks per domain have unpushed changes. Only written
   * when sync is configured and someone is signed in. core/sync/outbox.ts.
   */
  syncOutbox: 'nepal_japan_sync_outbox',
  /** local, JSON PhotoMeta[]: metadata only; bytes live in IndexedDB. Never synced. core/photos/model.ts. */
  photos: 'nepal_japan_photos',
  /** local, '1': first-run tour seen (set on skip or finish). */
  firstRunTour: 'nepal_japan_first_run_tour_seen',
  /** local: active trip id, the pointer keyFor namespaces by. Absent means the sample pack. */
  activeTrip: 'tripPlannerActiveTrip',
  /**
   * local, 'true'/'false': Travel Mode high legibility. On /travel it sets
   * html[data-tm-legibility='high'], which globals.css re-values.
   */
  travelLegibility: 'nepal_japan_travel_legibility',
  /**
   * local (key 19): absent = never entered; 'seen' = toast dismissed or mode exited; 'active' =
   * in Travel Mode, so a PWA relaunch re-enters /travel. Any value means the toast was seen.
   */
  travelMode: 'nepal_japan_travel_mode',
  /** session (key 20): route to return to on leaving Travel Mode; falls back to /. */
  travelReturn: 'tripPlannerTravelReturn',
  /** local, JSON PackingItem[], seeded from a template. core/packing/model.ts. */
  packing: 'nepal_japan_packing',
  /**
   * local, JSON Record<date, markerId> (key 22): each day's map anchor, the base point for
   * distances on /map. Local-only; a stale id is simply ignored.
   */
  dayAnchors: 'nepal_japan_day_anchors',
  /** local, JSON ShareItem[] (key 23): OS share-target inbox, newest first, capped. core/share/model.ts. */
  shareInbox: 'nepal_japan_share_inbox',
  /** local: the itinerary Vault slot. The Vault owns the versioned envelope. Trip-scoped. */
  itinerary: 'nepal_japan_itinerary',
  /** local: quarantine for a corrupt itinerary payload. Trip-scoped. */
  itineraryCorrupt: 'nepal_japan_itinerary_corrupt',
  /** local: random per-device id, used for presence. App-scoped. */
  deviceId: 'nepal_japan_device_id',
  /**
   * local, JSON DocItem[] (key 25): fixed documents checklist, no add/remove. Synced to
   * trips/{id}/docs/checklist. Trip-scoped. core/docs/model.ts.
   */
  docsChecklist: 'nepal_japan_docs_checklist',
  /** local, JSON TripMeta[] (key 26): known trips. App-scoped. core/trips/registry.ts. */
  knownTrips: 'tripPlannerKnownTrips',
  /** session, comma-joined ids (key 27): trips that already did their one trip-meta heal reload. */
  tripMetaSelfHeal: 'trip_meta_self_heal_once',
  /**
   * local (key 28): the account key, a random token. The trip list syncs to
   * trips/{syncCode}/profile/tripList. App-scoped.
   */
  syncCode: 'tripPlannerSyncCode',
  /** local, JSON RemovedTrip[] (key 29): forget tombstones for the trip-list merge. core/trips/registry.ts. */
  removedTrips: 'tripPlannerRemovedTrips',
  /** local, '1' (key 30): install hint dismissed. App-scoped. */
  installHintDismissed: 'nepal_japan_install_hint_dismissed',
  /**
   * local, JSON MyPlace[] (key 31): imported Google Maps places, newest first, capped at 200 live
   * rows plus 200 tombstones. Synced to trips/{id}/places/list when the trip has a remote id
   * (D-229). Trip-scoped. core/places/model.ts and merge.ts.
   */
  myPlaces: 'nepal_japan_my_places',
  /**
   * local, JSON { cities, countries } (key 32): everywhere this person has been. Lifetime: never
   * add it to the wipes below; nothing could rebuild it (D-314). core/places/visited.ts.
   */
  lifetimeVisits: 'tripPlannerLifetimeVisits',
  /**
   * session, comma-joined surface ids (key 33): entrances already played (D-293 rule 7). Survives
   * reloads and route changes, resets when the tab closes; a duplicated tab inherits it.
   */
  motionEntranceSeen: 'motion_entrance_seen',
  /**
   * local, JSON { checkedOn, confirmed[] } (key 34): GPS-confirmed visits. Lifetime, like key 32.
   * Privacy contract (D-320): only { city, country, at } is stored. Never write coordinates or
   * any GeolocationPosition field; the fix is matched to a city in memory and discarded.
   * `checkedOn` is set even on denial, so the check runs at most once a day.
   */
  visitConfirmations: 'tripPlannerVisitConfirmations',
  /**
   * local, JSON string[] (key 35): countries whose passport stamp has been shown. Lifetime, or
   * every stamp would re-unlock after a wipe. Absent is not []: absent seeds from history and
   * celebrates nothing. core/places/passport.ts.
   */
  passportStamps: 'tripPlannerPassportStamps',
  /**
   * session, comma-joined `<weight>:<id>` (key 36): celebrations already fired (D-293 rules 5-6).
   * Same lifetime as key 33. A weight's cap is the count of entries with its prefix.
   */
  motionCelebrationsFired: 'motion_celebrations_fired',
  /** local (key 37): quarantine for a rejected expense import. Trip-scoped. */
  expensesCorrupt: 'nepal_japan_expenses_corrupt',
  /** local, JSON Record<currency, rate> (key 38): exchange-rate cache. App-scoped, never wiped. lib/currency-rate.ts. */
  currencyRateCache: 'nepal_japan_currency_rate_cache',
  /** session, '1' (key 39): login defaulted the name, so nudge a rename once after the reload. */
  nameHint: 'name-hint',
  /** local, 'true'/'false' (key 41): /map keep-awake, off by default. App-scoped. */
  mapWakeLockEnabled: 'nepal_japan_map_wake_lock_enabled',
  /**
   * local, leg id (key 42): leg the backup nudge last fired for. Trip-scoped because leg ids like
   * 'main' repeat across custom trips.
   */
  backupPromptLeg: 'nepal_japan_backup_prompt_leg',
  /**
   * localStorage — JSON `{ role, content, model? }[]`, the concierge thread, last 50 turns
   * (concierge-chat, key 43; D-536). TRIP-SCOPED, so trips never share a thread and sign-out or
   * forgetting a trip wipes it. On this device only: no sync path reads it and the backup export
   * leaves it out. Proposals (ops) are never stored. Shape owned by `hooks/use-concierge-chat.ts`.
   */
  conciergeChat: 'nepal_japan_concierge_chat',
  /**
   * localStorage — plain string, `'kimi'` to try Kimi K3 first, anything else or absent means the
   * Groq default (concierge-provider, key 44; D-535). APP-SCOPED device preference, not trip data.
   */
  conciergeProvider: 'nepal_japan_concierge_provider',
  /**
   * local (key 45, D-542): remote trip id the sample pack syncs to; absent means device-only.
   * Minted per device, never in the bundle. keyFor still namespaces by the pack id, so local
   * bytes don't move when sharing starts.
   */
  defaultTripShare: 'nepal_japan_default_trip_share',
  /**
   * localStorage — JSON `{ shareId, at }`, set when THIS device turned its own default pack into a
   * shared trip (mint, account adopt, or the share dialog), never on a join (key 52; D-651). Lets a
   * backup made before that moment restore into it. Person data: sign-out clears it.
   */
  defaultTripAdopted: 'nepal_japan_default_trip_adopted',
  /**
   * local, JSON string[] (key 46, D-551): trips created on this device, the only ones where the
   * first-snapshot seed may claim owner. Not in the registry, which syncs.
   */
  tripsCreatedHere: 'nepal_japan_trips_created_here',
  /**
   * localStorage — RETIRED (key 47). The per-device sync switch is gone and a stored `'true'` is
   * ignored. The constant stays so the number is not reused.
   */
  syncPaused: 'nepal_japan_sync_paused',
  /**
   * localStorage — JSON `{ [field]: { v, hlc } }`, the local mirror of the account's
   * `trips/{userToken}/profile/prefs` doc (person-prefs, key 48; D-594). Person data, so
   * `wipeAllTripData` removes it on sign-out. Shape owned by `lib/account-prefs-remote.ts`.
   */
  personPrefs: 'nepal_japan_person_prefs',
  /**
   * localStorage — JSON `{ [date]: { hlc, dirty?, deletedAt? } }`, the per-entry sync stamps for
   * the journal's account copy (journal-sync, key 50; D-596). TRIP-SCOPED beside key 12. Sync
   * machinery, not content: the backup leaves it out. Shape owned by `lib/journal-dirty.ts`.
   */
  journalSync: 'nepal_japan_journal_sync',
  /**
   * sessionStorage — `'1'` once this tab has reloaded onto the account's default-pack share id
   * (default-share reload, key 51; D-598). APP-SCOPED. Stops a write that never sticks from
   * reloading forever.
   */
  defaultShareReload: 'nepal_japan_default_share_reload',
  /**
   * localStorage — JSON `{ [date]: { text, mood, highlight } }`, the unsaved journal editor draft
   * (journal-draft, key 53). TRIP-SCOPED beside key 12. On this device only: no sync path reads it
   * and the backup leaves it out. Cleared on Save or Cancel. Shape owned by `components/journal-card.tsx`.
   */
  journalDraft: 'nepal_japan_journal_draft',
  /**
   * localStorage — JSON `{ [slot]: raw }`, the first unreadable copy of each device-only slot
   * (local-rescue, key 54; D-725). TRIP-SCOPED. Written once per slot by `readDeviceOnlyJson`,
   * never overwritten, so the next save cannot destroy the only copy. Not backed up; sign-out
   * and forgetting the trip wipe it like the other quarantine slots.
   */
  localRescue: 'nepal_japan_local_rescue',
  /**
   * local (key 55, D-790): emergency card, medical and contact details. Device-only: no sync,
   * share, backup or concierge path reads it. Trip-scoped. core/ice/ice.ts.
   */
  ice: 'nepal_japan_ice',
  /** local (key 56, D-801): values this device lost in a merge. Device-only. core/sync/conflict-store.ts. */
  conflicts: 'nepal_japan_sync_conflicts',
  /** local (key 58, D-880): trip renames and trip list awaiting push. App-scoped. lib/trips-remote.ts. */
  tripSyncQueue: 'nepal_japan_trip_sync_queue',
} as const;

function tripsCreatedHere(): unknown[] {
  const ids = readJson<unknown>('local', STORAGE_KEYS.tripsCreatedHere, []);
  return Array.isArray(ids) ? ids : [];
}

export function markTripCreatedHere(id: string): void {
  if (id === SHARED_TRIP_ID) return; // the shared trip has no owner device
  const ids = tripsCreatedHere();
  if (!ids.includes(id)) writeJson('local', STORAGE_KEYS.tripsCreatedHere, [...ids, id]);
}

export function wasTripCreatedHere(id: string): boolean {
  return tripsCreatedHere().includes(id);
}

// Active trip and per-trip key namespacing

/** The sample pack's id. Its keys keep their original un-prefixed names. Local-only. */
export const DEFAULT_TRIP_ID = 'nepal-japan-2026';

/**
 * Whether an id is safe as one Firestore path segment. With a `/` in it, the rules would check
 * membership against a different trip than the one written. The other checks reject ids that
 * resolve away or are reserved (`.`, `..`, `__x__`, blank). Used by the registry and firebase-config.
 */
export function isSafeTripSegment(id: string): boolean {
  if (id === '' || id.length > 128) return false;
  if (id === '.' || id === '..') return false;
  if (id.includes('/') || id.includes(' ')) return false;
  // `[\s\S]`, not `.`, which skips U+2028/U+2029. (Not written literally: in a comment they
  // end the line.)
  if (/^__[\s\S]*__$/.test(id)) return false;
  // Control bytes by code point rather than a character class: an escape in a regex literal here
  // has been written through as the raw byte before now, which silently changes what is matched.
  for (let i = 0; i < id.length; i += 1) {
    const code = id.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

/** Active pack id, or DEFAULT_TRIP_ID. Read per call; it only changes across a reload. */
export function getActiveTripId(): string {
  return readString('local', STORAGE_KEYS.activeTrip) ?? DEFAULT_TRIP_ID;
}

/** Caller reloads afterwards. */
export function setActiveTripId(id: string): void {
  writeString('local', STORAGE_KEYS.activeTrip, id);
}

/**
 * The id stored on this device for the default pack, or `''` when none. Not what the pack syncs
 * to: that is `getDefaultTripShareId()`. Trimmed on read so a stray space can't compose into
 * `trips/ abc/days`, a different, silently-empty trip.
 */
export function getStoredDefaultTripShareId(): string {
  return (readString('local', STORAGE_KEYS.defaultTripShare) ?? '').trim();
}

/**
 * Remote id the sample pack syncs to, or '' for local-only. Only lib/account-share.ts writes it,
 * once the account is a member (D-811).
 */
export function getDefaultTripShareId(): string {
  return getStoredDefaultTripShareId();
}

const DEFAULT_SHARE_SYNCED_SLOTS = [
  'syncOutbox',
  'itinerary',
  'expenses',
  'budget',
  'docsChecklist',
  'myPlaces',
] as const satisfies readonly TripScopedSlot[];

/** True when the default pack holds any synced slot a join would replace (D-561). */
export function defaultPackHasSyncedData(): boolean {
  return DEFAULT_SHARE_SYNCED_SLOTS.some(
    (slot) => readString('local', keyForTrip(DEFAULT_TRIP_ID, slot)) !== null,
  );
}

/** Drop the default pack's synced slots so a join starts from the remote trip (D-561). */
export function dropDefaultPackSyncedData(): void {
  for (const slot of DEFAULT_SHARE_SYNCED_SLOTS) removeKey('local', keyForTrip(DEFAULT_TRIP_ID, slot));
}

/** Set or clear ('') the sample pack's remote id. Caller must reload; subscriptions start at boot. */
export function setDefaultTripShareId(id: string): void {
  const trimmed = id.trim();
  // D-561 — the outbox and the synced slots belong to the trip they were edited under, not to the
  // pack. Moving from one shared trip to another would otherwise push them into the new one.
  const prev = getStoredDefaultTripShareId();
  if (trimmed === '') {
    removeKey('local', STORAGE_KEYS.defaultTripShare);
    return;
  }
  // Dropped only once the new id is stored, so a write that fails cannot cost the plan.
  if (writeString('local', STORAGE_KEYS.defaultTripShare, trimmed) && prev !== '' && prev !== trimmed) {
    dropDefaultPackSyncedData();
  }
}

export type DefaultTripAdopted = { shareId: string; at: string };

/** Record that this device's own default pack became shared trip `shareId` (D-651). */
export function markDefaultTripAdopted(shareId: string): void {
  writeJson('local', STORAGE_KEYS.defaultTripAdopted, { shareId, at: new Date().toISOString() });
}

export function getDefaultTripAdopted(): DefaultTripAdopted | null {
  const v = readJson<unknown>('local', STORAGE_KEYS.defaultTripAdopted, null);
  if (typeof v !== 'object' || v === null) return null;
  const { shareId, at } = v as Record<string, unknown>;
  return typeof shareId === 'string' && typeof at === 'string' ? { shareId, at } : null;
}

/** Raw known-trips string; core/trips/registry.ts owns the shape. */
export function getKnownTripsRaw(): string | null {
  return readString('local', STORAGE_KEYS.knownTrips);
}

export function setKnownTripsRaw(raw: string): void {
  writeString('local', STORAGE_KEYS.knownTrips, raw);
}

/**
 * The account id (users/{uid}.accountId, D-660), keying the account's trip list and identity docs.
 * "Sync code" is a historical name kept to avoid churn. Never a Trip Token, never shared.
 */
export function getSyncCode(): string | null {
  return readString('local', STORAGE_KEYS.syncCode);
}

export function setSyncCode(code: string): void {
  // Per-person prefs (key 48) belong to one account; never carry them, dirty edits included, into another.
  if ((getSyncCode()?.trim() ?? '') !== code.trim()) removeKey('local', STORAGE_KEYS.personPrefs);
  writeString('local', STORAGE_KEYS.syncCode, code);
}

/** Raw forget-tombstone string; core/trips/registry.ts owns the shape. */
export function getRemovedTripsRaw(): string | null {
  return readString('local', STORAGE_KEYS.removedTrips);
}

export function setRemovedTripsRaw(raw: string): void {
  writeString('local', STORAGE_KEYS.removedTrips, raw);
}

/** The only slots keyFor accepts; passing an app-scoped one is a type error. */
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
  | 'shareInbox'
  | 'myPlaces'
  | 'expensesCorrupt'
  | 'backupPromptLeg'
  | 'conciergeChat'
  | 'journalSync'
  | 'journalDraft'
  | 'localRescue'
  | 'ice'
  | 'conflicts';

/**
 * TripScopedSlot as a runtime list, for the wipes and tests. `satisfies` rejects a bad member and
 * `_ExhaustiveTripScopedSlots` a missing one, so no slot escapes a wipe.
 */
const ALL_TRIP_SCOPED_SLOTS = [
  'weatherCache',
  'budget',
  'expenses',
  'journal',
  'favorites',
  'syncOutbox',
  'photos',
  'itinerary',
  'itineraryCorrupt',
  'docsChecklist',
  'packing',
  'dayAnchors',
  'shareInbox',
  'myPlaces',
  'expensesCorrupt',
  'backupPromptLeg',
  'conciergeChat',
  'journalSync',
  'journalDraft',
  'localRescue',
  'ice',
  'conflicts',
] as const satisfies readonly TripScopedSlot[];
type _ExhaustiveTripScopedSlots = [TripScopedSlot] extends [(typeof ALL_TRIP_SCOPED_SLOTS)[number]]
  ? true
  : never;
const _exhaustiveTripScopedSlots: _ExhaustiveTripScopedSlots = true;
void _exhaustiveTripScopedSlots;

export const TRIP_SCOPED_SLOTS: readonly TripScopedSlot[] = ALL_TRIP_SCOPED_SLOTS;

/**
 * On-disk key for a slot in the active trip: the original literal for the sample pack, else
 * `trip:{id}:{slot}` using the registry name. Only the key changes, never the store.
 */
export function keyFor(slot: TripScopedSlot): string {
  return keyForTrip(getActiveTripId(), slot);
}

/** keyFor for a given trip id rather than the active one. */
export function keyForTrip(id: string, slot: TripScopedSlot): string {
  return id === DEFAULT_TRIP_ID ? STORAGE_KEYS[slot] : `trip:${id}:${slot}`;
}

/**
 * Sign-out teardown of all trip data on this device:
 * - every `trip:*` key, plus the sample pack's un-prefixed literals (a prefix sweep alone misses them)
 * - itineraryCorrupt too: it holds a copy of the plan. Other code paths leave it alone
 *   (gateway-trip-scope.test.ts), but sign-out must not.
 * - the trip pointer and lists, and travelMode (a stale 'active' caused a redirect loop)
 * Not cleared: identity (signOut() does that), photo blobs, and the lifetime keys 32/34
 * (D-314; visited-lifetime.test.ts checks).
 * Keys are collected before deleting, since deleting while iterating skips entries.
 */
export function wipeAllTripData(): void {
  const s = backing('local');
  if (s !== null) {
    try {
      const prefix = 'trip:';
      const doomed: string[] = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null && k.startsWith(prefix)) doomed.push(k);
      }
      for (const k of doomed) s.removeItem(k);
    } catch {
      /* disabled storage / privacy mode — never throw out of the gateway */
    }
  }
  for (const slot of TRIP_SCOPED_SLOTS) removeKey('local', STORAGE_KEYS[slot]);
  removeKey('local', STORAGE_KEYS.activeTrip);
  removeKey('local', STORAGE_KEYS.knownTrips);
  removeKey('local', STORAGE_KEYS.removedTrips);
  removeKey('local', STORAGE_KEYS.syncCode);
  removeKey('local', STORAGE_KEYS.travelMode);
  // D-542 — the default pack's remote trip id is a capability token for the previous traveler's
  // SHARED plan, so a sign-out that left it behind would silently sync the next person on this
  // device straight into that trip. Same reasoning as `syncCode` two lines up.
  removeKey('local', STORAGE_KEYS.defaultTripShare);
  removeKey('local', STORAGE_KEYS.defaultTripAdopted);
  removeKey('local', STORAGE_KEYS.tripsCreatedHere);
  removeKey('local', STORAGE_KEYS.personPrefs);
  removeKey('local', STORAGE_KEYS.tripSyncQueue);
}

/**
 * Delete every trip-scoped slot of one forgotten trip, outbox included so stale edits can't
 * replay on a re-join. No-op for '' or the sample pack.
 */
export function wipeTripData(id: string): void {
  if (!id || id === DEFAULT_TRIP_ID) return;
  // Exact keys, not a `trip:{id}:` prefix: ids may contain ':' so `trip:a:` also matches trip `a:b`.
  for (const slot of TRIP_SCOPED_SLOTS) removeKey('local', keyForTrip(id, slot));
}

// Primitives: the only functions in app code that touch raw web storage.

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

/** Quota failure specifically; disabled storage throws too but stays silent. Includes old Firefox's name. */
export function isQuotaError(e: unknown): boolean {
  if (!(e instanceof DOMException)) return false;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED';
}

/**
 * Fires `trip:quota-exceeded` for storage-persistence.tsx to toast. Wrapped so nothing here can
 * throw out of a write.
 */
export function notifyQuotaExceeded(key: string): void {
  try {
    if (typeof window === 'undefined' || typeof CustomEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('trip:quota-exceeded', { detail: { key } }));
  } catch {
    /* never throw out of a write path */
    // ..and therefore never assert inside a `trip:quota-exceeded` listener: this catch swallows a
    // thrown `expect()` into silence, so the test passes no matter what. Assert on what the
    // listener recorded, after the call returns.
  }
}

/**
 * Write a raw string. No-op during SSR or if storage is unavailable. Never throws.
 * Returns true only when the write landed, so a synced caller can skip pushing a refused save.
 */
export function writeString(store: Store, key: string, value: string): boolean {
  const s = backing(store);
  if (s === null) return false;
  try {
    s.setItem(key, value);
    return true;
  } catch (err) {
    // ignore (quota / disabled storage) — but surface a quota failure specifically;
    // writeJson delegates here, so this one call site covers both primitives.
    if (isQuotaError(err)) notifyQuotaExceeded(key);
    return false;
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
 * Parse a JSON slot, or `fallback` if absent, unparseable or the wrong kind. With an object
 * fallback, a stored scalar is rejected so callers that dereference it can't throw. A symbol
 * fallback (trip-backup's ABSENT) gets the raw parsed value.
 */
export function readJson<T>(store: Store, key: string, fallback: T, onReject?: (raw: string) => void): T {
  const raw = readString(store, key);
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onReject?.(raw);
    return fallback;
  }
  if (
    typeof fallback === 'object' &&
    fallback !== null &&
    (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) !== Array.isArray(fallback))
  ) {
    onReject?.(raw);
    return fallback;
  }
  return parsed as T;
}

type DeviceOnlySlot = 'journal' | 'packing' | 'photos' | 'shareInbox' | 'favorites' | 'ice';

/**
 * readJson for device-only slots (D-725): rejected bytes are copied to localRescue first, since
 * the next save would overwrite the only copy. Write-once per slot.
 */
function readDeviceOnlyJson<T>(slot: DeviceOnlySlot, fallback: T, sanitize?: (parsed: unknown) => unknown): T {
  const rescue = (raw: string) => {
    const key = keyFor('localRescue');
    const stored = readString('local', key);
    let kept: Record<string, unknown> = {};
    if (stored !== null) {
      try {
        kept = JSON.parse(stored);
      } catch {
        return;
      }
      if (typeof kept !== 'object' || kept === null || Array.isArray(kept) || kept[slot] !== undefined) return;
    }
    if (writeJson('local', key, { ...kept, [slot]: raw })) {
      console.warn('[storage] unreadable', slot, 'data preserved at', key);
    }
  };
  const value = readJson<T>('local', keyFor(slot), fallback, rescue);
  // The caller's sanitizer is what drops a wrongly shaped entry, and the gateway can't see that:
  // a stored value with content that sanitizes to nothing is about to be overwritten like any other.
  if (sanitize && hasContent(value) && !hasContent(sanitize(value))) {
    const raw = readString('local', keyFor(slot));
    if (raw !== null) rescue(raw);
  }
  return value;
}

const hasContent = (v: unknown) =>
  typeof v === 'object' && v !== null && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0);

/** `JSON.stringify` + write a slot. No-op / never-throw exactly like `writeString`. */
export function writeJson<T>(store: Store, key: string, value: T): boolean {
  // stringify can throw on a cyclic value; keep the whole op total.
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return false;
  }
  return writeString(store, key, serialized);
}

// Domain accessors

/** Identity (keys 3 and 4) for lib/identity.ts and lib/token-auth.ts. setName trims. */
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
  /** Names this user went by before a rename, for "My edits". */
  getPriorNames(): string[] {
    const list = readJson<unknown>('local', STORAGE_KEYS.priorNames, []);
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string') : [];
  },
  /** Record the old name on rename. Duplicates are ignored so the list stays bounded. */
  addPriorName(name: string): void {
    const prev = name.trim();
    if (!prev) return;
    const list = identityStore.getPriorNames();
    if (list.includes(prev)) return;
    writeJson('local', STORAGE_KEYS.priorNames, [...list, prev]);
  },
  /** Adopt names synced from the account (D-601). Union only; returns whether anything was added. */
  mergePriorNames(names: readonly string[]): boolean {
    const list = identityStore.getPriorNames();
    const add = names.filter((n, i) => n.trim() && !list.includes(n) && names.indexOf(n) === i);
    if (add.length) writeJson('local', STORAGE_KEYS.priorNames, [...list, ...add]);
    return add.length > 0;
  },
  /** Sign-out. Prior names go too, or the next person on the device would inherit them. */
  clearIdentity(): void {
    removeKey('local', STORAGE_KEYS.token);
    removeKey('local', STORAGE_KEYS.userName);
    removeKey('local', STORAGE_KEYS.priorNames);
  },
} as const;

/**
 * Nightlife visibility (key 7). Stored as 'true'/'false', not JSON: don't JSON.parse it.
 * Returns null when absent so the caller keeps its own default.
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

/** The ?today= override (key 8), session only. lib/trip-now.ts owns the logic. */
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

/** Per-city weather cache. `set` merges into the map so other cities survive. */
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

/** Budget. The caller normalizes what it reads (normalizeModel). */
export const budgetStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('budget'), fallback);
  },
  set<T>(model: T): boolean {
    return writeJson('local', keyFor('budget'), model);
  },
} as const;

/** Expenses. The caller sanitizes (sanitizeExpenses). */
export const expensesStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('expenses'), fallback);
  },
  set<T>(expenses: T): boolean {
    return writeJson('local', keyFor('expenses'), expenses);
  },
} as const;

/** Journal. The caller sanitizes (sanitizeEntries). */
export const journalStore = {
  get<T>(fallback: T, sanitize?: (parsed: unknown) => unknown): T {
    return readDeviceOnlyJson<T>('journal', fallback, sanitize);
  },
  set<T>(entries: T): boolean {
    return writeJson('local', keyFor('journal'), entries);
  },
} as const;

/** Unsaved journal draft slot (key 53): byte transport like `journalStore`; the card owns the shape. */
export const journalDraftStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('journalDraft'), fallback);
  },
  set<T>(drafts: T): boolean {
    return writeJson('local', keyFor('journalDraft'), drafts);
  },
  clear(): void {
    removeKey('local', keyFor('journalDraft'));
  },
} as const;

/** Emergency card slot (key 55): byte transport; `core/ice/ice.ts` owns the shape. */
export const iceStore = {
  get<T>(fallback: T, sanitize?: (parsed: unknown) => unknown): T {
    return readDeviceOnlyJson<T>('ice', fallback, sanitize);
  },
  set<T>(card: T): boolean {
    return writeJson('local', keyFor('ice'), card);
  },
  clear(): void {
    removeKey('local', keyFor('ice'));
  },
} as const;

/** One ChunkLoadError reload per session, then stop. */
export const chunkReloadGuard = {
  hasReloaded(): boolean {
    return readString('session', STORAGE_KEYS.chunkReloadOnce) === '1';
  },
  markReloaded(): void {
    writeString('session', STORAGE_KEYS.chunkReloadOnce, '1');
  },
} as const;

/** Post-login rename nudge (key 39). `consume()` reads and clears, so it's true at most once. */
export const nameHintFlag = {
  mark(): void {
    writeString('session', STORAGE_KEYS.nameHint, '1');
  },
  consume(): boolean {
    if (readString('session', STORAGE_KEYS.nameHint) !== '1') return false;
    removeKey('session', STORAGE_KEYS.nameHint);
    return true;
  },
} as const;

/** At most one trip-meta heal reload per trip per session. */
export const tripMetaSelfHealGuard = {
  hasRun(tripId: string): boolean {
    const raw = readString('session', STORAGE_KEYS.tripMetaSelfHeal);
    return raw !== null && raw.split(',').includes(tripId);
  },
  markRun(tripId: string): void {
    const raw = readString('session', STORAGE_KEYS.tripMetaSelfHeal);
    const ids = raw ? raw.split(',') : [];
    if (!ids.includes(tripId)) ids.push(tripId);
    writeString('session', STORAGE_KEYS.tripMetaSelfHeal, ids.join(','));
  },
} as const;

/** At most one reload per session onto the account's default share (key 51; D-598). */
export const defaultShareReloadGuard = {
  hasRun(): boolean {
    return readString('session', STORAGE_KEYS.defaultShareReload) !== null;
  },
  /** False when the flag did not stick (storage blocked), so the caller must not reload. */
  markRun(): boolean {
    writeString('session', STORAGE_KEYS.defaultShareReload, '1');
    return this.hasRun();
  },
  reset(): void {
    removeKey('session', STORAGE_KEYS.defaultShareReload);
  },
} as const;

/**
 * Entrance ledger (key 33); policy in lib/motion.ts. Broken storage reads as not greeted, so the
 * failure mode is re-animating, never a stuck-hidden screen.
 */
export const entranceLedger = {
  hasGreeted(surface: string): boolean {
    const raw = readString('session', STORAGE_KEYS.motionEntranceSeen);
    return raw !== null && raw.split(',').includes(surface);
  },
  markGreeted(surface: string): void {
    const raw = readString('session', STORAGE_KEYS.motionEntranceSeen);
    const seen = raw ? raw.split(',') : [];
    if (seen.includes(surface)) return;
    seen.push(surface);
    writeString('session', STORAGE_KEYS.motionEntranceSeen, seen.join(','));
  },
} as const;

/**
 * Celebration ledger (key 36); policy in lib/celebration.ts. The whole set is readable because
 * caps are counts. Broken storage lets every claim through, like the entrance ledger.
 */
export const celebrationLedger = {
  fired(): string[] {
    const raw = readString('session', STORAGE_KEYS.motionCelebrationsFired);
    return raw ? raw.split(',') : [];
  },
  markFired(claimKey: string): void {
    const spent = celebrationLedger.fired();
    if (spent.includes(claimKey)) return;
    spent.push(claimKey);
    writeString('session', STORAGE_KEYS.motionCelebrationsFired, spent.join(','));
  },
} as const;

/** Favourites. The caller sanitizes. */
export const favoritesStore = {
  get<T>(fallback: T, sanitize?: (parsed: unknown) => unknown): T {
    return readDeviceOnlyJson<T>('favorites', fallback, sanitize);
  },
  set<T>(ids: T): boolean {
    return writeJson('local', keyFor('favorites'), ids);
  },
} as const;

/** Photo metadata; bytes are in IndexedDB (core/photos/blob-store.ts). Caller sanitizes. */
export const photosStore = {
  get<T>(fallback: T, sanitize?: (parsed: unknown) => unknown): T {
    return readDeviceOnlyJson<T>('photos', fallback, sanitize);
  },
  set<T>(metas: T): boolean {
    return writeJson('local', keyFor('photos'), metas);
  },
} as const;

/** First-run tour, shown once ever. */
export const tourStore = {
  hasSeenTour(): boolean {
    return hasKey('local', STORAGE_KEYS.firstRunTour);
  },
  markTourSeen(): void {
    writeString('local', STORAGE_KEYS.firstRunTour, '1');
  },
} as const;

/** Travel Mode legibility. Same 'true'/'false' format as uiPrefs; null when unset. */
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

/** /map keep-awake. Same format as uiPrefs; null when unset, treated as off. */
export const mapWakeLockPrefs = {
  get(): boolean | null {
    const raw = readString('local', STORAGE_KEYS.mapWakeLockEnabled);
    if (raw === null) return null;
    return raw === 'true';
  },
  set(value: boolean): void {
    writeString('local', STORAGE_KEYS.mapWakeLockEnabled, String(value));
  },
} as const;

/** Packing list. The caller seeds the template when empty or corrupt. */
export const packingStore = {
  get<T>(fallback: T, sanitize?: (parsed: unknown) => unknown): T {
    return readDeviceOnlyJson<T>('packing', fallback, sanitize);
  },
  set<T>(items: T): boolean {
    return writeJson('local', keyFor('packing'), items);
  },
} as const;

/** Per-day map anchors, local-only. */
export const dayAnchorStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('dayAnchors'), fallback);
  },
  set<T>(map: T): boolean {
    return writeJson('local', keyFor('dayAnchors'), map);
  },
} as const;

/** Share-target inbox. The caller sanitizes. */
export const shareInboxStore = {
  get<T>(fallback: T, sanitize?: (parsed: unknown) => unknown): T {
    return readDeviceOnlyJson<T>('shareInbox', fallback, sanitize);
  },
  set<T>(items: T): boolean {
    return writeJson('local', keyFor('shareInbox'), items);
  },
} as const;

/** Per-device id, minted on first use. On the server returns an unsaved uuid; presence is client-only. */
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

/** Documents checklist. The caller seeds the template when empty or corrupt. */
export const docsStore = {
  get<T>(fallback: T): T {
    return readJson<T>('local', keyFor('docsChecklist'), fallback);
  },
  set<T>(items: T): boolean {
    return writeJson('local', keyFor('docsChecklist'), items);
  },
} as const;

/** Install hint, dismissed once ever. */
export const installHintStore = {
  hasBeenDismissed(): boolean {
    return hasKey('local', STORAGE_KEYS.installHintDismissed);
  },
  markDismissed(): void {
    writeString('local', STORAGE_KEYS.installHintDismissed, '1');
  },
} as const;

/**
 * Leg the backup nudge last fired for (key 42), so it fires once per leg.
 * KNOWN CEILING: last value only, so A, B, A nudges twice for A. Use a set if legs ever repeat.
 */
export const backupPromptStore = {
  getPromptedLeg(): string | null {
    return readString('local', keyFor('backupPromptLeg'));
  },
  setPromptedLeg(leg: string): void {
    writeString('local', keyFor('backupPromptLeg'), leg);
  },
} as const;

// Accessors for concierge (keys 43/44), my-places (31) and Travel Mode (19/20) live in their own
// core/storage/*-store.ts files. This module is in every route's first-load chunk, and only lazy
// code uses those. Their key literals stay here.
