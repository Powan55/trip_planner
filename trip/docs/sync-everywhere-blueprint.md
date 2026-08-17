# Sync Everywhere blueprint: store factory, per-domain SyncPorts, offline outbox (S139)

_Blueprint for M17 Phase 2 (S140–S145). It takes sections 4, 6 and 8 of `docs/v4-technical-doc.md` and makes them concrete and buildable. Source code read: `core/sync/{hlc,merge-day,stamp}.ts`, `core/ports.ts`, `hooks/use-{itinerary,expenses,journal}.ts`, `lib/{itinerary-ports,itinerary-remote}.ts`, `components/itinerary-provider.tsx`, `core/storage/gateway.ts`, `core/budget/{model,storage}.ts`. No production code changes in this slice: this document plus the proposed decision entries only. D-numbers are cited inline; the proposed new entries are collected in section 8, and their numbers assume D-147 is the latest._

---

## 0. Scope and the one sentence per slice

| Slice | Builds | From this doc |
|---|---|---|
| S140 | `createReactiveStore` factory + `use-budget` hook; migrate journal → expenses → budget → itinerary LAST | section 1 |
| S141 | `core/sync/outbox.ts` (FU-19); itinerary adopts it | section 3 |
| S142 | Expenses sync (`mergeItems`, chunked docs, attribution) | sections 2.1, 2.2, 4 |
| S143 | Budget sync (LWW-per-field singleton) | sections 2.3, 4 |
| S144 | Expense split (`paidBy?`/`split?`), riding the section 2.2 row shape unchanged | section 2.2 note |
| S145 | Tombstone-replace Restore (FU-20, supersedes D-121) + `gcTombstones` (FU-23) + P3 riders | sections 5, 6 |

The journal never syncs; section 7 records that privacy decision. Packing-list sync is moot, because the key is retired (section 7.2).

---

## 1. `createReactiveStore<T>`: the store factory (#21, S140)

### 1.1 What is being extracted (evidence)

The hydrate/listen/commit skeleton exists three times, near-verbatim: `hooks/use-itinerary.ts` (state + `hydratedRef` + mount-load + CustomEvent/`storage` re-read + `commit()` with load-fresh/save/setState/dispatch/push), `hooks/use-expenses.ts` (the same minus sync), `hooks/use-journal.ts` (the same minus sync). Budget has no hook at all; `budget-panel.tsx` reads ad hoc. This is an extraction of a proven, triplicated pattern, not a new abstraction.

### 1.2 Contract (frozen signature)

New file `hooks/create-reactive-store.ts`. It is the React side, owning `useState`/`useEffect`; the pure ports stay in `core/ports.ts`:

```ts
import type { StoragePort, SyncPort } from '@/core/ports';

export interface ReactiveStoreConfig<T> {
  /** Same-tab CustomEvent name. BYTE-FROZEN per domain (D-026):
   *  'itinerary:changed' · 'expenses:changed' · 'journal:changed' · 'budget:changed' (new). */
  eventName: string;
  /** On-disk key literals the cross-tab `storage` listener matches
   *  (`e.key === one of these || e.key === null`). Always the exported constants
   *  (ITINERARY_STORAGE_KEY / STORAGE_KEYS.*), never a literal (D-026). */
  storageKeys: readonly string[];
  /** The existing per-domain StoragePort. D-018/D-091 (key-presence, []-survives,
   *  quarantine, sanitize-on-load) live INSIDE the impl — the factory is agnostic. */
  storage: StoragePort<T>;
  /** Optional remote fan-out. Absent ⇒ local-only domain (journal). */
  sync?: SyncPort<T>;
}

export interface ReactiveStoreCore<T> {
  value: T;          // the raw persisted-shape value (tombstones INCLUDED for synced domains)
  hydrated: boolean;
  /** THE single write choke-point (D-031/D-039):
   *  gate on hydrated → prev = storage.load() → next = compute(prev) → storage.save(next)
   *  → setState(next) → dispatch(eventName) → void sync?.push(prev, next)  [fire-and-forget]. */
  commit(compute: (current: T) => T): void;
}

/** Called ONCE at module scope per domain; returns the domain's core hook. */
export function createReactiveStore<T>(config: ReactiveStoreConfig<T>): () => ReactiveStoreCore<T>;
```

The factory has to reproduce four behavior lines byte-for-byte in effect. Each is already commented in the three hooks, and the factory centralizes those comments too:

1. **Hydration gating:** state starts at the StoragePort's SSR value; the mount effect loads and sets `hydrated`; `commit()` and the event re-read both no-op before hydration, so a first-render `[]` or sample can never clobber storage.
2. **Reactivity, both layers (D-026):** every commit dispatches the CustomEvent; the hook listens to that event and to the cross-tab `storage` event (key-match, or `key === null` for a full clear), re-reading from the StoragePort rather than from a stale closure.
3. **Fresh-base commit (D-031):** `compute` receives `storage.load()`, so chained mutations in one handler compose.
4. **Push placement (D-039):** `sync.push(prev, next)` fires only from `commit()`, after the local save and dispatch, fire-and-forget, and never throws to the caller. At S141 this line becomes the outbox-decorated push from section 3: same call site, no factory change.

