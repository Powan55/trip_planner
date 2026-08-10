> **Historical — a 2026-07-05 design snapshot. Do not read any number here as current.**
> Guest mode and `sessionGate` (sections 3.1 and 3.2) were removed repo-wide by **D-241** (LOCKED).
> Three further things this document states as fact have since moved on: the persisted-key
> inventory is no longer eight keys (`core/storage/gateway.ts` now declares ~30 slots, and
> `tripPlannerGuest` / `packing_checklist` are gone from the code); the current itinerary schema
> version is **5**, not 3 (`core/vault/migrations.ts`); and the ports are generic —
> `StoragePort<T>` is `load`/`save`/`has` and `SyncPort<T>` is `T`-typed, not `DayPlan[]`-typed
> (`core/ports.ts`). Current behaviour lives in the code and in `DECISIONS.md`.

# Data-Core Blueprint — Trip Vault, Typed Gateway & Headless Core (M15 / v3 Phase B)

> **Status:** blueprint (S89, doc-only). Governs build slices **S90–S94**; S95 (Sync v2) builds on the ports here.
> Drafted 2026-07-05.
> **Scope:** this document is a contract to build against, not code. It ships zero runtime. The `## Proposed DECISIONS.md entries` section at the end (D-095+) is drafted for `DECISIONS.md`; nothing else in the repo changes because of this slice.

This blueprint locks four things so the Phase-B slices stop improvising the data layer:

1. **Trip Vault:** a versioned storage *envelope* (`schemaVersion` / `updatedAt` / `payload`), Zod-validated, with an ordered-migration runner. The current un-enveloped `v2` itinerary array becomes migration #1 (v2→v3).
2. **Typed storage gateway:** one typed module that fronts every ad-hoc `localStorage` / `sessionStorage` key, with on-disk names and shapes kept backward-compatible for deployed users.
3. **Headless Core port map:** the framework-free `core/` boundary with Storage / Sync / Clock ports and a defined extraction order.
4. **Slice contracts S90–S94:** each slice's inputs, output, hard acceptance, guarding tests, and risks.

The hard external fact this whole design bends around: the site is live and sync-enabled with real users' data on disk (three named travelers plus guests). On-disk key names and value shapes have to stay readable; the v2→v3 migration has to be lossless with quarantine-on-failure; Firestore stays per-day (Spark free). None of this may pressure D-002 / D-004 / D-018 (all LOCKED). Where it would, it is flagged as an escalation rather than decided here.

---

## 0. Grounding — what exists today (verified)

Read to ground this blueprint (not modified):

- `lib/itinerary-storage.ts` holds the current itinerary contract: `ITINERARY_STORAGE_KEY = 'nepal_japan_itinerary'`, `ITINERARY_QUARANTINE_KEY = 'nepal_japan_itinerary_corrupt'`; `loadPlans()` / `savePlans()` / `hasStoredPlans()`; the D-018 three-state logic and the D-091 quarantine. The stored payload is a bare `DayPlan[]` JSON array, with no wrapper and no version field. That is "v2 on disk."
- `hooks/use-itinerary.ts` holds the D-031 single write path `commit()`: `prev = loadPlans()` → `next = compute(prev)` → `savePlans(next)` → `setPlans` → dispatch `itinerary:changed` → (gated) `pushPlans(prev,next)`. Read-modify-write against the freshest persisted state is load-bearing, and the envelope must not break it.
- `lib/itinerary-remote.ts` is the Firestore per-day sync seam (D-039/D-042). It reads and writes `DayPlan[]` through `savePlans()`/`loadPlans()`, and the per-day doc granularity (`trips/{TRIP_ID}/days/{date}`) is fixed by Spark quota (D-088).
- `lib/trip-data.ts` holds the `DayPlan` / `ItineraryItem` payload shapes, the `T` the envelope wraps.
- `lib/firebase-config.ts` holds the `isRemoteConfigured()` gate and `TRIP_ID`, the dormant-safe boundary the Sync port inherits.

### 0.1 Confirmed full key inventory (grep-verified)

