# Photo storage blueprint: `BlobStorePort` over IndexedDB (S159)

_Design doc for M17 Phase 4 (photo track, D-130 G2). It makes `V4-DEVPLAN.md` item #7b concrete and buildable. Source read: `core/storage/gateway.ts`, `core/vault/export-import.ts`, `core/budget/expenses.ts`, `hooks/use-journal.ts`, `hooks/use-expenses.ts`, `docs/sync-everywhere-blueprint.md`, and DECISIONS D-130/D-002/D-038/D-088/D-098/D-150. No production code lands in this slice: this document plus the proposed DECISIONS entries are the whole output (next free decision number is D-159)._

---

## 0. Scope and the one sentence per slice

| Slice | Builds | From this doc |
|---|---|---|
| S160 (before Dec 9, 2026) | Capture/attach photos on journal days + expense receipts; downscale pipeline; quota UX; egress proof | Sections 2 to 6 |
| S161 (by Jan 9, 2027) | `/recap` story mode gains per-day photos; renders with and without | Section 3.2 (day-keyed photos make this a read-only join) |

Everything below serves one invariant (D-130/D-002-amended/D-038). Photo blob bytes exist in exactly one place, this device's IndexedDB, and they have no *network* egress path: no Firestore, no `SyncPort`, no dormant remote layer.