What stays in the domain hooks, not the factory: all mutators (they are domain semantics built on `commit`), all stamping (attribution D-041 plus `stampSync*` gated on `isRemoteConfigured()`, D-038), the itinerary's exposed-`plans` tombstone filter and its selectors, `freshCopyOf`, id generation, and timestamp injection. The factory knows nothing about items, ids, or tombstones.

### 1.3 Migration order and why: journal → expenses → budget → itinerary last

1. **Journal.** The simplest instance (no sync, no undo nuance), so it proves the skeleton.
2. **Expenses.** Adds the restore/undo mutator surface; still no sync.
3. **Budget.** The greenfield case: a new `hooks/use-budget.ts` built directly on the factory (event `'budget:changed'`, key `STORAGE_KEYS.budget`, storage = `loadBudget`/`saveBudget` wrapped as a `StoragePort<BudgetModel>`; note it needs a `has()` impl, raw key-presence via the gateway). `budget-panel.tsx` adopts it, and that panel edit is the *deliverable* of the use-budget half, not a migration regression. It proves the factory on a brand-new consumer.
4. **Itinerary last.** The most complex (sync fan-out, stamping, tombstone filter) and the most-tested: its Vitest and Playwright nets are the frozen safety net. By the time it migrates, the factory is proven ×3.

Run the full nets green after each domain. That is four commit points, not one.

### 1.4 "Zero consumer edits", the concrete definition

The S140 migration passes only if all of these hold:

- The diff touches only `hooks/use-{journal,expenses,itinerary}.ts`, the new `hooks/create-reactive-store.ts`, and (for the budget half) `hooks/use-budget.ts` plus `budget-panel.tsx`. No other component or lib file changes.
- Exported public interfaces `ItineraryStore` / `ExpenseStore` / `JournalStore` are byte-identical; every consumer compiles unedited.
- Event constants keep their exact strings and export paths: `ITINERARY_CHANGED_EVENT` stays exported from `@/hooks/use-itinerary` (`lib/itinerary-remote.ts` imports it from there), `EXPENSES_CHANGED_EVENT` from `@/hooks/use-expenses`, `JOURNAL_CHANGED_EVENT` from `@/hooks/use-journal`. `freshCopyOf` stays exported from `@/hooks/use-itinerary` (the S128 duplicate uses it).
- On-disk keys and value bytes are unchanged, and the dormant build is byte-identical in behavior (D-038): the existing Vitest suites and the persistence/E2E pack pass with zero assertion edits.

---

## 2. Per-domain SyncPorts

`SyncPort<T>` (`core/ports.ts`) is already generic (`push(prev,next)` / `subscribe(onApplied)` / `isConfigured()`) and is not reshaped. What a synced domain provides is the four ingredients its adapter is assembled from:

| Ingredient | Itinerary (exists) | Expenses (S142) | Budget (S143) |
|---|---|---|---|
| **Stamp** | `stampSync{Created,Updated,Deleted}` on items, gated on `isRemoteConfigured()` | the same helpers, generalized (section 2.1); `Expense` gains additive `rev?`/`hlc?`/`deleted?` | per-field HLC map (section 2.3), gated the same way |
| **Merge** | `mergeDay`/`mergeDays` (D-106, frozen) | `mergeItems`, the id-keyed generalization (section 2.1) | `mergeBudget`, LWW-per-field (section 2.3) |
| **Chunk map** | day (`date`) → `days/{date}` | leg → `expenses/{leg}` (section 4) | singleton → `budget/model` |
| **Write pattern** | `pushDayMerged` (tx read → merge → set) | `pushChunkMerged`, the same tx pattern | `pushBudgetMerged`, the same tx pattern |

All three adapters carry the identical gates: dormant (`isRemoteConfigured()`, D-038, dynamic-import only, D-047), guest (`getActiveTraveler()` before any push and before subscribe, D-055/D-120), echo-suppression (snapshot apply via `save()` plus dispatch directly, never `commit()`, D-039), and never-throw degradation.

### 2.1 `mergeItems`: generalizing `mergeDay` (new `core/sync/merge-items.ts`, pure)

`mergeDay`'s per-id fold (`resolvePair` + `contentFingerprint`, merge-day.ts:54–94) is already item-generic; only the `DayPlan` wrapper and the day-metadata handling are itinerary-specific. Extract:

```ts
/** Structural row type — anything id-keyed with the Sync-v2 stamps. */
export interface SyncedRow {
  id: string;
  rev?: number;
  hlc?: string;
  deleted?: boolean;
  updatedAt?: string;   // legacy HLC seed source (seedHlcFromLegacy)
}

export function resolvePair<R extends SyncedRow>(a: R, b: R, policy: MergePolicy): R;

/** Union by id, resolvePair on collisions; live rows sorted hlc-asc (id tie-break),
 *  tombstones appended — the exact mergeDay ordering rule, minus the day partition.
 *  COMMUTATIVE + IDEMPOTENT for the same reasons (D-106); property-tested with the
 *  S96 500-pair pattern (tech-doc section 8). */
export function mergeItems<R extends SyncedRow>(local: R[], remote: R[], policy?: MergePolicy): R[];
```

