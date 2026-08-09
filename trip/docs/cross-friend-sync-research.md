# Cross-friend itinerary sync — research & options (M8, design task B)

**Status: research only.** This document does not lock a decision, add a dependency, write code, or
greenlight a backend. It exists so we can pick a direction later. Building any of this would reopen
locked decisions D-002 (localStorage-only / no server) and D-004 (backend idle), and it stays out of
scope until we deliberately greenlight it.

Date: 2026-06-27

> **Free-tier numbers caveat (read first).** This was written without web access, so every quota
> figure below is from memory and is approximate. Provider free tiers change often. Re-verify the
> exact current limits of the chosen provider at greenlight time before committing to it. The
> architecture, fit, and security reasoning does not depend on the web and is the durable part.
> Treat the specific numbers as ballpark.

---

## 1. What we actually need

The ask, in plain terms: persistent memory across devices, so when a friend updates the itinerary
everyone can see it. It should be free, and each change should carry some sort of id (a name) so we
know who made it. First priority is persistence across devices; attribution comes second.

Decoded into requirements:

| # | Requirement | Notes |
|---|---|---|
| R1 | **Shared state across devices.** An edit by one friend is visible to all. | The trip is **3 travelers**; call the practical ceiling ~3–10 users. |
| R2 | **Attribution.** Every change is tagged with *who* made it (a name/id). | A self-chosen display name, not necessarily real auth. |
| R3 | **Free.** | The whole point of the study. Must fit a hobby/free tier comfortably at this scale. |
| R4 | **Propagation.** "all of us can see it": at minimum on refresh, ideally near-realtime. | Realtime is *nice-to-have*, not strictly required for 3 friends. |
| (implicit) R5 | **Keep the app deployable as it is:** static, GitHub Pages, no broken existing behavior. | This is the constraint that eliminates most "easy" answers (see section 3). |

Data volume reality check: the entire itinerary is one JSON blob, 32 `DayPlan`s and ~160
`ItineraryItem`s, on the order of **tens of KB**. Write frequency is a handful of people editing a
trip plan occasionally: dozens of writes per day at the absolute peak, not per second. This is a
*tiny* workload. Essentially every free tier on the market can hold it, so the differentiators are
**security**, **setup effort**, and **realtime**, not capacity.

---

## 2. Where we are today (the starting point a remote store must respect)

- **D-002 (locked):** itinerary persists in **browser localStorage**; no server/db by default.
- **D-004 (locked):** frontend-heavy; no server-side work unless a real server slice is greenlit.
- **D-010 (locked):** deploy is a **static export** (`output: 'export'`) to **GitHub Pages**. No SSR,
  no API routes, no middleware. This is the load-bearing constraint: the deployed artifact is pure
  static files, and there is no server process we control.
- **D-018 (locked):** persistence contract centralized in `lib/itinerary-storage.ts`
  (`loadPlans()` / `savePlans()`), distinguish by **key presence, never array length**; always write
  (including `[]`).
- **D-026 (locked):** a shared reactive store, `hooks/use-itinerary.ts` (the `ItineraryStore`)
  wrapped by `components/itinerary-provider.tsx` (Context). Same-tab liveness via a
  `window` **CustomEvent** (`itinerary:changed`); cross-tab via the `storage` event.

Two friends on two devices do not see each other's edits today, because localStorage is per-browser.
Sharing therefore necessarily introduces a shared remote store, which is exactly what D-002/D-004
forbid by default. Hence the need for an explicit greenlight.

### 2.1 The single most important architectural fact

> A purely static client deployed to GitHub Pages has nowhere to hide a secret.

Everything shipped to the browser is readable by anyone (View Source, DevTools, the public repo). So
any "API key" or "token" embedded in the client JS is **public**. That single fact splits the entire
option space into three security models:

- **(a) Designed-for-untrusted-clients.** The service expects a *public/anon* key in the client and
  enforces who-can-do-what with **server-side security rules** it evaluates. The public key is not a
  secret; it only identifies the project, and the rules are the real gate. (Firebase, Supabase.)