> **Later widened by D-227 (S273).** The full-trip backup lifeboat (`core/vault/backup.ts`) does carry photo bytes — the meta index plus each present blob inlined as a base64 data URL (`exportTripBackup`, iterating the active trip's meta ids, never `blobStore.list()`) — but only into a file the user explicitly downloads to their own device, from a surface whose own copy names photos (`components/backup-restore.tsx`: "Backed up your whole trip (including journal and photos)"). D-227 records this as exercising D-159's own pre-authorised "explicit user-initiated export of a separate photo bundle, never the default export, never sync" clause — not a network egress. The D-098 itinerary Vault export (`exportItinerary()` in `core/vault/export-import.ts`) still excludes photos entirely (section 7).

---

## 1. Topology: the metadata ↔ blob split, and where the photo↔owner link lives

Three layers, each in its native store:

```
┌ UI (S160) ────────────────────────────────────────────────────────────────┐
│  journal card / expense row / recap day  →  <img src=objectURL>            │
└──────────────┬───────────────────────────────────────┬────────────────────┘
               │ PhotoMeta[] (small JSON)               │ Blob bytes
               ▼                                        ▼
   localStorage gateway KEY 16                IndexedDB via BlobStorePort
   `nepal_japan_photos`                       db `nepal_japan_photos` / store `blobs`
   (captions, alt, dims, owner ref)           (downscaled JPEG blobs, keyed by photo id)
               │                                        │
               ✗ NOT in the Vault export      ✗ NOT in the gateway, NOT in any SyncPort
               ✗ NOT on any synced doc        ✗ NO network path exists to it
```

Photo references do not live on `Expense` or `JournalEntry` rows. The link lives only in the local metadata index (key 16), as an `owner` ref on each `PhotoMeta`. The alternative, an additive `photoIds?: string[]` on the row, was rejected because:

1. **Expenses sync (S142).** A `photoIds` field on the row would ride `mergeItems` into the shared Firestore chunk docs. The ids are opaque strings (no bytes), but every other device would then render dangling receipt indicators for blobs it can never have, and the sanitize/merge/strip surfaces (`sanitizeExpense` passthrough, `restoreExpense`'s strip list, the push payload) would all grow a photo concern. With the separate index, no photo data of any kind enters any synced or Vault shape, so the egress guarantee is structural rather than a sanitizer's promise. (`sanitizeExpense` builds a fresh object from an explicit allowlist, so the "sanitize-passthrough" requirement is satisfied vacuously: there is nothing to pass through.)
2. **Zero schema change.** No Zod edit, no journal/expense model edit, no Vault version bump, no migration. That is stronger than the S98 additive-field precedent: additive-*elsewhere*.
3. **One home for photo truth.** Caption/alt/dims need a metadata record regardless; putting ids on rows would split photo state across two homes.

Accepted costs, stated explicitly: a receipt is visible only on the capturing device (which D-002-amended mandates anyway), and the sync-on fresh-ID expense undo needs a one-line re-point (section 3.3).

---

## 2. `BlobStorePort`: the contract and the IndexedDB default

### 2.1 Port (new file `core/photos/blob-store.ts`, pure TS, framework-free)

```ts
/** Result of storing a blob — total, never throws (house style: ImportResult / gateway never-throw). */
export type PutResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'quota' | 'unavailable' };

export interface BlobStorePort {
  /** Store a (already-downscaled) blob; mints and returns the photo id. */
  put(blob: Blob): Promise<PutResult>;
  /** The blob, or null: absent, EVICTED, SSR, or IndexedDB unavailable. Never rejects. */
  get(id: string): Promise<Blob | null>;
  /** Idempotent; resolves even if absent/unavailable. Never rejects. */
  delete(id: string): Promise<void>;
  /** Stored ids (source of truth for what survived eviction). [] on unavailable. */
  list(): Promise<string[]>;
  /** Rough footprint for the storage UI. Zeros on unavailable. */
  usage(): Promise<{ count: number; bytes: number }>;
}
```

Why a port: it is the same seam pattern as `StoragePort`/`SyncPort` in `docs/sync-everywhere-blueprint.md`. IndexedDB is async and absent from jsdom, so unit tests use a trivial in-memory `Map<string, Blob>` fake instead of adding a `fake-indexeddb` dev dependency (D-088/free-tools: no new dep, dev or otherwise). The fake is ~15 lines and lives next to the tests.

Every method is total: SSR, `indexedDB === undefined`, privacy mode, and a rejected open all degrade to the `unavailable`/`null`/no-op path, mirroring the gateway's never-throw discipline. `put` is the one operation whose failure the user has to see, hence the result type rather than a silent no-op.

### 2.2 IndexedDB implementation shape (default impl, same file or `blob-store-idb.ts`)

- **Database:** `nepal_japan_photos`, version 1. `onupgradeneeded` calls `db.createObjectStore('blobs')`: a single object store with out-of-line string keys (the photo id), values are raw `Blob`s (structured-clone stores Blobs natively, so no base64 and no ArrayBuffer copies).
- **Key/id scheme:** `ph-${Date.now().toString(36)}-${random 6}`, the same mint pattern as `generateExpenseId` (`exp-…`), minted inside `put` so the store is the single id authority.
- **No indexes.** `list()` = `getAllKeys()`; `usage()` = `getAll()` summing `blob.size`. At trip scale (a few hundred rows at most) a full scan is fine. `navigator.storage.estimate()` is origin-wide rather than photo-specific, so it supplements this but does not replace it.
- **Versioning:** future shape changes bump the DB version and migrate in `onupgradeneeded`, the IDB-native analogue of the Vault migration runner. v1 needs nothing.
- Open lazily on first call, cache the connection promise, and treat `onblocked`/open-rejection as `unavailable`.

Native `indexedDB` API only. The wrapper the app needs (open plus five methods, promisified) is ~80 lines; a library (`idb`) is prohibited-by-default (D-088) and unnecessary at this surface area.

---

## 3. Metadata: model, gateway key 16, attach semantics

### 3.1 `PhotoMeta` (new file `core/photos/model.ts`, pure + total, mirrors `core/budget/expenses.ts` style)

```ts
export type PhotoOwner =
  | { kind: 'journal'; date: string }        // 'YYYY-MM-DD' trip day — DAY-keyed, not entry-keyed
  | { kind: 'expense'; expenseId: string };  // Expense.id on THIS device

export interface PhotoMeta {
  id: string;          // the BlobStorePort id ('ph-…')
  owner: PhotoOwner;
  altText: string;     // a11y — prompted at capture; falls back to caption or 'Trip photo, <date>'
  caption?: string;    // optional user caption
  w: number;           // stored (post-downscale) pixel dimensions
  h: number;
  bytes: number;       // stored blob size (feeds the storage/usage UI without opening IDB)
  createdAt: string;   // ISO
}
```

Persisted as `PhotoMeta[]` JSON. `sanitizePhoto`/`sanitizePhotos` follow `sanitizeExpense` exactly: drop rows with no salvageable `id`/`owner`; degrade `w`/`h`/`bytes` to 0; a missing `altText` degrades to `caption ?? ''` rather than dropping the row, because a11y text is repairable and identity is not. Total, never throws.

### 3.2 Gateway key 16 (the only gateway change)

A new `STORAGE_KEYS` entry plus accessor in `core/storage/gateway.ts`, byte-transport-only, mirroring `journalStore`/`favoritesStore` verbatim:

```ts
/** localStorage — JSON `PhotoMeta[]` photo-metadata index (photos, key 16; S160, D-159).
 *  METADATA ONLY — blob bytes live in IndexedDB behind `BlobStorePort`, NEVER in web storage.
 *  Local-only (D-002-amended/D-130): NOT part of the itinerary Vault, NOT part of any sync path.
 *  Value shape owned by `core/photos/model.ts`. ADDITIVE: brand-new key, no migration. */
photos: 'nepal_japan_photos',
```

```ts
export const photosStore = {
  get<T>(fallback: T): T { return readJson<T>('local', STORAGE_KEYS.photos, fallback); },
  set<T>(metas: T): void { writeJson('local', STORAGE_KEYS.photos, metas); },
} as const;
```

Reactivity: `use-photos.ts` wires `createReactiveStore` (event `'photos:changed'`, storage key 16, no `sync` port), exactly the journal instantiation. Blobs themselves are not reactive: the UI resolves `get(id)` → `URL.createObjectURL` per render-mount and revokes on unmount.

Why 16 is right under D-150 discipline: key 15 (`nepal_japan_sync_outbox`) is the last taken, and 6 is retired-not-reusable (D-154). Metadata is small JSON (a few hundred bytes per photo, so ~100 photos ≈ 20–30 KB, well inside localStorage), so it belongs in the gateway. The bytes do not: a single photo would exhaust the ~5 MB localStorage budget and violate the gateway's synchronous, small-value charter.

### 3.3 Attach semantics

- Journal photos attach to the date, not the entry: `owner: { kind:'journal', date }`. A day can have photos with or without a text entry, deleting or re-creating the day's entry never orphans or resurrects anything, and S161's recap gets "per-day photos, renders with and without" as a pure filter (`photos.filter(p => p.owner.kind==='journal' && p.owner.date === day)`) with zero further schema work.
- Expense photos attach by `expenseId`. The expense row itself is untouched (see section 1). A tombstoned or deleted expense hides its receipt with it: the row is gone from the UI, the metadata stays put, bounded at trip scale (see the budget in section 5).
- The one sync-adjacent edge, and an S160 obligation: under sync, `restoreExpense` re-adds as a fresh-ID copy (D-032/D-119), which would strand a receipt pointed at the old id. S160 makes `restoreExpense` return the minted id (`void` → `string`, additive) and the Undo caller re-points the matching `PhotoMeta.owner.expenseId` old to new. That is a local key-16 write, nothing near the sync path. Dormant undo restores the same id, so it re-attaches for free.
- An explicit user delete of a photo is `blobStore.delete(id)` plus removing its meta from key 16. Blob first: a meta without a blob is a placeholder, a blob without meta is invisible, so delete in the order that fails safe.
- Orphan GC is skipped. Orphans arise only from deleted expenses, bounded to a handful × ~300 KB against a ~40 MB budget. `usage()` keeps it observable; add a sweep only if real usage shows accumulation.

---

## 4. Capture pipeline: Canvas downscale policy (the numbers)

New `core/photos/downscale.ts` (browser-facing, framework-free): `preparePhoto(file: File | Blob) → Promise<{ ok:true; blob: Blob; w: number; h: number } | { ok:false; reason:'decode' }>`, with the policy numbers exported as `MAX_EDGE = 1600` and `JPEG_QUALITY = 0.8`.

| Parameter | Value | Rationale |
|---|---|---|
| Max long edge | **1600 px** | Retina-sharp at every in-app surface (cards, recap hero ≈ ≤800 CSS px ⇒ ≤1600 device px); 4× smaller area than a 12 MP original |
| Format | **JPEG** (`image/jpeg`) | Photos/receipts, no alpha; universal `toBlob` encoder |
| Quality | **0.8** | The visually-transparent knee for photographic content |
| Result size | **~150–450 KB** typical (vs 3–6 MB off a phone) | 1600×1200 @ q0.8 |
| Upscale | never; images already ≤1600 px re-encode at q0.8 only | |

The pipeline is all browser-native (D-088, no dep). `createImageBitmap(file, { imageOrientation: 'from-image' })` bakes EXIF rotation in, so a receipt shot in portrait stays portrait; then draw scaled onto an offscreen `<canvas>`; then `canvas.toBlob('image/jpeg', 0.8)`. A decode failure (exotic or corrupt format) returns `{ ok:false, reason:'decode' }`, the user sees "couldn't read that image", and nothing is stored. Input is `<input type="file" accept="image/*" capture="environment">`, and the `accept` also makes iOS transcode HEIC to JPEG before the app ever sees it. Downscale always runs before `put`, so original full-size bytes are never written anywhere.

---

## 5. Quota and eviction: budget and fallback policy

Budget math: 100 photos × ~400 KB ≈ **40 MB**; a heavy 300-photo trip ≈ 120 MB. Chromium origin quota is typically several GB (≤60% of free disk), Firefox up to 10 GB/origin, Safari ≈ 1 GB before prompting, so the design sits one to two orders of magnitude under every floor. Metadata (~250 B/photo ⇒ ≤75 KB at 300 photos) is negligible in localStorage. There is no hard photo cap; quota handling below is the guard, and `usage()` plus summed `PhotoMeta.bytes` feed a visible storage line in the photo UI.

`QuotaExceededError` (write time): the IDB impl catches it, and any write `DOMException`, inside `put` and returns `{ ok:false, reason:'quota' }`. S160 then shows a non-destructive "Device photo storage is full — photo not saved" state. The journal entry or expense saves normally without the photo; nothing crashes and nothing is half-written (single-blob transaction).

Eviction (read time): IndexedDB is best-effort storage, and the browser may evict the origin under disk pressure. Mitigation and degradation:
- On first successful `put`, call `navigator.storage.persist()` once (best-effort, free, no dep). Chromium usually grants silently for engaged origins, and denial is fine because it only changes eviction odds.
- Metadata (localStorage) may outlive an evicted blob: `get(id)` returns `null` and the UI renders a placeholder tile ("photo no longer on this device") still showing `altText`/`caption`, so the words survive even when the pixels don't. Metadata is not auto-deleted on a null `get`; the user can remove the tile explicitly.
- Whole-store unavailability (privacy mode, disabled IDB) reads as every-get-null plus `put` `unavailable`, and the capture button surfaces "photos aren't available in this browser mode". Never a crash, because the port is total (section 2.1).

---

## 6. Privacy and egress: the invariant and S160's proof obligations

Invariant (proposed D-159, the D-038-strict instance): photo blob bytes never leave the device. No Firestore write, no network request carrying blob data, no presence in the Vault JSON export, and no dormant or disabled remote code path existing at all.

Why it holds by construction: blobs live only behind `BlobStorePort`, whose two implementations (IDB, in-memory fake) contain zero network code. The only network-writing modules remain the Firestore sync layer, whose payloads are built from `Expense`/`BudgetModel`/`DayPlan` shapes that contain no photo field (section 1), and the keyless weather fetch. `exportItinerary()` serializes `loadPlans()` only (section 7). There is no code path from a blob to a socket.

S160 definition of done. "Proven" means these checks actually run and pass:
1. **Sync-payload assertion (Vitest):** create an expense, attach a photo via the fake port, capture what `expensesSyncPort.push` would send (or run `sanitizeExpense` and the chunk serializer over the row), then assert the payload contains no `ph-` id, no `photo` key, and no blob or base64 content. With the design in section 1 this asserts the field cannot even exist, which is cheap and permanent.
2. **Network assertion (Playwright, headless QA environment):** intercept every request (`page.route('**/*')`) during a full photo capture-and-render flow on the served `out/` build; assert no request URL or body contains the photo id and no body is at least the blob's size. In the dormant build, assert zero non-allowlisted requests at all during capture.
3. **Export assertion (Vitest):** seed journal + expense photos, run `exportItinerary()`, assert the output string contains no `ph-` id, no `nepal_japan_photos` content, and no `data:image`/base64 payload.
4. **Grep gate:** no `indexedDB` reference outside `core/photos/**` (plus tests), mirroring the S91 storage-literal grep discipline.

---

## 7. Export / import behavior (D-098)

The **D-098 itinerary Vault export** excludes photos entirely, by construction and with zero code change. `exportItinerary()` serializes the itinerary Vault only (D-098 v1 scope: "identity/token/prefs are device-soft… neither exported nor touched"); key 16 and the IDB store are outside the Vault, and itinerary rows carry no photo fields (section 1). Not even metadata is exported: captions and alt text are device-soft companion data like the journal, and a metadata-only export would invite a future "and now the bytes" creep across the D-159 line. No Vault version bump, no envelope change. The separate full-trip backup added later by D-227 (`core/vault/backup.ts`, a distinctly-labelled "Back up whole trip" surface producing `nepal-japan-trip-backup.json.gz`, or `.json` where `CompressionStream` is absent) *does* include photo meta and bytes — see the note in section 0. `core/vault/export-import.ts` itself is untouched by it.

Import onto a fresh device is graceful by construction. Import validates and writes itinerary plans only; it neither reads nor writes key 16 or IndexedDB. Nothing dangles, because no imported shape references a photo. The absent metadata index reads as `[]` (gateway fallback), and day/expense photo rails simply render their empty states. The consequence is documented and accepted, and D-002 mandates it for the *itinerary import* path: `importItinerary()` carries no photos, so restoring only the Vault on a new device leaves the photo rails empty. **Since D-227 (S273) that is no longer the whole story** — the separate full-trip backup (`core/vault/backup.ts` → `nepal-japan-trip-backup.json.gz`, or `.json` where `CompressionStream` is absent) does move photo bytes to a new device: `importTripBackup` writes blobs first via id-preserving `putWithId` so the meta↔blob links survive, then the meta index. A device wipe with no backup file still loses them. That is the price of "no *network* egress path", stated rather than papered over. The placeholder-tile machinery in section 5 covers every "referenced but absent" render, and import CAN now produce that state: a blob that fails to store, or a meta whose blob was never in the file, leaves the meta as a placeholder and increments `photosSkipped` (surfaced to the user as "N photos could not be restored").

---

## 8. Proposed DECISIONS entries

**D-159 · propose LOCKED · Photos are device-local IndexedDB blobs, local-only forever, zero egress**
Photo blobs (journal photos, expense receipts) live only in this device's IndexedDB behind `BlobStorePort`; photo metadata (JSON) lives in localStorage gateway key 16 (`nepal_japan_photos`). Photos never sync, never appear in any Firestore doc, and are excluded, bytes and metadata alike, from the D-098 Vault export. No photo field exists on any synced or Vault schema: the photo↔owner link lives only in the local index. No remote or dormant photo layer may be designed or built. Rationale: the D-130 G2 charter, the D-002 amendment, D-038-strict privacy, D-088 free-by-construction. Would change only if the D-002 photo scope is explicitly reopened.

**D-160 · propose recorded · Photo pipeline policy: port shape, downscale numbers, quota/eviction behavior**
`BlobStorePort` is total and never-reject with a result-typed `put` (section 2.1). The default impl is native IndexedDB (db `nepal_japan_photos` v1, single `blobs` store, out-of-line `ph-…` string keys). Unit tests use an in-memory fake, so no `fake-indexeddb` or `idb` dependency (D-088). Capture downscales via `createImageBitmap` + Canvas to long edge ≤1600 px, JPEG q0.8, before any write. `QuotaExceededError` surfaces a user-visible non-destructive "storage full"; `navigator.storage.persist()` is requested once, best-effort; an evicted blob renders as a metadata-preserving placeholder, so alt text and caption survive. Journal photos are keyed by trip date (day photos), expense photos by expense id; the sync-on fresh-ID expense undo re-points the owner ref, with `restoreExpense` returning the minted id. Would change if measured photo sizes blow the ~40 MB per 100 photos budget or a surface needs more than 1600 px.

---

## 9. Build checklists

**S160 (before Dec 9):** `core/photos/model.ts` (PhotoMeta + sanitize) · `core/photos/blob-store.ts` (+ IDB impl) · gateway key 16 + `photosStore` · `use-photos.ts` via `createReactiveStore` (no sync port) · `core/photos/downscale.ts` downscale · capture UI on journal card + expense row (alt/caption prompt, `accept="image/*"`) · quota/unavailable/evicted states · `restoreExpense` returns minted id + Undo re-point · the four proof checks from section 6, actually run.
**S161 (by Jan 9, 2027):** recap day sections read `use-photos` filtered by `owner.date`; render with and without photos; placeholder tiles for evicted blobs; reduced-motion-safe presentation. No new storage surface.