Refactor rule (D-106 is locked): `merge-day.ts` keeps its exact exports and behavior, and its per-id fold delegates to `merge-items.ts` (or `resolvePair` moves there and `merge-day` imports it). The existing S96 suite passes with zero assertion edits, and that is the refactor's proof. The delete-vs-edit policy stays `'hlc'` by default (tombstone-wins-unless-strictly-later), same flag.

Expense row specifics (S142):

- `Expense` gains additive optional `rev?`/`hlc?`/`deleted?`. S144's `paidBy?`/`split?` follow later through the same additive mechanism: they ride the merge unchanged, and old clients ignore unknown fields per D-107.
- `sanitizeExpenses` (`core/budget/expenses.ts`) has to pass the new optional fields through. Make it a DoD line: it currently defines the salvage shape, and silently stripping `hlc` would break merge ordering and violate D-038's stamped-bytes expectations.
- Dormant: `removeExpense` physically removes exactly as it does today (byte-identical, D-038). Sync-on: it tombstones (the `stampSyncDeleted` analog); the exposed `expenses` value filters `deleted !== true` (the S97 selector pattern, zero consumer edits); "logged by {name}" attribution rides D-041's existing stampers.
- **Undo under sync (the D-032/D-119 trap):** `restoreExpense` currently re-inserts verbatim under the same id, and under sync that loses to its own tombstone because of the `resolvePair` HLC-tie bias. The rule: dormant restore stays verbatim same-id (byte-identical), and sync-on restore inserts a fresh-id copy (strip `id`/`rev`/`hlc`/`deleted`, mint a new id, stamp created), which is the same one-rule-everywhere the itinerary uses. We considered same-id re-stamped with a strictly-later HLC and rejected it for consistency: one undo rule across domains, and fresh ids are already mutation-test-proven in this codebase.

### 2.2 Expense subscribe + first-snapshot semantics

`onSnapshot` on `trips/{TRIP_ID}/expenses` (2 docs). The per-domain "ever synced" marker is chunk-doc presence, not the `trips/{TRIP_ID}` trip doc. The trip doc only says the group synced the *itinerary*: on the day expense sync first deploys, it would be true while the expense docs are still absent, and an authoritative-empty apply would wipe local expenses. Doc presence is sound because a deliberately-emptied expense list under sync leaves *tombstoned rows in a present doc*, never an absent doc:

- Chunk doc present: the first snapshot is authoritative for that chunk (verbatim, including empty, for D-091/D-018 parity), except for outbox-dirty chunks (section 3.4).
- Chunk doc absent: never synced, so seed that chunk from local rows (push-up, local untouched). That is the D-049 handshake shape applied per chunk, with no separate marker doc needed.
- Steady state: `mergeItems(loadLocal-chunk, remote-chunk)`, applied via `saveExpenses()` plus dispatch directly (D-039).

### 2.3 Budget: LWW-per-field singleton (S143)

Budget is a small struct (`BudgetModel`: `homeCurrency`, `rates.{NPR,JPY}`, `legBudgets.{nepal,japan}`, `categoryBudgets.<leg>.<category>`, at most about 25 leaf scalars). No list and no ids means no tombstones. The right granularity is the leaf field, so two friends editing different category caps both keep their edits.

**Field paths:** canonical dotted leaf paths, enumerated by a pure `flattenBudget(model): Record<string, number | string>` in `core/budget/` (for example `homeCurrency`, `rates.NPR`, `legBudgets.japan`, `categoryBudgets.nepal.food`). The path list is closed, derived from `BUDGET_CATEGORIES` × legs plus the fixed scalars, so there are no dynamic keys.

**Local shape (additive, D-038-gated):** `BudgetModel` gains optional `sync?: { fieldHlc: Record<string, string> }`. Dormant never writes it (stamping is gated on `isRemoteConfigured()`), so dormant key-10 bytes stay identical. `normalizeModel` has to preserve it. That is another DoD line: it currently rebuilds the model and would silently strip an unknown field.

**Remote doc:** `trips/{TRIP_ID}/budget/model`:

```ts
{ version: 1, fields: Record<path, { v: number | string | null, hlc: string }> }
```

**Merge (`mergeBudget`, pure, `core/sync/merge-budget.ts` or colocated):** per path, the higher HLC wins; a side missing a stamp for a path is seeded oldest (`seedHlcFromLegacy(undefined)` ⇒ pt 0, so seeded defaults always lose to any real edit); an exact tie is broken by the value's canonical JSON, which is argument-order-independent (the merge-day robustness trick). It is commutative and idempotent by the same lattice argument; property-test it.

**Clearing a field:** a cleared category budget is written as a stamped `null` (`{v: null, hlc}`), and the rebuild maps `null` → absent. A stamped null is the per-field "cleared" state without tombstone machinery, and the map is bounded (≤25 entries), so nothing ever needs GC.

**Edit stamping:** each local commit that changes budget fields diffs `flattenBudget(prev)` against `flattenBudget(next)` and advances the HLC (`hlcSendOrLocal`) for exactly the changed paths, gated on `isRemoteConfigured()`.