We swept every `localStorage`/`sessionStorage` access and every `*_KEY = '…'` literal. The complete set of **persisted keys** is below. This is a *superset* of the six keys D-078c enumerated (D-078c's list omitted the two override/toggle session-ish keys and the quarantine key; those are captured here).

| # | Key literal | Store | Value shape | Named where | Read/written where | Domain (gateway slot) |
|---|---|---|---|---|---|---|
| 1 | `nepal_japan_itinerary` | localStorage | `DayPlan[]` JSON (→ Vault envelope in S90) | `lib/itinerary-storage.ts:18` (`ITINERARY_STORAGE_KEY`) | `itinerary-storage.ts`, listened in `use-itinerary.ts:95`, `itinerary-remote.ts` | **itinerary** |
| 2 | `nepal_japan_itinerary_corrupt` | localStorage | raw corrupt string, verbatim | `lib/itinerary-storage.ts:36` (`ITINERARY_QUARANTINE_KEY`) | `itinerary-storage.ts` | **itinerary (quarantine)** |
| 3 | `tripPlannerUserName` | localStorage | plain string (display name) | `lib/identity.ts:12` (`USER_NAME_KEY`); duplicated literal `lib/token-auth.ts:20` | `identity.ts` read/write; cleared in `token-auth.ts:107` | **identity** |
| 4 | `tripPlannerToken` | localStorage | plain string (traveler token) | `lib/token-auth.ts:19` (`TOKEN_KEY`) | `token-auth.ts` | **identity** |
| 5 | `tripPlannerGuest` | localStorage | `'1'` (presence-flag string) | `hooks/use-active-traveler.ts:28` + `components/token-gate.tsx:44` (dup const); **raw literal** `components/navbar.tsx:19` | read `use-active-traveler.ts:37`, `token-gate.tsx:50`; write `token-gate.tsx:60`; remove `navbar.tsx:19` | **session/gate** |
| 6 | `packing_checklist` | localStorage | `Record<string, boolean>` JSON | **raw literal** in `components/travel-essentials.tsx:30/38` (grandfathered by D-078c) | `travel-essentials.tsx` | **checklist** |
| 7 | `nightlife_section_visible` | localStorage | boolean-as-string (`String(next)`) | `components/nightlife-section.tsx:13` (`STORAGE_KEY`) | `nightlife-section.tsx` | **ui-prefs** |
| 8 | `tripPlannerTodayOverride` | **sessionStorage** | `YYYY-MM-DD` string (or absent) | `lib/trip-now.ts:30` (`TODAY_OVERRIDE_KEY`) | `trip-now.ts` (D-075) | **clock-override** |

Non-persisted state is deliberately kept out of storage. Do not corral it; it is noted here so nobody "helpfully" moves it: `lib/selected-day.ts` (an in-memory module value plus the `plan:selected-date` CustomEvent, D-082) and the Firestore trip-doc marker (server-side, D-049). The E2E specs and unit tests reference keys 1, 2 and 6 directly. Those are test-owned literals and out of gateway scope, but the key strings must not change or the tests break, so they are effectively part of the on-disk contract.

What the sweep found:

- **Eight persisted keys**, not the "~10+" the earlier estimate assumed. Two are session-ish: `tripPlannerGuest` is a plain localStorage flag, and `tripPlannerTodayOverride` is the one genuine sessionStorage key.
- **Three literals are duplicated or raw**, and they are the concrete D-078c debt the gateway pays down: `tripPlannerGuest` (three sites, one raw in `navbar.tsx`), `tripPlannerUserName` (duplicated between `identity.ts` and `token-auth.ts`), and `packing_checklist` (raw in `travel-essentials.tsx`). Centralizing these is the structural win of S91.
- **`tripPlannerTodayOverride` spans a different store** (sessionStorage), so the gateway has to model store-per-key rather than assume localStorage (see section 3.4). D-075 locked this key as sessionStorage-only and `computeCountdown` as pure, so the gateway wraps it read-compatibly and does not migrate it to localStorage.

---

## 1. The Trip Vault envelope

### 1.1 Shape

The Vault wraps a domain payload in a minimal, versioned envelope. This is the smallest shape that satisfies versioning, validation and migration:

```ts
// core/vault/envelope.ts  (illustrative — S90 authors it)
export interface VaultEnvelope<T> {
  schemaVersion: number;   // integer, monotonically increasing; current itinerary target = 3
  updatedAt: string;       // ISO 8601 timestamp of the last write through the Vault
  payload: T;              // the domain data (e.g. DayPlan[])
}
```

Three fields, chosen deliberately:
- `schemaVersion` drives the migration runner (section 2). An integer rather than semver: migrations are an ordered chain of single steps, so a single integer is sufficient and cheaper to reason about.
- `updatedAt` is a write timestamp. It is cheap, and it gives the future Sync v2 (S95) a local-vs-remote recency signal without designing sync now: a Sync-port concern reads it, and the Vault just stamps it. It is not authority for conflict resolution here, since per-day LWW stays in Firestore (D-042).
- `payload` is the typed domain data. Generic `T`, so the same envelope serves the itinerary now and any future corralled blob.

No `id`, no `checksum`, no `migratedFrom` history. Those are gold-plating for a single-user localStorage store; add them only if a concrete slice needs them, and record it then. This is the smallest envelope that versions, validates and migrates.

### 1.2 Why the version lives on disk (not just in code)

Today the itinerary is a bare array, so there is no way to know *which* schema wrote it. The moment we add an envelope, every future format change is a pure, testable migration step instead of a defensive `try/catch` guess. The cost is one wrapper object and one migration (v2→v3). That is the whole trade: a tiny persistent header buys deterministic, ordered evolution forever.

### 1.3 Zod schema sketch (Zod is already a dep — `zod` 3.23.8, D-088)

```ts
// core/vault/schema.ts  (illustrative — S90 authors it)
import { z } from 'zod';

// Payload schema for the CURRENT itinerary version (v3). Mirrors lib/trip-data.ts.
export const itineraryItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),               // kept permissive (see note); NOT z.enum on read
  time: z.string().optional(),
  duration: z.string().optional(),
  notes: z.string().optional(),
  location: z.string().optional(),
  sourceId: z.string().optional(),
  sourceType: z.enum(['recommendation', 'photo', 'map', 'featured']).optional(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough();                     // tolerate unknown future fields on read

export const dayPlanSchema = z.object({
  date: z.string(),
  city: z.string(),
  country: z.enum(['nepal', 'japan']),
  items: z.array(itineraryItemSchema),
});

export const itineraryPayloadV3 = z.array(dayPlanSchema);

export const itineraryEnvelopeV3 = z.object({
  schemaVersion: z.literal(3),
  updatedAt: z.string(),
  payload: itineraryPayloadV3,
});
```

Validation-tolerance rule, load-bearing for backward compatibility: on **read**, schemas are lenient. `category` is validated as `z.string()` rather than `z.enum`, and objects `.passthrough()` unknown keys, because real deployed data may contain categories or fields a future or older build didn't know about, and D-018 forbids destroying valid-shaped data. On **write** the app is already producing well-typed `ItineraryItem`s, so write is naturally strict via TypeScript. A read that fails even the lenient schema is genuinely corrupt and quarantines (section 2.4). This mirrors `docToDayPlan`'s existing defensive tolerance in `itinerary-remote.ts`.

### 1.4 How the four input states resolve (D-018 mapped through the envelope)

`loadItinerary()`, the Vault-backed read that replaces today's `loadPlans()`, must produce a `DayPlan[]` for exactly these on-disk states. This is D-018's three states plus the legacy-unwrapped array, promoted to a first-class fourth input that routes into migration #1:

| On-disk state at `nepal_japan_itinerary` | Resolution | D-018 mapping |
|---|---|---|
| **A — key ABSENT** (`getItem === null`) | seed `SAMPLE_ITINERARY`; nothing to quarantine | D-018 state (1) — unchanged |
| **B — legacy un-enveloped array** (parses to a JSON array, no `schemaVersion`) | treat as **schemaVersion 2** → run migration runner from 2 → 3 → validate v3 → return migrated payload verbatim (incl. `[]`) | D-018 state (2), now the migration entry point |
| **C — valid v3 envelope** (object, `schemaVersion===3`, passes lenient Zod) | return `payload` verbatim (incl. `[]`) | D-018 state (2) — steady state |
| **D — present but corrupt** (parse error, or neither array nor recognized envelope, or fails lenient Zod, or migration throws) | **quarantine raw bytes** (D-091, don't-clobber-first), then fall back to `SAMPLE_ITINERARY` | D-018 state (3) — unchanged behavior, formalized |

The empty-array invariant survives: state B with payload `[]` and state C with payload `[]` both return `[]` verbatim. A deliberately-emptied itinerary stays empty across reloads and across the migration. This is the D-018 hard guarantee and the single most important thing S90 must not break. The version detector distinguishing B from C is: is the parsed value an array? Then legacy v2 (state B). Is it an object with a numeric `schemaVersion`? Then enveloped (state C, or a future version, section 2.3).

---

## 2. The migration runner

### 2.1 Shape — an ordered chain of pure steps

```ts
// core/vault/migrations.ts  (illustrative — S90 authors it)
export interface Migration {
  from: number;            // schemaVersion this step consumes
  to: number;              // schemaVersion this step produces (always from + 1)
  migrate(payload: unknown): unknown;   // pure; no I/O, no storage, no Date.now
}

// Ordered by `from`. Extend by APPENDING; never reorder or renumber a shipped step.
export const itineraryMigrations: Migration[] = [
  {
    from: 2,
    to: 3,
    // v2 = bare DayPlan[] with no envelope. v3 payload is the SAME DayPlan[] —
    // the shape did not change; v3 only adds the wrapper. So migration #1 is the
    // identity on the payload; the wrapping (schemaVersion/updatedAt) is done by the
    // runner, not the step. Lossless by construction: no field is added/dropped/renamed.
    migrate: (payload) => payload,
  },
  // #2 (from:3,to:4) appended here when a real v3→v4 shape change lands. Not now.
];

export const CURRENT_ITINERARY_VERSION = 3;
```

Migration #1 (v2→v3) is a payload identity. This is the safest possible first migration: the `DayPlan[]` shape is unchanged, so no user field can be lost, reinterpreted, or dropped. All v2→v3 does is acknowledge the array as a versioned payload and wrap it. That is exactly the losslessness required.

### 2.2 How the current version is chosen and the runner drives

```
read raw string
  → JSON.parse (fail → quarantine → sample)
  → detect version:
        array               ⇒ v2   (legacy, state B)
        object w/ numeric schemaVersion ⇒ that number (state C or future)
        anything else       ⇒ corrupt (state D → quarantine → sample)
  → if detected < CURRENT: apply migrations in order (from === current detected)
        each step: migrate(payload); on throw ⇒ quarantine raw → sample
  → validate final payload against the CURRENT lenient Zod schema
        pass ⇒ return payload;  fail ⇒ quarantine raw → sample
```

The runner walks `itineraryMigrations` picking each step whose `from` equals the running version, applying in ascending order until it reaches `CURRENT_ITINERARY_VERSION`. Because migration #1 is the only step today, a v2 array takes exactly one hop to v3.

Write side: `saveItinerary(plans)` always writes the current envelope (`{ schemaVersion: 3, updatedAt: nowISO(), payload: plans }`, including `payload: []`). So the first `commit()` after a migration upgrades the on-disk format transparently: the user's next edit persists v3, and the legacy array is gone from disk. Its bytes were already safe because the migration was lossless, so no quarantine is needed on a *successful* migrate. This must keep the D-031 read-modify-write intact: `commit()` still does `prev = loadItinerary()` → `compute(prev)` → `saveItinerary(next)`, and the Vault is transparent to the mutators (section 4.4).

### 2.3 Unknown / future version (forward-compat, defensive)

If `schemaVersion` is greater than `CURRENT_ITINERARY_VERSION` (a newer build wrote this browser, then the user loaded an older deploy, which is possible during a rollback), there is no down-migration. The rule is: do not quarantine and do not down-convert, since either would destroy newer data. Instead, attempt the lenient Zod read of `payload` as-is:
- If the payload still validates leniently, which is likely because v-next is usually additive, return it verbatim and read-only-safe. On the next write, re-stamp `schemaVersion` to CURRENT only if the write path is confident. The default is to leave the higher version's bytes and write the CURRENT envelope, accepting that a forward field may be dropped by the older build. That is the documented, accepted risk of running an old build against new data.
- If it does not validate, treat it as corrupt: quarantine, then sample.

This "unknown-future = read leniently, never destroy" rule is the forward-compat mirror of the backward migration chain. It is defensive only; no future version exists today.

### 2.4 Quarantine on migrate/validate failure (D-091, generalized)

D-091's exact convention is folded into the Vault path, so a failed migration or a failed validation quarantines before falling back, identical to today's parse-failure behavior:
- Preserve the raw original string verbatim to `nepal_japan_itinerary_corrupt`, but only if that key is currently absent (don't-clobber-first-capture, since the first corruption most likely holds the user's real data).
- `console.warn`, so the loss is never silent.
- Never throw. A quarantine/preserve attempt is itself try/caught, so quota limits and disabled storage degrade quietly.
- Then fall back to `SAMPLE_ITINERARY`.

This closes the pre-S78 destructive loop for the migration case too. Because `commit()` derives from `loadItinerary()`, a corrupt or failed-migration load that fell back to sample would, on the next edit, `saveItinerary()` sample-derived data over the user's real bytes. Preserving the raw bytes first is what makes the fallback non-destructive (D-031 and D-091 together). The quarantine key stays a distinct backward-compatible name, and a future recovery UI (out of scope) can read it.

---

## 3. The typed storage gateway

### 3.1 Purpose and shape

One module (proposed `core/storage/gateway.ts`, re-exported through `lib/` for existing import paths) is the only place any key literal appears and the only place raw `window.localStorage` / `window.sessionStorage` is touched. Every domain gets a typed accessor pair, and the ad-hoc keys in section 0.1 move behind it. This makes D-078c structural rather than a convention: after S91, a grep for `localStorage.` / `sessionStorage.` outside the gateway returns zero app hits (tests excepted).

Public surface (illustrative; S91 authors it, and the names may refine):

```ts
// Low-level typed slot primitives (private-ish; the domain accessors are the API):
function readJson<T>(store: Store, key: string, schema: ZodType<T>, fallback: T): T;
function writeJson<T>(store: Store, key: string, value: T): void;   // never throws
function readString(store: Store, key: string): string | null;
function writeString(store: Store, key: string, value: string): void;
function removeKey(store: Store, key: string): void;
function hasKey(store: Store, key: string): boolean;                // key-presence (D-018)

// Domain-typed accessors fronting the inventory above (the actual public API):
export const itineraryStore = { load, save, hasStored, /* quarantine internal */ };  // key 1/2 (Vault-backed)
export const identityStore  = { getName, setName, getToken, setToken, clearIdentity }; // keys 3/4
export const sessionGate    = { isGuest, setGuest, clearGuest };                       // key 5
export const checklistStore = { get, set };                                            // key 6
export const uiPrefs        = { getNightlifeVisible, setNightlifeVisible };            // key 7
export const clockOverride  = { get, set, clear };  // key 8 — SESSION store (D-075)
```

### 3.2 Key literals centralize (D-078 structural)

All eight literals live in one `STORAGE_KEYS` object inside the gateway module, and nothing else names them. The three duplicated or raw literals from the inventory collapse to single references:
- `tripPlannerGuest`: `navbar.tsx`, `token-gate.tsx` and `use-active-traveler.ts` all call `sessionGate.*`, with no literal in any of them.
- `tripPlannerUserName`: `identity.ts` and `token-auth.ts` both call `identityStore.*`, and the duplicate const in `token-auth.ts:20` disappears.
- `packing_checklist`: `travel-essentials.tsx` calls `checklistStore.*`, and the raw literal is gone.

Back-compat is absolute: the key *strings* and value *shapes* are unchanged. The gateway is a typed wrapper over the same bytes, so every deployed browser reads identically. The only visible change is where the string constant is declared, not what it is. D-075's `tripPlannerTodayOverride` stays sessionStorage-only through `clockOverride`.

### 3.3 SSR-safety and never-throw (uniform)

Every accessor is SSR-safe and self-degrading, matching the existing modules exactly:
- Guard every access with `typeof window === 'undefined'`, so a read returns the typed fallback (`null` / sample / `{}` per domain) and a write is a no-op. First-paint parity with today.
- Wrap every `getItem`/`setItem` in try/catch, so quota, disabled storage and privacy mode degrade quietly. The gateway never throws to a caller. This is already the invariant in `itinerary-storage.ts`, `identity.ts`, `token-auth.ts` and `trip-now.ts`; the gateway makes it uniform and centrally tested.

### 3.4 Store-per-key (localStorage vs sessionStorage)

The gateway spans both web-storage backends because key 8 (`tripPlannerTodayOverride`) is genuinely sessionStorage (D-075). Each slot declares its `Store` (`local` | `session`), and the primitives take the store explicitly. That is why this is a "storage gateway" rather than a "localStorage gateway". Note that it does not attempt to unify or migrate across backends, which would break D-075: session vs local is a per-key fact preserved verbatim.

### 3.5 What the gateway does not do
- It does not touch Firestore (that is the Sync port, section 4) or change sync behavior.
- It does not introduce namespacing or a multi-trip prefix. D-078c explicitly defers multi-trip; the gateway is the seam that would make it a one-module change later, but S91 does not build it.
- It does not alter D-018/D-031/D-091 semantics for the itinerary. It delegates the itinerary slot to the Vault (sections 1 and 2), which preserves them.

---

## 4. Headless Core port map

### 4.1 The `core/` boundary

Introduce a framework-free `core/` package: plain TS, no React, no Next, and no `window` typing beyond what a port injects. `core/` contains the Vault (envelope, schema, migrations), the domain logic (dates/clock math; itinerary CRUD), and the port interfaces below. `core/` depends on nothing in `app/` / `components/` / `hooks/`, and the arrow always points inward (UI → core, never core → UI). This is the classic ports-and-adapters boundary: `core/` is pure and testable in isolation, and the framework layer supplies adapters.

`core/` did not exist when this was drafted; S93 created it. It is now the largest package in the app — `core/ports.ts`, `core/vault/`, `core/itinerary/`, `core/dates/`, `core/sync/`, `core/storage/gateway.ts` and more.

### 4.2 The three ports

Ports are interfaces core defines and the framework layer implements. Keeping them narrow is the point: each is the minimum surface core needs.

```ts
// core/ports.ts  (illustrative)

// STORAGE — the per-domain persistence boundary. Each domain supplies its own impl
// (the Vault gateway for the itinerary). Key/store addressing is NOT on the port: it
// lives in the gateway primitives (`core/storage/gateway.ts`, readString/writeString/
// readJson/writeJson/removeKey/hasKey).
export interface StoragePort<T> {
  load(): T;                 // the FRESHEST persisted value (D-031 reads its base here)
  save(value: T): void;      // never throws
  has(): boolean;            // D-018 key-presence
}

// CLOCK — "what time is it," incl. the ?today= simulation override (D-075).
export interface ClockPort {
  now(): Date;                 // real clock OR the resolved sessionStorage/URL override
}

// SYNC — the remote seam, generic over the domain value `T`. The itinerary wires
// T = DayPlan[]; expenses, budget and docs wire their own shapes over the same port.
export interface SyncPort<T> {
  push(prev: T, next: T): Promise<void>;                 // from commit() only (D-039)
  subscribe(onApplied?: (mergedValue: T) => void): () => void;
  isConfigured(): boolean;
}
```

### 4.3 Which existing module implements each port

| Port | Production adapter (today's module) | Notes |
|---|---|---|
| **StoragePort** | the Vault typed gateway (section 3), wrapping `window.localStorage` / `window.sessionStorage` | Becomes the Storage-port impl at **S94**; before that (S90–S91) it's just the gateway. |
| **ClockPort** | `lib/trip-now.ts` (`getNow`) | Already pure-ish and single-source (D-075). The `?today=` precedence + sessionStorage override move behind the port at S93; `computeCountdown` stays a pure core fn taking `now`. |
| **SyncPort** | `lib/itinerary-remote.ts` (`pushPlans` / `subscribeRemote` / `isRemoteConfigured`) | **Leave compatible, do not redesign** (S95 owns Sync v2). The port shape is chosen to fit the *existing* per-day contract so wrapping it is mechanical, not a rewrite. |

### 4.4 Extraction order — and why

S93 (dates/clock/countdown) comes before S94 (itinerary CRUD + persistence). The reasoning:

1. **Risk gradient.** Dates and countdown are pure and side-effect-light; the clock override is the only I/O, and it's read-only sessionStorage. Itinerary CRUD is the high-blast-radius subsystem: it's the D-018/D-031/D-091 core, it's what remote sync wraps, and it's under the most E2E coverage. Extract the low-risk pure math first to prove the `core/` boundary and the frozen-net methodology on something that can't corrupt user data, then move the dangerous one.
2. **Dependency direction.** Itinerary CRUD uses the clock indirectly (attribution `updatedAt`, `getTodayInTrip` day math, `synthesizeDay`'s country-for-date). Having `ClockPort` already extracted means S94 wires itinerary to a port that exists, rather than extracting two coupled things at once.
3. **The gateway lands mid-sequence.** S90 builds the Vault; S91 builds the gateway; by S94 the gateway is mature enough to become the StoragePort implementation. So the order is: Vault (S90) → gateway (S91) → export/import over the same schemas (S92) → clock into core (S93) → itinerary CRUD into core behind ports, with the gateway becoming StoragePort (S94). Each step stands on the finished one before it.

Behavior-identity guard for both extractions: S93 and S94 are refactors behind frozen nets. The S77 unit suites and the S80/S82 E2E waves (persistence, countdown, calendar CRUD, date-boundary) have to stay green with zero assertion changes. If a test needs editing to pass, the extraction changed behavior and is wrong. That is how "behavior-identical" is made checkable rather than asserted.

### 4.5 The clean Sync-port seam for S95 (do not build)

S89's only obligation to sync is to leave the seam clean: `SyncPort` is per-day-shaped, gated by `isConfigured()`, and its production adapter is today's `itinerary-remote.ts` untouched. S95 (the Sync v2 blueprint) will design richer conflict handling and recency use of the envelope's `updatedAt` against this interface, and it does not have to reach into the store. Nothing in S89–S94 changes Firestore granularity, the dormant-safe gate (D-038/D-047), or per-day LWW (D-042). Escalation note: any Sync v2 idea that wants whole-trip documents or a different granularity reopens D-042/D-088 (Spark quota) and needs an owner decision. Flagged, not decided here.

---

## 5. Slice contracts — S90 → S94

Each contract covers inputs → output → hard acceptance → guarding tests → risks. All are governed by this blueprint, and all obey D-088 (no new deps; Zod is already present), D-089, and the backward-compat hard constraint.

### S90 — Trip Vault 1 (envelope + Zod + migration runner on the itinerary store)
- **Inputs:** this blueprint, sections 1 and 2; `lib/itinerary-storage.ts` (the contract being generalized); `lib/trip-data.ts` (payload shape); `lib/sample-itinerary.ts` (fallback); `zod`.
- **Output:** the Vault in `core/vault/` (`envelope.ts`, `schema.ts`, `migrations.ts`, and a `loadItinerary`/`saveItinerary` that replace the internals of `loadPlans`/`savePlans`). `lib/itinerary-storage.ts` keeps its public exports and key constants unchanged (re-exporting or delegating to the Vault) so every caller and test is untouched. Migration #1 (v2→v3) wired.
- **Hard acceptance (the centerpiece):** a browser holding a legacy v2 bare array migrates losslessly to v3, with every `DayPlan`/`ItineraryItem` field byte-identical after the migrate. The site is live and sync-enabled, so this is real users' data. A deliberately-emptied `[]` survives migration and reload (D-018). A corrupt payload quarantines then falls back to sample (D-091), and the next `commit()` does not destroy the quarantined bytes (D-031). No new dep.
- **Guarding tests:** extend `lib/__tests__/itinerary-storage.test.ts`, where all existing cases stay green (key presence, `[]`-survives, corrupt→quarantine, don't-clobber-first, the "real trip preserved across a save" case), plus new unit cases: v2-array→v3 lossless, v3-envelope round-trip, unknown-future-version read-not-destroy, migrate-throw→quarantine, validate-fail→quarantine. E2E: the persistence hard-guarantee pack (S81) and date-boundary pack (S82) stay green unchanged.
- **Risks:** (1) the read path is the hottest path in the app, so a regression here is a data-loss bug for live users; mitigated by keeping migration #1 an identity and freezing the S77 net. (2) `updatedAt` on every write is a new byte in storage. Harmless, but confirm it doesn't perturb the `itinerary-remote.ts` per-day diff. It shouldn't: the envelope wraps the *array*, and per-day docs are written from `DayPlan`s rather than the envelope, so the timestamp never reaches Firestore. (3) SSR parity: `loadItinerary()` must still return `SAMPLE_ITINERARY` under no-window.

### S91 — Trip Vault 2 (the typed gateway corrals the remaining ad-hoc keys)
- **Inputs:** this blueprint, section 3 plus the section 0.1 inventory; the seven non-itinerary keys' owning modules (`identity.ts`, `token-auth.ts`, `use-active-traveler.ts`, `token-gate.tsx`, `navbar.tsx`, `travel-essentials.tsx`, `nightlife-section.tsx`, `trip-now.ts`).
- **Output:** `core/storage/gateway.ts` with the `STORAGE_KEYS` map and the domain accessors from section 3.1. The owning modules delegate to it, and the three duplicated or raw literals collapse to single references. Public function signatures of `identity.ts`, `token-auth.ts` and the rest stay unchanged; only the internals swap to the gateway.
- **Hard acceptance:** on-disk key names and value shapes unchanged, so a deployed browser reads guest flag, name, token, checklist, nightlife-pref and today-override identically before and after. Grep shows no raw `localStorage.`/`sessionStorage.` in app code outside the gateway (tests excepted). sessionStorage vs localStorage per key is preserved, so the D-075 override stays session.
- **Guarding tests:** a new `core/storage/__tests__/gateway.test.ts` (SSR no-op, never-throw on quota, key-presence semantics, store-per-key routing). Existing `itinerary-storage.test.ts` stays green. E2E: the guest-bypass / token-gate flows and packing-checklist persistence (persistence pack) stay green, since they exercise keys 5 and 6 end-to-end.
- **Risks:** (1) `tripPlannerGuest` has three call-sites including a raw literal in `navbar.tsx`; miss one and the gate desyncs, which the grep-clean acceptance catches. (2) `token-auth.ts` deletes `tripPlannerUserName` on sign-out, so ownership is split with `identity.ts`; the gateway must keep `clearIdentity` clearing both keys 3 and 4. (3) `nightlife_section_visible` stores `String(boolean)` rather than JSON, so the accessor must parse it the same lenient way (`=== 'true'` / the existing coercion) rather than assuming `JSON.parse`.

### S92 — Trip Vault 3 (whole-trip export / import through the same schemas)
- **Inputs:** this blueprint, sections 1 to 3; the Vault schemas (S90); the gateway (S91).
- **Output:** a user-facing whole-trip export (serialize the itinerary Vault envelope, and optionally the corralled prefs, to a downloadable JSON) and import (parse → validate through the *same* Zod schemas → on success replace via the Vault write path; on failure fail safe). No backend, so client-side Blob/File and D-004 intact.
- **Hard acceptance:** a bad or hostile import never destroys current data. Validation failure quarantines the imported blob, or simply rejects it without writing, and leaves the live itinerary untouched: the D-091 pattern applied to the import boundary. A good export re-imports to a byte-identical itinerary (round-trip). Import goes through `saveItinerary` so D-018/D-031 hold, including importing an empty `[]`.
- **Guarding tests:** new unit tests for export→import round-trip identity; malformed-import→reject/quarantine with current data intact; version-mismatch import runs the migration runner, so importing a v2 export into a v3 build migrates. E2E (a new small wave, or an extension of the persistence pack): export produces a file; import of a known-good fixture reloads the itinerary; import of a corrupt fixture shows a safe failure and the pre-import plan survives reload.
- **Risks:** (1) import is the one place untrusted data enters the Vault, so the lenient-read rule (section 1.3) must not be so lenient it accepts garbage; the schema is the trust boundary. (2) the UI/UX for the failure state is a frontend concern; the contract (never destroy on bad import) is architectural and locked here, while the surface is a UI call. (3) deciding whether export includes prefs/identity or is itinerary-only is a scope call; itinerary-only is the recommendation for v1, since identity and token are device-soft rather than portable trip data. Flagged.

### S93 — Headless Core 1 (extract dates / countdown / trip-clock into pure `core/`)
- **Inputs:** this blueprint, section 4; `lib/trip-data.ts` (TRIP_START/END, TRIP_DATES, getCountryForDate), `lib/trip-now.ts` (getNow, getTodayInTrip, the `?today=` override), and the countdown computation (D-016 `computeCountdown`, pure).
- **Output:** `core/clock/` and `core/dates/` holding the pure date math and the countdown computation; `ClockPort` defined; `lib/trip-now.ts` becomes the adapter that implements `ClockPort.now()` (resolving the URL/sessionStorage override, D-075) and delegates math to core. `computeCountdown` stays pure, taking `now: Date`.
- **Hard acceptance:** behavior-identical. Countdown months/weeks/days/hours/min/sec plus total-days math unchanged; `getTodayInTrip` day-numbering unchanged; the `getCountryForDate` boundary (the B-01 lexicographic fix) unchanged; the `?today=` override and `off` semantics unchanged; sessionStorage-only for the override preserved (D-075). Trip-year constants stay configured in one place (D-006).
- **Guarding tests:** the S77 unit suites for dates and countdown stay green with zero assertion edits; the E2E countdown/fake-clock pack (S82) and date-boundary pack stay green unchanged. New: core-level pure unit tests for the extracted `computeCountdown(now)` across the same fixtures.
- **Risks:** (1) timezone traps are already fixed here (B-01, the UTC/local edge), so the extraction must carry the exact string-compare and local-parts logic rather than "cleaning it up". (2) the override precedence (URL > sessionStorage > real) and the once-per-load cache in `trip-now.ts` are subtle, so the port boundary must not change *when* resolution happens (first-paint parity). Low blast radius otherwise, since no user data is touched.

### S94 — Headless Core 2 (extract itinerary CRUD + persistence behind ports; gateway becomes StoragePort)
- **Inputs:** this blueprint, sections 1 to 4; `hooks/use-itinerary.ts` (the D-031 commit path and mutators), the Vault (S90), the gateway (S91), and the `StoragePort`/`SyncPort` interfaces.
- **Output:** the itinerary CRUD (add/update/remove/move/reorder plus `synthesizeDay`/`upsertDay` and `findPlacements`) extracted as pure functions in `core/itinerary/` operating on `DayPlan[]`; the persistence contract expressed as `StoragePort` with the Vault gateway as its production implementation; `hooks/use-itinerary.ts` becomes the thin React adapter (state, effects and event dispatch) wiring core functions to the ports. `pushPlans` stays wired via `SyncPort` from the same single `commit()` choke-point, preserving D-039 echo-suppression.
- **Hard acceptance:** behavior-identical CRUD and persistence. D-018 (key presence, `[]` survives), D-031 (read-modify-write from freshest persisted state; chained mutations in one handler compose), D-091 (quarantine), D-026 (same-tab CustomEvent and cross-tab storage event), D-039 (push only from `commit()`, never the snapshot path; a remote failure never breaks a local edit), and attribution stamping (D-041) are all unchanged. The Vault-as-StoragePort swap changes no observable behavior.
- **Guarding tests:** the full E2E persistence hard-guarantee pack (S81: CRUD/reload, `[]`-survives, empty-state, packing), the calendar CRUD flows, and the S77 store/merge unit primitives stay green with zero assertion edits. New: pure-function unit tests for each CRUD op on `DayPlan[]` (no React), and a StoragePort contract test where a fake in-memory port drives the same CRUD.
- **Risks:** (1) the highest blast radius in the whole sequence, since this is the live data core and the remote-sync choke-point. A subtle change to `commit()`'s "derive from `loadItinerary()` not the closure" invariant reintroduces the pre-S78 destructive overwrite; mitigate by extracting mechanically (move code, don't rewrite) behind the frozen E2E pack. (2) the dynamic `import('@/lib/itinerary-remote')` on the hot path (D-038/D-047 dormant-safe) must survive the port indirection, so the SyncPort adapter has to stay lazy and gated, keeping the dormant build from pulling firebase. (3) event names (`itinerary:changed`, and the `storage` key `'nepal_japan_itinerary'` literal in the listener at `use-itinerary.ts:95`) are cross-module contracts, so they must route through the gateway's key constant rather than a hardcoded string, or the cross-tab listener silently stops matching.

---

## 6. Seam and risk summary

- The whole design is subordinate to D-018/D-031/D-091 (all LOCKED) and to the "live plus sync-enabled" reality. Nothing here reopens them; the Vault formalizes them. Migration #1 is an identity precisely so it cannot lose live data.
- No LOCKED decision is pressured, but three are *touched* and need their extension recorded (proposed below): D-018 (the envelope preserves the three states plus a fourth legacy input), D-031 (the Vault is transparent to read-modify-write), and D-078c (the gateway makes the storage-literal rule structural, ahead of multi-trip). These are extensions or confirmations rather than changes, and recording them keeps the question from being re-litigated later.
- D-002 stays intact: the Vault is localStorage-backed, with no IndexedDB. If a future slice wants IndexedDB (for large exports, say), that is a D-002 amendment and needs an owner decision. Flagged, not done.
- D-042/D-088 stay intact: Firestore stays per-day and Spark-free, and SyncPort is shaped to fit. Any Sync v2 idea wanting different granularity reopens these and needs an owner decision. Flagged for S95, not decided here.
- One open scope call (S92): whether whole-trip export includes prefs/identity or is itinerary-only. Itinerary-only is the recommendation for v1.
- Key-count correction: the true persisted-key count is 8, not the earlier "~10+" estimate. Two literals are duplicated and one is raw, which is the D-078c debt, and the gateway pays exactly that debt.

---

## Proposed DECISIONS.md entries

> Drafted for `DECISIONS.md`, numbered from **D-095** (D-094 is the last recorded). These record the S89 blueprint so S90–S94 build against locked contracts, and so nobody re-litigates them later.

### D-095 · LOCKED · Trip Vault envelope — versioned `{schemaVersion, updatedAt, payload}`, Zod-validated, ordered-migration runner (S90; blueprint `docs/data-core-blueprint.md`)
Local persisted domain data is wrapped in a minimal versioned envelope `{ schemaVersion: number; updatedAt: string(ISO); payload: T }`, validated with the already-present `zod` dep (no new deps, D-088). A migration runner holds an ordered `migrations[]` of pure `from→to` steps; the current itinerary target is schemaVersion 3, and migration #1 is v2→v3, where v2 is today's bare `DayPlan[]` array on `nepal_japan_itinerary` and the v3 payload is the same array (the step is a payload identity, lossless by construction, and only the wrapper is added). Read resolves four inputs: absent → seed sample; legacy un-enveloped array (v2) → run the migration runner → v3; valid v3 envelope → payload verbatim (including `[]`); corrupt, parse-fail, lenient-Zod-fail or migrate-throw → quarantine then sample. Reads use lenient schemas (`category` as `z.string()`, `.passthrough()` unknown fields), so real deployed data with unknown categories or fields is never destroyed (D-018). A future or unknown `schemaVersion` greater than current is read leniently, never down-converted and never quarantined, for rollback safety. Writes always emit the current envelope, including `payload: []`.
**Why:** the itinerary is a bare array with no way to know which schema wrote it. An on-disk version header turns every future format change into a deterministic, testable, ordered migration instead of a defensive guess, at the cost of one wrapper object. The site is live and sync-enabled, so lossless-with-quarantine is mandatory, and an identity v2→v3 is the safest possible first migration.
**Changes if:** a real v3→v4 shape change lands (append a step; never reorder or renumber a shipped step), or the envelope genuinely needs `id`/`checksum`/history (add only when a slice needs it, and record it then).

### D-096 · LOCKED · Vault quarantine-on-failure generalizes D-091 to migrate + validate failures (S90)
D-091's corrupt-payload convention is folded into the Vault read path and now fires on any failure: a JSON parse error, an unrecognized shape, a failed lenient Zod validation, or a throwing migration step. Preserve the raw original string verbatim to `nepal_japan_itinerary_corrupt`, but only if that key is absent (don't-clobber-first-capture), `console.warn`, never throw (the preserve attempt is itself try/caught), then fall back to `SAMPLE_ITINERARY`. This preserves D-031 non-destructiveness: because `commit()` derives its next state from the Vault read, quarantining the raw bytes before the sample fallback is what stops the next edit from overwriting the user's real (corrupt but recoverable) trip.
**Why:** the migration/validation path introduces new failure modes. Without folding quarantine into them, a failed migration would fall back to sample and the next `commit()` would destroy the original bytes, which is the exact pre-S78 destructive loop.
**Changes if:** a recovery UI is built that consumes the quarantine key (record its contract then). Never remove the preserve-before-fallback ordering.

### D-097 · LOCKED · Typed storage gateway — one module fronts all 8 persisted keys; D-078c becomes structural (S91)
All persisted web-storage access funnels through one typed gateway (`core/storage/gateway.ts`, re-exported through `lib/`). It owns the single `STORAGE_KEYS` map and is the only place raw `window.localStorage`/`window.sessionStorage` is touched in app code (tests excepted). The verified full inventory is 8 keys, not the earlier "~10+" estimate: `nepal_japan_itinerary` (plus `…_corrupt`), `tripPlannerUserName`, `tripPlannerToken`, `tripPlannerGuest`, `packing_checklist` and `nightlife_section_visible` (all localStorage), and `tripPlannerTodayOverride` (sessionStorage, D-075). On-disk key names and value shapes are unchanged, since the gateway is a typed wrapper over identical bytes. The three duplicated or raw literals (`tripPlannerGuest` across navbar/token-gate/use-active-traveler including a raw literal in `navbar.tsx`; `tripPlannerUserName` duplicated in `identity.ts` and `token-auth.ts`; `packing_checklist` raw in `travel-essentials.tsx`) collapse to single references. Every accessor is SSR-safe (`typeof window` guard → typed fallback or no-op) and never throws (quota and disabled storage degrade quietly). The gateway is store-aware (per-key `local`|`session`) and does not unify or migrate across backends, so D-075's session override stays session. `clearIdentity` must clear both name and token, and the nightlife pref stays `String(boolean)` with a lenient parse rather than `JSON.parse`.
**Why:** it makes D-078c's storage-literal rule structural rather than a convention (a grep-clean of raw `localStorage.` outside the gateway), pays down the concrete duplicated/raw-literal debt, and is the one-module seam a future multi-trip migration would extend, without building multi-trip now.
**Changes if:** multi-trip is greenlit (the gateway grows a trip-prefix helper as its own slice, reopening the D-078c "future migration" note), or a new persisted key is added (it lives in `STORAGE_KEYS`, never as a raw literal).

### D-098 · LOCKED · Whole-trip export/import validates through the Vault schemas and fails safe (S92)
User-facing whole-trip export serializes the itinerary Vault envelope to a downloadable JSON; import parses, validates through the same Zod schemas, and replaces via the Vault write path on success. A bad or hostile import never destroys current data: validation failure rejects (or quarantines the imported blob, the D-096 pattern) and leaves the live itinerary untouched. Import runs the migration runner, so a v2-era export imported into a v3 build migrates. Client-side only (Blob/File, D-004 intact). The v1 scope is itinerary-only, since identity and token are device-soft rather than portable trip data, unless we widen it.
**Why:** import is the one place untrusted data enters the Vault. The schema is the trust boundary, and D-091's never-destroy discipline extends to it. Reusing the same schemas guarantees an export/import round-trip is lossless.
**Changes if:** export should include prefs/identity (widen the serialized set and record it), or a recovery UI consumes import-quarantine.

### D-099 · LOCKED · Headless Core `core/` boundary + Storage/Sync/Clock ports; extraction order S93 (clock) before S94 (itinerary) (S93/S94)
A framework-free `core/` package (plain TS; no React/Next/`window` except via an injected port) holds the Vault, the domain logic (dates/countdown; itinerary CRUD), and three narrow ports it defines and the framework layer implements: StoragePort (impl = the Vault gateway, wired at S94), ClockPort (impl = the `lib/trip-now.ts` adapter, resolving the `?today=` override, D-075), and SyncPort (impl = `lib/itinerary-remote.ts`, per-day-shaped to stay Firestore/Spark-compatible per D-042/D-088, left compatible and not redesigned, since Sync v2 is S95). Arrows point inward (UI→core, never core→UI). Extraction order: S93 (dates/clock/countdown, the low-risk pure math) before S94 (itinerary CRUD and persistence, the high-blast-radius live-data core); the gateway becomes the StoragePort impl at S94. Both extractions are refactors behind frozen nets: the S77 unit suites and the S80/S82 E2E waves (persistence, countdown, calendar CRUD, date-boundary) have to stay green with zero assertion changes, since a test that needs editing means behavior changed and the extraction is wrong. D-018/D-031/D-091/D-026/D-039/D-041 are all preserved; the dynamic-import dormant-safe firebase path (D-038/D-047) survives the SyncPort indirection because the adapter stays lazy and gated. The cross-tab `storage`-event key literal and the `itinerary:changed` event route through the gateway key constant rather than hardcoded strings.
**Why:** ports-and-adapters makes the domain pure and unit-testable in isolation and decouples it from Next/React. Extracting the pure clock first proves the boundary and the frozen-net method on data that can't corrupt, before moving the dangerous itinerary core, and the clock is also a dependency of itinerary day-math, so it has to exist as a port first.
**Changes if:** IndexedDB or a non-localStorage backend is wanted (StoragePort's impl changes; localStorage-source-of-truth is D-002 LOCKED, so it needs an owner decision), or Sync v2 (S95) needs a different granularity (which reopens D-042/D-088 and needs an owner decision). The SyncPort *interface* is the seam it designs against, but changing per-day granularity is not S89–S94's to make.