- **(b) Tiny serverless proxy holds the secret.** A minimal function (Cloudflare Worker, etc.)
  keeps the real token server-side; the client calls the function, the function calls the store.
  This adds a small server layer, a *soft* reopening of D-004 (it is "a backend," but a 20-line one).
- **(c) Accept token/secret exposure.** A public bin or a repo write token shipped to the client.
  Anyone who reads the page can write or wipe the data. Only acceptable for throwaway data.

Any honest recommendation has to live in (a) or (b). Option (c) is disqualifying for data we care
about (the group's trip plan), so it is called out as such below rather than left looking viable.

### 2.2 GitHub Pages can't run a server, but it can call one

D-010 forbids *us* running a server as part of this app's deploy. It does not forbid the static
client from calling **someone else's** managed service over HTTPS. That is just `fetch`, and the app
is fully client-side today with no fetches at all only because there was nothing to fetch. So:

- Option model (a), calling a managed BaaS directly from the browser with an anon key plus rules,
  keeps our deploy 100% static and adds zero server code we maintain. This is the sweet spot.
- Option model (b), a serverless function, means we *do* deploy a tiny server somewhere (not on
  Pages; e.g. Cloudflare). That is a genuine if minimal backend slice and must be greenlit as one.

---

## 3. Options matrix

Scoring legend:
- **Free fit (3–10 users, tiny JSON, low writes):** does the free tier comfortably hold this? (Yes / Yes-easily / Caveat)
- **Static-client-safe?** can the static GitHub Pages client use it with **no secret leak**? (Yes via anon+rules / No, needs proxy / No, leaks)
- **Realtime?** push updates, or poll-only?
- **Security model:** how a write is authorized without leaking a secret.
- **Setup/maintenance:** rough effort.
- **Attribution fit:** how "who did it" is modeled.

| Option | Free fit | Static-client-safe? | Realtime? | Security model | Setup / maint. | Attribution fit |
|---|---|---|---|---|---|---|
| **Firebase — Cloud Firestore** (Spark) | Yes-easily (free tier is reads/writes/storage per day; our volume is a rounding error) | **Yes** via anon/public web config + **Security Rules** | **Yes** (native `onSnapshot` listeners) | Public web config is not a secret; **Firestore Security Rules** gate read/write. Pair with **Anonymous Auth** (or Google) so rules can check `request.auth`. | **Low.** Managed console, JS SDK, no server. Rules are the only real work. | `updatedBy`/`updatedAt` fields; rules can even assert `updatedBy == auth.uid` |
| **Firebase — Realtime Database** (Spark) | Yes (free tier is concurrent connections + GB stored/downloaded; trivial here) | **Yes**, same anon config + **RTDB Rules** | **Yes** (native value listeners; RTDB is the older realtime-first DB) | Same as Firestore but a JSON-tree rules language; slightly clunkier. | **Low.** | Same field approach |
| **Supabase** (Postgres + Realtime + Auth) | Yes, **caveat**: free projects **pause after ~1 week of inactivity** (must be un-paused); fine for an active trip, annoying long-term. | **Yes** via **anon public key** + **Row-Level Security (RLS)** policies | **Yes** (Realtime subscriptions over WebSocket) | The anon key is meant to be public; **RLS policies** are the gate. Supabase Auth (incl. anonymous) gives `auth.uid()` for policies. | **Low-Med.** More concepts (SQL schema, RLS) than Firebase for one JSON blob, but very capable. | A `changes`/`items` table with `updated_by` column, or a JSON column + audit row |
| **Upstash (Redis/KV over HTTPS REST)** | Yes-easily (free tier is commands/day; tiny here) | **No, leaks** if called direct: the REST token is a **bearer secret with no per-row rules**. Safe only **behind a proxy** (model b). | Poll, or Upstash Redis pub/sub (not a browser-native push without a socket layer) | Bearer token = full access. **No security-rules layer.** Must hide token in a serverless function. | **Med** (because you must add the proxy to be safe) | App-level only (store `updatedBy` in the value); no built-in identity |
| **Cloudflare Workers + KV (or D1)** | Yes-easily (Workers free req/day; KV reads/writes/day; D1 free rows/reads, all ample) | **Yes, *by design as the proxy***. The Worker **is** model (b): it holds any secret server-side and exposes only the endpoints you allow. | Poll by default; realtime needs **Durable Objects + WebSockets** (more work, still free-ish) | **You** write the authorization in the Worker (e.g. check a shared passphrase / signed token). Secret stays in Worker env vars, never in client JS. | **Med.** You build and deploy a small Worker, the "tiny serverless layer" option. | Fully app-defined: Worker stamps/validates `updatedBy` |
| **JSONBin.io / hosted-JSON** | Yes (free tier is requests/bin size; tiny here) | **No, leaks** (direct). It needs an access key; a *master* key is full control, an *access* key still ships in client JS. Public bins = world-writable. | Poll only | Key in client = exposure; no per-field rules. Only safe behind a proxy, at which point a real KV is better. | **Low to wire, but unsafe** without a proxy | App-level `updatedBy` in the JSON; no identity |
| **GitHub repo / Gist as datastore (API)** | Yes (it's just the repo) | **No, leaks badly.** A write needs a **Personal Access Token** with repo/gist scope; shipping it to the browser hands anyone full write to your GitHub. Even a fine-grained token is a disaster in client JS. **Disqualified** for writes from a static client. Read-only public JSON is fine, but that doesn't satisfy "friends update it." | Poll only | None suitable for client-side writes. (Would need a proxy/GitHub App, which is heavy.) | High + unsafe | Could use commit author as attribution, but the write path is the blocker |
| **Liveblocks (realtime collab toolkit)** | Caveat: free tier is **monthly active users / connections**; fine for 3–10 but it's a collab platform, heavier than we need. | **Yes** (designed for clients; public key + room auth; can do auth via a token endpoint) | **Yes** (built for live presence/collab) | Public key + room-based auth; full version wants an auth endpoint (a small server) for real identity. | **Med.** SDK + concepts (rooms, storage, presence) that are overkill for one shared JSON doc. | First-class **presence/identity** (who's online, who edited), actually its strength |
| **Yjs + free WebSocket/WebRTC provider (CRDT)** | Yes (it's a library; cost is whatever signaling/transport you use) | WebRTC: peer-to-peer, **no central secret** (needs a free signaling server; data is P2P). WS: needs a host for the WS server, i.e. a server. | **Yes** (CRDT realtime) | Varies by transport; WebRTC avoids a central store but needs all peers online to converge, or a persistence peer. | **High.** CRDT + transport + persistence is a lot of machinery for a trip planner. | CRDT tracks origins; attribution possible but you build the UI |

### 3.1 Reading the matrix

- The (c) "leaks" options, meaning Upstash/JSONBin direct, GitHub token, and public bins, are off the
  table for the *real* trip data, because anyone viewing the page could overwrite or delete the
  group's plan. Upstash and Cloudflare KV become viable **only** wrapped in a serverless proxy
  (model b), and at that point Cloudflare Workers (which *is* the proxy) is the cleaner expression of
  that idea.
- The realtime-collab toolkits (Liveblocks, Yjs) are technically excellent but overkill. They solve
  concurrent multi-cursor editing with conflict-free merge, a problem 3 friends casually editing a
  trip plan do not have. They add real conceptual and dependency weight for a benefit we won't use.
  Note them as "available, not warranted."
- GitHub/Gist as a datastore is a tempting "it's free and I already have it" idea but is the worst on
  the security axis for *writes*: there is no anon-key-with-rules model, only a full-power token,
  which cannot live in a static client. Read-only it's fine, but read-only doesn't meet R1 ("friends
  update it").
- That leaves the two designed-for-untrusted-clients BaaS options, Firebase and Supabase, as the only
  ones that satisfy R1–R5 with zero server we maintain. Between them, the deciding factors are setup
  simplicity for a single shared JSON document and realtime ergonomics (section 5).

---

## 4. The attribution / "who changed what" model (on paper)

This layers on top of whichever store is chosen. It is mostly a data-model and UI question, and it is
independent of the transport.

### 4.1 Identity: "name only" vs. real auth

| Approach | What it is | Pros | Cons / abuse |
|---|---|---|---|
| **Name only** | On first use, each friend types a display name; persist it in **localStorage** (`tripPlannerUserName`); stamp it on every write. | Zero-friction, no login, no PII beyond a chosen name, no auth service to run. | **No real identity.** Anyone could type someone else's name and impersonate; nothing *enforces* the name. Fine for a private, trusted group of friends; not safe for a public link. |
| **Anonymous auth** (e.g. Firebase Anonymous / Supabase anon sign-in) | The BaaS mints a stable anonymous `uid` per device silently (no UI). Map `uid → chosen name` once. | Gives a **stable, unspoofable id** for security rules (`updatedBy == auth.uid`), still no login UI. | Slightly more setup; name is still self-chosen (display only). |
| **Real login** (Google sign-in) | Full OAuth identity. | Strong identity, real names/avatars. | Login friction + more PII; overkill for 3 friends. |

**Recommendation for a 3-person friends-only trip:** name-only for the display attribution,
optionally backed by anonymous auth for the *security id* if (and only if) the chosen store uses
auth-based rules. In plain terms: let people pick a name for the "who" label, and if we want the
rules to be airtight, also carry the anon `uid` so a rule can verify the writer. Start with
name-only; add anon-uid binding if abuse ever becomes a concern. Don't build Google login for this.

**Privacy / PII note:** keep stored identity minimal and anonymous, a self-chosen first name or
nickname only, no email, no real surname unless a friend volunteers it. This keeps any GDPR/PII
surface essentially nil (a nickname is not meaningfully personal data), which is the right posture
for a hobby project. Don't collect what you don't need.

### 4.2 Data-model additions (additive only, per D-012 / D-018)

Extend `ItineraryItem` (in `lib/trip-data.ts`) with **optional** fields. Additive, nothing existing
touched, every current item stays valid, exactly how `sourceId`/`sourceType` were added in D-027a:

```ts
// proposed additive fields on ItineraryItem (NOT applied — research only):
createdBy?: string;    // display name of whoever first added this item
updatedBy?: string;    // display name of whoever last edited it
updatedAt?: string;    // ISO timestamp of the last edit
// (createdAt? optional if we want it; updatedAt covers the common "last edited by X at Y")
```

Granularity choice: per-item attribution (above) is the right grain for this app. The UI shows items,
edits happen at the item level, and "Sushi dinner, last edited by Mei, 2h ago" is exactly the
affordance we want. A coarser per-day or whole-document `updatedBy` is simpler but loses the "who
changed *what*." A finer per-field audit log is overkill. Per-item is the sweet spot.

If a full audit trail is ever wanted ("show history"), that's a separate, heavier feature: an
append-only `changes` collection/table of `{itemId, date, action, by, at, before/after}`. Out of
scope for the first cut; the per-item `updatedBy`/`updatedAt` covers the stated need.

### 4.3 Surfacing it in the UI

- On each itinerary item (calendar + timeline): a small, muted line reading "last edited by
  {updatedBy} · {relative time}" (e.g. "by Mei · 2h ago"). Reuse the existing relative-time /
  `formatDate` helpers; honor D-020 (static Tailwind classes) and D-007 (contrast/a11y).
- Optionally a per-color or per-initial chip per friend (3 people → 3 distinguishable chips) so "who"
  is glanceable. Cosmetic; can be a later polish slice.

### 4.4 Conflict handling

For 3 friends casually editing a trip plan, the honest answer is last-write-wins (LWW) per item, not
a CRDT:

- The realistic collision is *two people editing different items*, which LWW handles trivially. Each
  item is independent; writing item A never touches item B.
- The rare collision is *two people editing the **same** item within seconds*. LWW means the later
  save wins, and `updatedBy`/`updatedAt` make it visible who that was. For this app that is
  acceptable and correct enough; nobody is co-authoring a single line in real time.
- **Per-item** (not per-document) write granularity matters. If you naively overwrite the *entire*
  itinerary blob on every save, then two people saving near-simultaneously can clobber each other's
  *unrelated* edits (a lost update across items). So the rule is: write at the item/day level (patch
  one item or one `DayPlan`), not "replace the whole array." Firestore, RTDB and Supabase all support
  sub-document writes that make this natural. This is the single most important correctness point and
  it is *cheap*: it's just choosing the write shape.
- CRDT (Yjs) is the wrong tool here. It's for conflict-free *concurrent* editing (think Google Docs).
  It would be correct but is disproportionate machinery, so bias to the simplest correct option,
  LWW per item.

### 4.5 How it layers onto the existing store without a rewrite

This is the part that makes the whole thing low-risk: the existing architecture already has the exact
seam a remote store needs. Concretely, in `hooks/use-itinerary.ts`:

- There is one write choke-point, `commit()`, that does `savePlans(next)` → `setPlans(next)` →
  `dispatchEvent('itinerary:changed')`. Every mutator (`addItem`/`updateItem`/…) goes through it.
- There is one re-read path, `reread()`, already wired to fire on the same-tab CustomEvent and the
  cross-tab `storage` event.
- Persistence is already isolated behind `lib/itinerary-storage.ts` (`loadPlans`/`savePlans`).

So a remote store slots in as "localStorage = fast offline cache; remote = source of truth" with
surgical changes and no UI rewrite:

1. **On write:** after `savePlans(next)` (keep it, it's the offline cache plus instant local echo),
   also push the change to the remote store. Best done as a per-item/per-day write (see 4.4),
   stamping `updatedBy`/`updatedAt`. The local CustomEvent still fires for instant same-tab feedback.
2. **On remote change:** subscribe once (realtime listener, or a poll) at the provider level; when
   the remote reports a change, write it into localStorage via `savePlans()` and fire the same
   `itinerary:changed` CustomEvent, which is *already* what `reread()` listens for. The entire
   existing reactive UI (calendar, dashboard, timeline, every card's `findPlacements`) updates with
   zero component changes, because to them a remote-originated change looks identical to a local one.
3. **On load:** `loadPlans()` still returns the cached copy instantly (good offline / first-paint
   behavior, D-018 unchanged); the remote subscription then reconciles to the latest shared state.

In other words: the remote layer wraps `loadPlans`/`savePlans` and reuses the existing CustomEvent as
the "data changed" signal. D-018 (key-presence, never length-gate) and D-026 (Context + CustomEvent)
are preserved, not replaced. The cleanest implementation point is a new module (e.g.
`lib/itinerary-remote.ts`) that the provider wires in beside `use-itinerary.ts`, so the store's public
`ItineraryStore` API to components is unchanged.

> This is why the effort is *bounded*: the hard architectural work is already done in D-026 (one
> store, one event). Remote sync is "fan the existing event out over the network," not a re-plumb.

---

## 5. Recommendation

### #1 — Cloud Firestore (Firebase Spark free tier) + Anonymous Auth, called directly from the static client

Why it wins on every axis that matters here:

- **Free fit (R3):** our workload (tens of KB, dozens of writes/day, 3–10 users) is orders of
  magnitude under the Spark free tier. (Re-verify exact daily read/write/storage caps at greenlight,
  but there is no realistic way 3 friends exceed them.)
- **Static-client-safe with no secret leak (R5, see 2.1):** Firebase is designed for untrusted
  clients. The web config shipped in the client is not a secret; it only names the project. Firestore
  Security Rules, evaluated server-side by Google, are the real gate. This is the one model where "a
  public key in the static GitHub Pages bundle" is correct by design, so we keep the deploy 100%
  static and add zero server code we maintain. D-010 stays intact, and D-004's reopening is minimal:
  we consume a managed service, we don't run one.
- **Realtime (R4):** `onSnapshot` gives true push updates out of the box, so friend A's edit appears
  on friend B's screen in about a second, with no polling to build. This maps perfectly onto 4.5: the
  snapshot listener calls `savePlans()` and fires `itinerary:changed`, and the existing UI just
  updates.
- **Attribution (R2):** trivial, via `updatedBy`/`updatedAt` fields. Because Anonymous Auth gives a
  stable `uid` with no login UI, a Security Rule can even *enforce* `updatedBy == request.auth.uid`
  if we later want anti-impersonation. Start with name-only display; the auth id is there if needed.
- **Setup/maintenance (effort):** lowest of the credible options. A console project, the JS SDK, and
  a short rules file. No SQL schema, no proxy, no Worker to deploy and keep alive, no project that
  pauses on inactivity.
- **Conflict handling (4.4):** Firestore's per-field/per-doc writes make per-item LWW the natural
  default, exactly the simplest-correct strategy for this app.

The honest downsides, stated plainly:

- It's a Google/Firebase dependency and reopens D-002/D-004, since a remote store now exists. That is
  inherent to "sync across friends": there is no zero-backend way to share state, and this is the
  *least* backend.
- Security rules are the thing to get right. A wrong rule is the difference between "friends can
  edit" and "the public can wipe it." This is a small, well-trodden file, but it is not optional and
  must be reviewed. (For a private friends group, a defensible starting rule is "any authenticated
  [anonymous] user may read/write this trip doc," optionally tightened to a known set of uids or a
  shared passphrase claim.)
- Firestore has its own data-modeling idioms (documents/collections). For one shared itinerary that's
  simple (one trip document, or a collection of day/item docs), but it's a *slightly* different shape
  than our flat `DayPlan[]`, so a thin mapping layer in `lib/itinerary-remote.ts` handles it.

### Runner-up — Supabase (Postgres + Realtime + Row-Level Security), anon key direct

Same fundamental shape and the same big win: an anon public key plus server-evaluated RLS policies,
so it is static-client-safe with no secret leak and needs no proxy. It also has realtime and
anonymous auth. It ranks #2 only because, for *this* tiny single-JSON use case, it carries more
moving parts (a SQL schema plus RLS policies vs. Firestore's rules plus a document), and its free
projects pause after about a week of inactivity. That's a non-issue during the active trip but a
long-term papercut for a portfolio piece that sits idle. If we prefer Postgres/SQL or want relational
room to grow, Supabase is the better long-term home and is a completely defensible #1 instead.

**Explicitly not recommended for the real data:** direct Upstash/JSONBin/public-bin (secret leak, so
anyone can wipe it), and GitHub/Gist-as-DB for writes (a full-power token cannot live in a static
client). Cloudflare Workers + KV is a fine choice **if** we specifically want to own a tiny serverless
proxy (model b). It's the cleanest proxy expression, but it means deploying and maintaining a Worker,
i.e. a real (if small) backend slice, which is strictly more than the zero-server Firebase/Supabase
path. Liveblocks and Yjs are capable but overkill for 3 friends who aren't co-editing a single field
in real time.

### Decision driver, in one line

Pick the model where a public key in the static bundle is safe by design (Firebase or Supabase),
because our app physically cannot keep a secret, and prefer Firestore for least setup and best
realtime ergonomics for one shared JSON document.

---

## 6. "What it would take" — sketch for the #1 pick (Firestore)

This is a future, greenlit-only effort. It reopens D-002 and D-004 and is out of scope until we
greenlight it. Nothing here is started.

### 6.1 The pieces

1. **Firebase project** (console; free Spark plan). One Firestore database.
2. **Web config** (public, fine to ship): added to the client. *Note:* under D-010 static export,
   this is just constants in the bundle; if any value is ever treated as build-time config, route it
   through the existing single-source env pattern (cf. how `NEXT_PUBLIC_BASE_PATH` is handled), but
   the Firebase web config is public by design so this is low-stakes.
3. **Anonymous Auth** enabled (silent; no login UI). Map `uid → chosen display name` (name stored in
   localStorage + optionally a `members` doc).
4. **New module `lib/itinerary-remote.ts`**, the only new architectural surface. It:
   - subscribes to the trip document/collection (`onSnapshot`) and, on change, calls `savePlans()` +
     dispatches the existing `itinerary:changed` CustomEvent, so the whole reactive UI updates with
     no component edits (see 4.5);
   - exposes per-item/per-day push functions the store's `commit()` calls *after* its local
     `savePlans()` (offline cache + instant echo preserved).
5. **`itinerary-provider.tsx`** wires the subscription up once at app root (it already instantiates
   the store once, so it's the natural home). The `ItineraryStore` API exposed to components is
   unchanged.
6. **Security Rules file**, the real authorization. Minimal first cut: authenticated (anonymous)
   users may read/write the single trip doc; tighten later to a known uid set or a shared-secret
   claim if abuse appears.

### 6.2 New data fields (additive, see 4.2)

`createdBy?`, `updatedBy?`, `updatedAt?` on `ItineraryItem` (optional, per D-012). Plus a tiny
identity store (chosen name in localStorage; optional `members/{uid}` doc mapping uid→name).

### 6.3 Security-rules shape (illustrative, re-verify syntax at build)

```
// Firestore rules — ILLUSTRATIVE, not final:
match /trips/{tripId} {
  // any signed-in (anonymous) user in the group can read/write this trip.
  allow read, write: if request.auth != null;
  // optional hardening: && request.auth.uid in ['<uid1>','<uid2>','<uid3>']
  // optional attribution integrity: on item writes, require updatedBy set.
}
```

The point is just to show the gate lives server-side in rules, not in client JS. That's what makes a
public web config safe.

### 6.4 Approximate slice breakdown (sequence shown for sizing; it would be re-cut when planned)

1. **B-1 — Decision + spike.** Greenlight; record the decision (reopening D-002/D-004 deliberately,
   scoped to the trip itinerary only); a throwaway spike proves anon-auth + one read/write + one
   snapshot from the static build.
2. **B-2 — Remote module + provider wiring (read path).** `lib/itinerary-remote.ts` subscribes and
   feeds `savePlans()` + CustomEvent; app shows shared state on load and updates live on remote
   change. No write path yet (remote is a read-only mirror), provable in isolation.
3. **B-3 — Write path (per-item).** `commit()` pushes per-item/day writes after the local save;
   two devices converge; LWW per item verified (edit different items → both survive; edit same item →
   later wins).
4. **B-4 — Identity + attribution.** Name-on-first-use; stamp `createdBy`/`updatedBy`/`updatedAt`;
   surface "last edited by X · time" in calendar + timeline.
5. **B-5 — Security-rules hardening + offline/edge cases.** Lock rules to the group; handle
   offline→online reconciliation, the empty-itinerary (`[]`) case under D-018, and quota/error
   fallbacks (degrade to local-only so the app never breaks if Firebase is unreachable).
6. **B-6 — Acceptance.** Two real browsers/devices: A edits → B sees it (live + after reload);
   attribution correct; no console errors; existing single-user persistence (D-018) still passes;
   static `next build` still green; basePath build unaffected.

Each slice stays small and independently reviewable.

### 6.5 Risks to accept (explicit)

- **Reopens D-002/D-004** by definition, since a shared remote store now exists. Scope it tightly: it
  syncs only the itinerary, and the rest of the app stays local/static.
- **Security rules are load-bearing.** A misconfigured rule exposes write/delete to the public. They
  must be reviewed; start strict.
- **Vendor dependency + free-tier drift.** Firebase free limits and policies can change, so the app
  must degrade to local-only if remote is unavailable. That way it never hard-breaks, and the
  portfolio demo works even if a free project is later paused or limited.
- **No real identity by default.** Name-only is spoofable within the group; acceptable for trusted
  friends, *not* for a public link. Anon-uid binding is the upgrade path if needed.
- **Free numbers are approximate.** Re-verify at greenlight (stated up top).

---

## 7. One-paragraph summary

We want friends to share one itinerary and see who changed what, for free, on an app that's currently
a static GitHub Pages site with no server. The catch is that a static site can't hide a secret, so the
only safe free options are services *built* for untrusted clients, where a public key in the page is
fine because server-side rules decide who can write. The pick is Firebase Cloud Firestore (free Spark
tier) with silent anonymous sign-in: it's realtime out of the box, needs no server of our own, slots
cleanly into the store we already built (we just fan our existing "data changed" event out over the
network), and makes "last edited by Mei · 2h ago" trivial. Supabase is a close, equally safe
runner-up, better if we prefer SQL, with the minor catch that free projects pause when idle. For
conflicts, plain last-write-wins per item is the right, simple call for three friends. Storing only a
self-chosen first name keeps privacy a non-issue. None of this is built or decided: it reopens our
"no backend" decisions, so it waits for an explicit go-ahead.