**Write/subscribe:** `pushBudgetMerged` = tx read → `mergeBudget` → set (the `pushDayMerged` analog); subscribe on the single doc; doc-presence is the first-snapshot marker (absent → seed from local, even if local is the seeded default, which is one idempotent write).

---

## 3. Offline outbox: `core/sync/outbox.ts` (FU-19, S141)

### 3.1 The failure it fixes

Today a failed push is dropped (`pushPlans` swallows it), and on reload the first-snapshot-authoritative apply discards the never-pushed offline edits (S110 TL-A P2-1). We adopt the fix direction named in FU-19: a dirty-chunk set plus push-before-subscribe.

### 3.2 Design choice: state-based, not op-based

The outbox does not queue CRUD ops. Every remote write is a merge-aware transactional read→merge→set over commutative, idempotent merges, so the minimal sufficient record is *which chunks have unconfirmed local changes*. On flush, the current local state of each dirty chunk is re-pushed through the same merged write.

That resolves the undo↔outbox interplay by construction. An add followed by its undo-delete while offline nets inside localStorage (under sync the undo path leaves the tombstone and fresh-id mechanics per D-032/D-119), and the flush pushes the net result once. There is no op ordering, no coalescing algorithm and no replay; re-enqueueing an already-dirty chunk is a set no-op. `commit()` remains the only mutation path, so the outbox can never observe a half-applied edit.

### 3.3 Persistence + op-record shape

Gateway slot (D-097; **key 15**, localStorage; the sketch below said 14, but `favorites` took 14 first; the string is the contract, the number is documentation):

```ts
// STORAGE_KEYS.syncOutbox = 'nepal_japan_sync_outbox'  (key 15)
type SyncDomain = 'itinerary' | 'expenses' | 'budget' | 'docs';

interface OutboxSlot {
  version: 1;
  dirty: Partial<Record<SyncDomain, string[]>>;
  //   itinerary → 'YYYY-MM-DD' day dates
  //   expenses  → 'nepal' | 'japan' chunk legs
  //   budget    → ['model'], the singleton
  //   docs      → ['checklist'], the singleton (added when the docs domain gained sync)
  /** ISO timestamp of the most recent successful ack, app-wide (not per-domain);
   *  absent on a fresh or pre-existing slot. Additive, no version bump. */
  lastAckAt?: string;
}
```

SSR-safe, never-throw, corrupt-slot→empty: all inherited from the gateway primitives. It survives reload by construction, which is the whole point.

### 3.4 Mechanics

**The decorator seam.** The outbox wraps a domain's push as a `SyncPort`-compatible decorator, so the factory's `commit()` tail is untouched:

```ts
export interface ChunkSync<T> {
  domain: 'itinerary' | 'expenses' | 'budget';
  /** Pure prev→next chunk diff (dates whose dayEquals is false; legs whose row-set changed; ['model']). */
  chunkDiff(prev: T, next: T): string[];
  /** Merge-aware transactional write of ONE chunk from `current`.
   *  MUST REJECT on failure — the decorator is the swallower, not the impl.
   *  (Contract change from pushPlans' swallow-everything: honesty moves down one layer.) */
  pushChunk(chunk: string, current: T): Promise<void>;
}

export function withOutbox<T>(cs: ChunkSync<T>, storage: StoragePort<T>): SyncPort<T>['push'];
export function flushOutbox<T>(cs: ChunkSync<T>, storage: StoragePort<T>): Promise<void>;
```

**Push path (write-ahead):** decorated `push(prev,next)` = ① enqueue `chunkDiff(prev,next)` into the dirty set (a synchronous localStorage write, before any network) → ② attempt `pushChunk` per dirty chunk of this domain → ③ on each resolve, remove that chunk from the set (ack) → ④ rejections are swallowed and the chunk stays dirty. A crash mid-push leaves the record, so no edit is lost.

**Enqueue gating (D-038/D-055):** enqueue happens only when `isConfigured() && getActiveTraveler()`. Dormant and guest builds never write the slot, so dormant bytes stay identical and guests can never queue pollution for later. A traveler who signs out with a dirty outbox keeps the entries, and flush resumes on sign-in (flush re-checks both gates).

**Flush triggers:** `window 'online'` · `visibilitychange` → visible · app start (provider mount). Flush iterates the domain's dirty set with `current = storage.load()`, same ack rule. Concurrent flushes are guarded by a simple in-flight flag, and a cross-tab double-flush is harmless (idempotent writes; an ack race at worst leaves a chunk dirty for one extra idempotent re-push).

**Push-before-subscribe and the dirty-chunk merge exception (the reload fix):** on app start the provider ① attempts `flushOutbox` first, ② then opens `subscribe`. If the client is still offline, the first server snapshot may arrive before the flush succeeds, so a second guard is required: the first-snapshot apply is authoritative only for chunks that are not in the dirty set, and dirty chunks are steady-state-merged instead. This is safe against D-091/D-018 (delete-all-stays-empty, no sample resurrection). A chunk can only become dirty through real `commit()` calls by an identified traveler on a configured build, and the sample-resurrection scenario involves zero commits, so the outbox is empty and behavior is byte-identical to today. Merging genuine stamped edits is exactly what the HLC/tombstone machinery exists for.

**Exactly-once, stated precisely:** *at-least-once transport × idempotent merged writes = exactly-once effect.* A dirty chunk is retried until one `pushChunk` resolves, and never zero times, because the record persists across reloads. Duplicate flushes produce value-identical docs (`mergeDay`/`mergeItems`/`mergeBudget` are idempotent, and the Firestore transaction re-reads on contention), and the ack ends retries. No dedup tokens and no sequence numbers: the merge algebra is the dedup.

**Itinerary adopts the outbox (closes TL-A P2):** `itinerarySyncPort.push` is wrapped with `withOutbox`, using `chunkDiff` = the dates whose `dayEquals(prev,next)` is false (the diff `pushPlans` already computes) and `pushChunk` = `pushDayMerged` for a present day. Accepted edge, flagged: a dirty date whose day is entirely absent from local state at flush time is skipped rather than `deleteDoc`ed. An unmerged delete could clobber a peer's re-created day, and whole-day removal is not a user-reachable op today (trip dates are fixed, and `clearDay` keeps the day). The existing prev/next `deleteDoc` path in the live `pushPlans` is unchanged.

---

## 4. Firestore layout + Spark quota math (D-088, with margins)

### 4.1 Layout

```
trips/{TRIP_ID}
  days/{date}          // existing itinerary per-day docs (D-042, unchanged)
  expenses/{leg}       // NEW — 2 chunk docs, doc id 'nepal' | 'japan'
                       //   { leg, items: Expense[] }  (rows carry id/rev/hlc/deleted + paidBy?/split?)
  budget/model         // NEW — 1 singleton doc { version, fields: {path: {v, hlc}} }
  docs/checklist       // added later: the critical-docs checklist singleton, same row-merge recipe
  presence/{deviceId}  // existing presence (D-057). The collection is `presence`, and the doc id is
                       //   the locally-minted device id, not a Firebase Auth uid (auth was stripped)
```

Chunk key = `expense.leg`, already a required row field, mirroring `DayPlan.country` (D-012). Chunk-by-leg beats chunk-by-month: 2 docs instead of 3, the key already exists on every row, and the per-doc sizes have plenty of headroom (below). Escape hatch if a chunk ever approached the 1 MiB doc limit: re-chunk by month (3 docs). Recorded, not built.

### 4.2 Doc-size math

Assume ~250 B/row JSON (id, amount, leg, category, date, note?, createdAt, attribution, rev/hlc/deleted, paidBy?/split?). Volume: 3 friends × ~10 expenses/day × 32 days ≈ **960 rows ≈ 1k**.

| Doc | Rows | Size | vs 1 MiB limit |
|---|---|---|---|
| `expenses/nepal` (~10 days) | ~300 | ~75 KB | **7%** |
| `expenses/japan` (~22 days) | ~660 | ~165 KB | **16%** |
| `budget/model` (≤25 fields) | — | < 4 KB | < 1% |

Even 4× the assumed volume keeps the largest chunk under half the limit.

### 4.3 Read/write budget per day (trip peak, 3 travelers)

Assumptions are labeled. Every write is one transactional write plus one in-transaction read; every peer write delivers 1 doc read to each of 2 subscribed peers; assume 8 app-opens/traveler/day, each re-attaching listeners (worst case: every doc billed on attach, so 32 days + 2 expense + 1 budget = 35 docs).

| Load | Writes/day | Reads/day |
|---|---|---|
| Expense logging (30 logs + ~10 edits/deletes) | 40 | 40 (tx) + 80 (peer delivery) |
| Itinerary edits (~60 commits — generous) | 60 | 60 (tx) + 120 (peer delivery) |
| Budget edits (~5) | 5 | 5 + 10 |
| Listener attaches (3 × 8 × 35 docs) | — | 840 |
| Presence heartbeats (existing, D-057: ~2 h visible × ≥30 s beat × 3) | ~720 | ~1,440 (peer delivery) |
| **Total** | **~825** | **~2,600** |
| **Spark daily limit** | **20,000** | **50,000** |
| **Utilization / margin** | **~4% → 24×** | **~5% → 19×** |

Storage: total remote data < 2 MB against a 1 GiB allowance, so negligible. Deletes: rare (day-doc removal only) against 20k/day, also negligible. Every assumption can be wrong by 10× at the same time and the app still stays inside Spark. Write-coalescing is already enforced upstream: bulk ops fold into one `commit()` ⇒ one merged write per changed chunk (S129/S130 precedent, D-088). No Blaze, no card, ever (D-088 locked).

---

## 5. `gcTombstones` policy (FU-23 → S145)

Status quo when this was drafted: `gcTombstones` (now `core/sync/merge-day.ts:84`) existed, was pure and tested, and was never invoked. That was fine at 3-user/32-day scale; tombstone growth is bounded by real deletes. **Since built:** it runs at exactly the two merge boundaries below (`lib/itinerary-remote.ts` on the merged result before `tx.set`, and again on the snapshot apply), and the id-keyed analog `gcTombstoneRows` (`core/sync/merge-items.ts`) does the same for expenses in `lib/expenses-remote.ts`. The day-shaped helper delegates to the id-keyed one, so there is a single GC predicate.

Policy, which is what S145 implements:

- **Where:** a post-merge pass at the two merge boundaries only: ① inside `pushChunkMerged`/`pushDayMerged` on the merged result before `tx.set`, ② in the steady-state snapshot apply on the merged result before persist. Never in the hot merge path, since a GC bug must not be able to lose a live item (the module's own rule), and never as a dedicated write, so it costs zero extra Firestore ops (the GC'd doc ships on the next genuine edit).
- **Predicate/horizon:** the existing default, a tombstone older than 30 days (`hlc.pt`) with no live same-id. Unchanged.
- **Expenses:** an id-keyed analog `gcTombstoneRows(rows, nowPt, horizonMs)` in `merge-items.ts`, same predicate. Budget: not applicable, since it has no tombstones and the stamped-null field map is bounded.
- **Convergence honesty:** clients GC at slightly different `nowPt`s, so a tombstone kept by one client re-enters via merge until every doc holding it is rewritten past the horizon. That is eventually convergent and conservative, and at a 32-day trip with a 30-day horizon GC will fire almost never. It exists to bound growth, not to run hot. Accepted.

P3 riders bundled into S145 (from FU-23):

1. **`getEntry` memoization.** `use-journal.getEntry` does a full `loadJournal()` parse per call. Memoize via a version-stamped ref (bumped in `commit()` and in the event re-read) so read-after-write-in-one-handler semantics are preserved; first verify that no caller actually depends on the raw re-read.
2. **Dead subscribe surface: closed.** `itinerarySyncPort.subscribe` (`lib/itinerary-ports.ts:90`) had zero production callers while `itinerary-provider.tsx` imported `subscribeRemote` directly. S145 re-routed the provider's `activate()` through the port, which already handles the dynamic import and the cancel-proxy, leaving one subscribe surface (`components/itinerary-provider.tsx:301`). D-055's identity gates stayed in the provider effect, unchanged. The expenses, budget and docs providers all subscribe through their own ports too (`itinerary-provider.tsx:352`, `:403`, `:454`), so no dead twin exists for them either.
3. **Hydration height reservation.** The today-panel and recap islands render short during hydration and then pop (CLS). Reserve settled min-heights: CSS only, presentation layer.

**Tombstone-replace Restore (FU-20, supersedes D-121), the direction for S145:** express `importItinerary` under sync as a diff against the current synced state inside one commit. Every currently-live id absent from the import is tombstoned (`stampSyncDeleted`), and imported items enter as fresh-id copies (`freshCopyOf` plus a created-stamp, the D-032 mechanics, so they can never lose to existing tombstones). The result pushes through the normal `commit()` fan-out (and the outbox), propagates to peers, and survives the next first-snapshot apply. Restore's local-mode path stays byte-identical, and the D-121 disable is then removed.

---

## 6. Emulator ceiling (test-strategy flag)

The two-client live-Firestore merge and outbox scenarios stay deferred to live validation, because of the JDK/emulator ceiling described in `docs/v4-technical-doc.md` section 8. It is the same document-rather-than-fake pattern as the itinerary two-client procedure in `docs/two-phone-sync-check.md`. What the build slices can prove deterministically: merge property tests (commutative and idempotent, the S96 500-pair pattern) for `mergeItems` and `mergeBudget`; outbox flush/ack/retry unit tests with a fake failing SyncPort; the undo↔outbox netting scenario from section 3.2 as a unit test; and offline E2E via the existing harness (edit offline → reload → outbox slot present → flush on restored network, mocked at the port). Real 3-friend cross-device validation happens on the deployed pair, as usual.

---

## 7. Privacy + retirement decisions

### 7.1 The journal never syncs (privacy by design)

The journal (gateway key 12) is a private per-day diary: mood, highlight, free text. It stays device-local, permanently. No SyncPort is ever wired (the `createReactiveStore` config simply omits `sync`), no Firestore path is ever assigned, and the export/import bundle remains the only way journal data leaves a device, which is an explicit user act. This is recorded as a decision (section 8, proposed D-152) precisely so that no future slice "helpfully" syncs it. The absence of the feature is not an oversight here; it is the design. Same posture as photos in `docs/v4-technical-doc.md` section 6: never syncs.

### 7.2 Packing-list sync is moot, and key 6 is retired (D-130 rider)

S113D deleted the packing-checklist feature and gateway key 6 (`packing_checklist`) entirely, and the gateway registry keeps the numbering gap as historical documentation (the `STORAGE_KEYS` doc comment in `core/storage/gateway.ts`). So the V4-DEVPLAN "should packing sync?" open question was answered by deletion rather than by design. Retirement, stated: key number 6 and the string `packing_checklist` are never reused for any future slot. Residual `packing_checklist` values in deployed browsers are orphaned bytes: harmless, and deliberately not cleaned up, since a cleanup write is more code and more risk than the dead bytes. **A packing checklist was later rebuilt as a different feature on a brand-new key** (`nepal_japan_packing`, a `PackingItem[]` seeded from a fixed country-scoped template, `core/packing/`). The retired string was not reused, and that store is local-only, wired without a `SyncPort`, so nothing here is owed a sync design.

---

## 8. Proposed DECISIONS entries (numbers assume D-147 is the latest)

### PROPOSED D-148 · `createReactiveStore`, the one reactive-store skeleton; four domains, frozen contract; migration order journal → expenses → budget → itinerary last
The `hooks/create-reactive-store.ts` factory per section 1.2: config = frozen event name + storage-key match set + `StoragePort<T>` + optional `SyncPort<T>`; returns a hook exposing `{value, hydrated, commit}`. It reproduces the four proven behavior lines (hydration gating; dual-layer D-026 reactivity; D-031 fresh-base commit; D-039 push-from-commit-only). Domain mutators, stamping and selectors stay in the domain hooks. "Zero consumer edits" per section 1.4 (diff confinement, byte-identical interfaces + event strings + export paths, zero assertion edits in existing suites, full nets green after each domain).
**Why:** the skeleton is triplicated near-verbatim today and budget bypasses hooks entirely, so sync-everywhere would make it four-way divergent. This extracts what works; it is not a plugin framework.
**Changes if:** a domain needs a fundamentally different reactivity model (then it opts out of the factory rather than bending it).

### PROPOSED D-149 · Per-domain sync = the four-ingredient recipe over the unchanged `SyncPort<T>`; `mergeItems` is the id-keyed generalization of `mergeDay`; budget is LWW-per-field with stamped-null clears and no tombstones
`SyncPort<T>` keeps its S97 shape. Expenses: additive `rev?`/`hlc?`/`deleted?` on `Expense`, `core/sync/merge-items.ts` (`resolvePair` extracted; merge-day delegates, and the S96 suite passes with zero assertion edits), dormant physical-delete against sync-on tombstone plus the exposed filter, and undo-under-sync = fresh-id copy (D-032/D-119, one rule everywhere). Budget: leaf-path HLC map (`flattenBudget` closed path set), stamped `null` = cleared field, `mergeBudget` per-path higher-HLC-wins with a canonical-JSON tie-break, additive `sync?.fieldHlc` on the local model (`normalizeModel` must preserve it). The per-domain first-snapshot marker is chunk or singleton doc presence, never the itinerary trip-doc marker. All gates carry over verbatim: D-038 dormant, D-047 dynamic import, D-055/D-120 traveler on push and on subscribe, D-039 echo-suppression.
**Why:** the itinerary machinery generalizes (section 2), and a struct needs field-LWW rather than row machinery.
**Changes if:** a synced domain arrives that is neither id-keyed rows nor a bounded struct.

### PROPOSED D-150 · The offline outbox is state-based (dirty-chunk sets) and a `SyncPort` decorator; push-before-subscribe plus a dirty-chunk merge exception on first snapshot; exactly-once = at-least-once transport × idempotent merged writes
`core/sync/outbox.ts` per section 3: gateway key 14 `nepal_japan_sync_outbox` holding `{version, dirty: {domain: chunkKey[]}}`; write-ahead enqueue in the decorated push, ack-on-resolve, and a rejection leaves the chunk dirty; `pushChunk` impls must reject honestly, since the decorator is the swallower. Flush on `online`, on visible, and at app start; the app-start order is flush and then subscribe; the first-snapshot apply is authoritative only for chunks that are not dirty, and dirty chunks steady-state-merge. Enqueue is gated on configured and identified traveler, so dormant and guest builds never write the slot (D-038/D-055 hold, and D-091/D-018 hold because a dirty chunk can only exist via real commits). The undo↔outbox interplay is resolved by construction, because the record is state rather than ops and the flush pushes the netted local state once. The itinerary adopts it, closing S110 TL-A P2-1 and FU-19; a flush of a locally-absent day is skipped rather than issuing a blind `deleteDoc` (accepted edge: whole-day removal is not user-reachable). **Shipped differently:** `favorites` took key 14 first, so the outbox is **key 15**. `core/storage/gateway.ts` records the swap on the `syncOutbox` slot ("the sketched key 14 for this slot, but favorites took 14 first — the outbox is the next free number, key 15"). The string `nepal_japan_sync_outbox` is the contract and is unchanged; the number is documentation. The slot also gained an additive `lastAckAt?: string` (`core/sync/outbox.ts`), with no `version` bump.
**Why:** the merge algebra already provides idempotent convergence, so recording chunks instead of ops eliminates the ordering, coalescing and replay machinery entirely.
**Changes if:** a non-merge-idempotent write path ever ships (it must not, since that would break the exactly-once argument at its root).

### PROPOSED D-151 · Spark layout: expenses chunked by leg (`trips/{tripId}/expenses/{nepal|japan}`), budget = one doc (`trips/{tripId}/budget/model`); the quota math shows ≥19× margin
Per section 4: ~1k expense rows ⇒ 75/165 KB chunks (≤16% of the 1 MiB doc limit); peak-day totals ≈ 825 writes / 2,600 reads against the 20k/50k Spark limits (~4%/~5% utilization, ≥19× margin, presence included). The write pattern is the `pushDayMerged` tx read→merge→set analog per chunk. Escape hatch, recorded but not built: re-chunk by month if a chunk approaches the doc limit. Free tier only, never Blaze (D-088).
**Why:** leg is already a required row field; 2 docs is the fewest that avoid whole-collection contention; and the math holds with 10× error on every assumption.
**Changes if:** row volume grows an order of magnitude beyond the 3-friend/32-day reality (then month-chunking).

### PROPOSED D-152 · The journal never syncs: privacy by design, permanent
Gateway key 12 stays device-local: no SyncPort wired, no Firestore path assigned, ever. Export/import, an explicit user act, remains the only egress. Recorded so that no future slice "helpfully" syncs it, because the absence is the design and not an oversight.
**Why:** a private diary shared by silent default would betray the surface's premise, and the cost of syncing it later (if we ever want that) is one config field, so locking local-by-default costs nothing.
**Changes if:** we explicitly want shared journal entries (then an opt-in per-entry share design, not a default sync).

### PROPOSED D-153 · `gcTombstones` runs as a post-merge pass at the two merge boundaries only; 30-day horizon; zero dedicated writes; eventually convergent and deliberately near-inert at trip scale
Per section 5: invoked on merged results inside `push*Merged` (before `tx.set`) and in the steady-state snapshot apply (before persist); never in the hot merge path, and never as its own Firestore write. Expenses get the id-keyed analog in `merge-items.ts`; budget is not applicable. Cross-client `nowPt` skew is accepted as conservative, and it converges as docs are rewritten. S145 implements it, and the P3 riders ride the same slice: `getEntry` memoization via a version-stamped ref, the provider re-routed through `itinerarySyncPort.subscribe` to kill the dead surface, and hydration min-height reservation.
**Why:** GC is tidiness rather than correctness, and the design keeps it structurally unable to lose a live item or to cost a write.
**Changes if:** doc sizes ever make tombstone growth a real cost (shorten the horizon, or add an explicit compaction write, which would be a new decision).

### PROPOSED D-154 · Gateway key 6 (`packing_checklist`) is retired, so the D-130 packing-sync question is moot
Number 6 and the string are never reused; no sync design or quota line is owed; residual on-disk values in deployed browsers are harmless orphaned bytes, deliberately not cleaned.
**Why:** S113D deleted the feature, and designing sync for a deleted feature would be work against nothing.
**Changes if:** never for the retired string. A future packing feature is a new slot with a new key, and **that is what happened**: `nepal_japan_packing` (`core/packing/`) was built later on a brand-new key and is deliberately local-only, so it inherits no sync design from key 6.

---

## 9. Honest scope calls and open flags

1. **Signature deviation from the technical doc's sketch.** `docs/v4-technical-doc.md` section 4 sketched `createReactiveStore<T>(key, coreOps, syncPort?)`. This blueprint drops `coreOps` from the factory: domain mutators differ in arity and semantics, and wrapping them generically would be exactly the speculative plugin framework we are avoiding. The factory extracts the triplicated skeleton and nothing else; mutators stay domain-side. Deliberate, and flagged.
2. **`restoreExpense` behavior change under sync.** Fresh-id instead of verbatim same-id is user-invisible but byte-visible in stored rows, and the dormant path stays verbatim. Same-id-restamped is also correct and keeps double-undo dedupe by id, if we prefer it; this blueprint picks fresh-id for one rule everywhere (D-032/D-119).
3. **`sanitizeExpenses` and `normalizeModel` pass-through** of the new optional fields is load-bearing and easy to miss, so it is an explicit DoD line for S142/S143.
4. **Outbox flush skip of locally-absent days** (section 3.4) accepts that an unflushed *whole-day deletion* is not replayed after reload. No user-reachable op produces one today; if one ever ships, day deletion needs merge-level semantics first, which would be a new decision.
5. **First-snapshot marker divergence.** Expenses and budget use doc-presence while the itinerary keeps its trip-doc marker (D-049, locked), so two mechanisms coexist. Unifying them would touch a locked, deployed handshake for zero user benefit, so it is not proposed.
6. **Emulator ceiling.** Two-client live validation of the outbox and of expense/budget sync stays deferred to live validation (section 6), the same documented manual procedure as the itinerary's, in `docs/two-phone-sync-check.md`.
7. **Nothing here weakens a locked decision.** D-038, D-039, D-018/D-091, D-055/D-120, D-088, D-042/D-103/D-106, D-032/D-119, D-097, D-026 and D-031 are each cited where the design touches them, and each holds (see sections 1.2, 2, 3.4 and 4). D-121 is superseded by design intent already recorded against S145/FU-20, and the supersession lands with S145, not before.
8. **Key-number collision note.** The technical doc section 6 sketched "favorites = key 14"; the outbox takes 14 because it builds first (S141 lands well before favorites). Numbers are documentation and strings are the contract, so favorites takes the next free number when it lands.
