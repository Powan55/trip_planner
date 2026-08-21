# Releases

Every live deployment gets an entry: version, date, what shipped, deploy targets. Newest first.

Not every entry is live. An entry headed **NOT DEPLOYED** is a build that exists in the repo and has never run anywhere, and **LIVE** on an older entry means that version was in production while it was current, not that it still is. The newest live app is `v6.0.0`, deployed 2026-08-20. The newest live worker is `v1.8.1`, shipped 2026-08-17. Worker `v1.9.0` is built and must now **never** deploy: `v1.10.0` supersedes it, and shipping `v1.9.0` alone would break the concierge on the built-in sample pack. Neither is deployable as it stands — read the worker note under `v6.0.2` before touching either. Read the heading before assuming a version is in production.

**`v6.0.0` shipped on 2026-08-20.** Tag `v6.0.0` is `0ecb444`, that commit is `origin/main`'s head, and its deploy run (`32371000388`) succeeded — verified against the tag and the run, not against this paragraph. `v6.0.1` and `v6.0.2` are both recorded below and neither is deployed. Check the tag, not the topmost heading: this file gains an entry when a version is prepared, not when it ships. `v5.14.1` never shipped standalone either: like `v5.13.0` inside `v5.14.0`, its workflow changes rode inside `v5.14.2` when that deployed. **`v5.15.0` is the same case** — it was prepared, never tagged, and its contents shipped inside `v6.0.0`. Its entry is kept below because the detail in it is the record of that work; it is not a version that will ever exist on its own.

> **This paragraph was wrong for two days, which is why the sentence above says to check the tag.** It claimed `v5.14.4` was "recorded below and not yet deployed" and that `main` was at `v5.14.3`. Both were false: tag `v5.14.4` is commit `203cfc0`, that commit **is** `origin/main`'s head, `origin/main`'s `package.json` reads `5.14.4`, and its deploy run succeeded on 2026-08-14. The doc has now overstated what is live twice (`v5.14.0` was claimed about an hour early). The failure mode is always the same: this heading is edited when a release is *prepared* and nobody comes back to it when the release *ships*. Verify against `git tag` and the deploy run, never against this paragraph.

> After any merge intended for users, verify the deployment with `git ls-remote` plus a grep of the live artifact for a string only the new code contains. A push succeeding is not the same as the served artifact changing, and only the second half catches a push that targeted the wrong commit. (Lesson of `v5.9.2`: for 40 minutes a merged, green build was assumed live while the mirror had actually been pushed from an earlier commit.)

---

## v6.0.2 (app) · 2026-08-20 · worker unchanged at v1.8.1

The concierge answered every message on the default Nepal × Japan trip with "The concierge works
on your own trips — open one of your trips to chat." That is the trip a browser lands on before
anyone creates or joins one, so for a first-time visitor the assistant was dead on arrival. This
release deletes that refusal.

- The refusal was the CLIENT half of a server gate that never deployed. `#10` moved the Worker
  from token possession to Firestore membership and added a matching client-side check, keyed on
  `isRemoteConfigured()`; the Worker half is `v1.9.0`, which is still held (see the worker note at the end of this entry),
  so `v6.0.0` shipped a refusal with nothing behind it. Probed live before changing anything:
  `GET /resolve` with **no** `Authorization` header at all answers `400 unsupported url`, so the
  deployed Worker never asks who is calling.
- Nothing about the sample trip needed protecting. Its digest is the built-in pack, it has no
  Firestore document, and it never syncs — `getTripId()` returns `''` for it by construction.
- The other guard stays exactly as it was: a trip id the registry does not know is still refused
  before a digest is built, because that digest would read whatever sits under that pointer's
  storage namespace.
- `GET /resolve` (Import a place → Look up) was never gated client-side and so was never broken by
  this. It is untouched here.

**Worker note — nothing here deploys the Worker, and right now nothing should.** Two things are
true at once and they have to be read together.

`v1.9.0`'s membership check asks Firestore whether the caller is a member of `trips/<id>`, and the
sample pack has no such document by design — so for that one pack it can only answer no. Deploying
`v1.9.0` alone therefore puts the defect above straight back, as a raw `403` instead of a sentence.
`v1.10.0` is written and tested for exactly that: a `SAMPLE_TRIP_ID` var routes that one id through
a signed-in check (`accounts:lookup`), leaving every other trip on the membership path unchanged.
125 worker tests pass.

But `v1.10.0` is **not deployable as it stands**, and this is the part to not skip. The worker
source has forked into two trees. The one that is live at `v1.8.1` carries the `[[ratelimits]]`
binding and `[observability]`; the one `v1.9.0`/`v1.10.0` were built in carries the membership
gate and no limiter. `wrangler deploy` replaces the whole worker config, and the limiter fails open
by design (D-338), so pushing `v1.10.0` from that tree would delete the rate limit without turning
anything red. What would replace the limiter as the floor is a Firebase anonymous session, which
any visitor mints for free and a script mints in bulk. Be precise about the direction here: against
what is live, `v1.10.0` actually *narrows* auth, because live `v1.8.1` asks for no bearer at all.
The loss is the limiter, and the limiter is the only thing bounding that abuse today — on free
tiers, with no rollback.

Reconcile the two worker lines first, so that whatever deploys next is a true superset of live
`v1.8.1` — limiter included. Until that lands, deploy neither. **D-371** records the access
decision and why the allowance and the limiter are one call, not two.

---

## v1.8.1 (worker) — 2026-08-17 · **LIVE**

A rate limit on the concierge Worker, which had none at all before this. Worker-only: the app did not deploy, `trip/package.json` stays at `6.0.0`, and `main` is still at `v5.14.4`. This is the one carve-out from the hold recorded on the entry below (approved 2026-08-17), because the Worker is a separate service on its own version line and a deploy of it touches neither `main` nor the app bundle.

- The Worker had no rate limiting of any kind. Its URL ships inlined in the public Pages bundle by construction (`NEXT_PUBLIC_*`) and is committed in the clear in this repo, and the trip-token gate has nothing to check a token against (D-221), so any non-empty string passes it. Two headers was the whole recipe for unlimited LLM calls.
- The cost was availability, not money: free tiers only, no card on file. Groq's daily cap dies first and every concierge turn starts returning 502; then Cloudflare's 100k requests/day takes both routes dark. Nobody gets a bill, the app just stops answering.
- What shipped is a first-class `[[ratelimits]]` binding at 60 requests per 60 s keyed on the client IP, plus `[observability]` so the effect is measurable at all.
- The ceiling, stated rather than softened: the binding offers only 10 s and 60 s windows, so a per-minute limit does not bound a daily quota. At 60/60 s a single IP still gets 86,400/day, past Groq's cap. It is per-colo and best-effort, not a global counter, and IP keying is defeated by a distributed source. The guard also sits after the origin, route and token checks, so 403/405/401 responses never consult it and still spend Cloudflare's daily allowance. This converts "one laptop with a `for` loop" into "sustained traffic from many IPs for hours" — a real improvement and **not a fix**.
- It fails open by design, on both an absent binding and a rejecting one. The reasoning is in **D-338**, and that is where a reader should go before changing any of it.
- Worker `v1.9.0` is still built and still deliberately unshipped. This shipped as a patch on the live 1.8.x line precisely so that number stays reserved for the membership gate.

**Shipped:** version id `5031e0fb-7b1d-41f3-aac8-341703463233`, deployed 2026-08-17, replacing `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6` (`v1.8.0`, 2026-08-09). Live-probed after deploy: a normal concierge turn returns 200 with `access-control-allow-origin: https://powan55.github.io`, answered by `openai/gpt-oss-120b`.

---

## v6.0.1 (app) · 2026-08-20 · worker stays at v1.8.1

**The flight cards are back on blue.** The lime/green re-hue that shipped in `v6.0.0` read as olive
on the day timeline, so `transportation` returns to the cyan trio it held before it and the journey
card's own vocabularies return to cyan/teal. Cyan is the interaction signal's own hue, which is what
the re-hue was for; that collision is now recorded as a known ceiling in both files rather than
solved by moving the content, because every control there also carries a text label. The 60-160°
band is ruled out.

Doing it surfaced a second thing. Those badges used `/12` and `/15` opacity modifiers, which are not
steps in Tailwind's scale and emit no rule at all, so the phase strip, the layover verdicts, the
cabin tiers and the flights-page status chips had all been rendering with **no background** — with
lime and with cyan alike. They are on `/10` and `/20` now. The same defect is still spread across
about 25 other files, `border-white/15` in most of them; that is not swept here.

Seven fixes on top, all of them things that either lost data or dead-ended a control:

- **Photo delete had no confirm and no undo** (#116) — the only destructive action in the app with
  neither. It now asks first. The blob is gone from IndexedDB the moment it runs and there is no way
  to put the bytes back, so this takes the confirm arm of the house pattern, not the toast arm.
- **Deleting an expense or clearing the journal never freed the attached photo** (#119) — the blob
  stayed on the device with nothing left in the UI pointing at it, un-freeable short of forgetting
  the whole device. The expense receipt has to outlive the undo window, so `showUndoToast` grew an
  `onSettled` hook that fires only when that window closes un-taken (**D-368**).
- **A zero or negative exchange rate persisted and redisplayed forever** (#120) while every
  conversion quietly used the seeded rate underneath it. Rates were clamped at read time only; the
  write path now collapses anything non-positive to the same blank sentinel a mid-edit empty field
  already used.
- **The ⌘K converter hit Frankfurter on every keystroke** (#117). "1000 usd to jpy" typed a digit at
  a time was a dozen live calls to a free third-party API. It waits for typing to settle and holds
  one rate per currency pair for the session — the gate `lib/world-search.ts` already applies to the
  same class of API.
- **One failed place lookup dead-ended "Look up" for that URL permanently** (#127). The single-flight
  guard was set before the outcome was known and never cleared, and `resolvePlaceLink` degrades to
  `null` on any failure — including every lookup in a build with no Worker configured.
- **The offline banner and the sync badge overlapped at phone widths** (#129) — both `top-20` pills,
  one centred and one right-anchored, showing together exactly when you are offline with unsynced
  edits. The badge drops a row while the banner is up.
- **`body[data-dialog-open]` had no ref-count** (#130) despite a comment claiming one. A dialog
  opened over an open sheet cleared the flag on its way out. One hook owns the attribute now and
  moves it only on the 0↔1 transitions (**D-369**).

Four more, from the other half of the backlog:

- **⌘K searched deleted items for up to 30 days** (#121) and selecting one did nothing. A tombstone
  is retained so the delete can propagate and win; the palette is mounted outside
  `ItineraryProvider` and reads a raw `loadPlans()` snapshot, so the provider's own filter never ran
  on it. Filtered inside `searchPlanItems`, where `/plan`'s already-filtered plans hit a no-op and no
  future caller can forget it.
- **`pushTripList` was the one read-merge-write in its module family outside a transaction** (#125).
  Two devices forgetting two different trips both read the same doc and the second write won
  outright, so a forgotten trip could reappear or a new one vanish. It uses `runTransaction` now,
  like `pushDayMerged`, `pushBudgetMerged`, `pushChecklistMerged` and `pushPlacesMerged`.
- **Editing a past day's journal still said "Today's journal"** (#128) — in the heading, in the Edit
  trigger's `aria-label`, and in the empty prompt, so it reached the accessible name and not just
  the pixels. The card takes an optional flag; the Today panel's copy is unchanged.
- **`/flights` ran four independent 1 Hz intervals** (#118), none pausing on a hidden tab, months out
  from a departure whose label only shows `mo`/`w`/`d`. They share `lib/travel-tick.ts` now — built
  to kill exactly this and never actually `/travel`-specific — at its 20s base cadence, escalating to
  1 Hz only inside a week where the reading carries seconds. The shared tick also stops while the tab
  is hidden and fires a catch-up on the way back, which applies to `/travel` too (**D-370**).

Full unit suite green (2357 tests). The e2e specs covering every touched surface were run against a
real build: photos, currency-command, expenses, budget, offline-banner, sync-status-badge,
flights-page, journal, journal-browse, journal-browse-a11y, journal-browse-photos,
recap-story-photos, interaction, travel-route, countdown, s157-a11y-close-targets, tm-acceptance,
and all 24 visual baselines — 210 passed, 0 failed. Two specs changed with the code: `photos.spec.ts`
clicks through the new delete confirm, and `sync-code.test.ts`'s fake Firestore learned
`runTransaction`.

---

## v6.0.0 (app) · 2026-08-20 · **LIVE** · worker stays at v1.8.1 (v1.9.0 built and deliberately unshipped)

**The hold is off by explicit owner waiver, not by completing the checklist below.** This entry
carried a `NOT DEPLOYED` heading from 2026-08-16 while a full bug sweep and a research pass ran
against it. Both finished and everything they found that was worth fixing is in this release, so
the body below is a complete and accurate account of what ships. Three manual on-device checks were
named as the remaining condition — one live round-trip with the deployed assistant, a two-device
pass over a custom trip's expenses and restore, and one offline cold start on Home — and the owner
waived them on 2026-08-20 rather than running them. **None of the three has been performed.** If a
concierge round-trip, a two-device custom-trip sync, or an offline Home load misbehaves after this
ships, start here: those are the paths this release moved and nobody exercised them on a real
device before it went out.

**Two more fixes landed after the sweep closed, caught by their own dedicated pass (#141, #142).**
The DST test suite had silently never run — `TZ` was unset, so every DST-dependent case executed
under the runner's local zone and asserted nothing about the boundary it named. Pinning
`TZ=America/New_York` in `vitest.config.ts` made them run for the first time, which surfaced a
real bug: `countdown()` computed the days remaining from two independent walks —
`differenceInDays` back from the target and `addDays` forward from now — reconciled by a
hand-rolled borrow that assumed the two walks were exact inverses. They stop being inverses across
a UTC-offset change, so the countdown showed impossible fields (negative days, or a 24-hour
miscount) in both directions around a DST transition. Replaced with one sequential walk — months
maximal, then days maximal from where months landed, then hours/minutes/seconds as the residue —
so every field is non-negative by construction and the old borrow can't recur (D-313 addendum,
2026-08-20). Full suite (2355 tests) is green with the fix in; the D-313 leap-day and sum-back
invariant regression sweeps pass unchanged. One retraction is folded into the same addendum: months
stay anchored on `now` rather than the target, by owner ruling, which means the days cell can tick
up by one at a month boundary — that's arithmetic, not a defect, and D-313's original monotonicity
claim is retracted accordingly.
179 commits sit between this and `v5.14.4`, which stayed live while they accumulated on `dev`.
**Why the major bump, and it is not ceremony.** `v5.15.0` was already the largest release in this
repo's history; everything below it in this file is still true and still ships here. On top of
that, the interaction colour of the entire app moved, the front page's photograph and structure
changed, the app shell now tints by month, and a trip that is not Nepal × Japan finally behaves
like a trip of its own rather than a Nepal × Japan trip with the labels changed. Someone who last
opened `v5.14.4` does not recognise this build. Semver's major slot is for exactly that, and
calling it `5.16.0` would have understated it to the only audience that reads version numbers —
us, six months from now, trying to work out when the app changed.

**`v5.15.0` ships inside this and will never exist on its own.** It was prepared, never tagged,
never deployed. Its entry stays below because the detail in it is the record of that work — read
it as part of this release. This is the same shape as `v5.13.0` riding inside `v5.14.0` and
`v5.14.1` inside `v5.14.2`.

### What is new since the v5.15.0 notes were written

**The chrome accent moved off gold (#91, D-334).** Marigold `#FFC43D` → volt `#3ED8FF` for
`--primary` and `--ring`, over a chromatic purple ramp. Two follow-ups were needed because a
recolour is never one value: `/map` keeps marigold deliberately rather than taking the chrome
accent (D-334), and the retired gold turned out to have survived on ten route headers, which is
the kind of thing only a grep finds.

**Two empty grid tracks that painted as solid slabs.** The stat row was `sm:grid-cols-4` while
carrying six cells (#90), so at ≥640px the last two tracks stood empty — and because the dividers
are the container showing through 1px gaps, an empty track is not empty, it paints `bg-border`.
The bento had the same defect in every tile-count state (#106). Both are grid-arithmetic bugs with
a visual signature, and the stat row now carries a comment saying the column count must divide the
cell count exactly, because it will happen again otherwise.

**Home stopped printing the same number three times (#106).** `trip-dashboard.tsx` is deleted. Its
own header claimed it "deliberately does NOT duplicate" the stat row while two of its three cards
duplicated exactly that — total trip days, and days until departure, which the hero also renders
as a countdown grid and again as a ring. `114` rendered in four places above the fold at 1280. It
renders twice now; the last duplicate is deferred with #92, below.

**The app shell tints by month (#83).** `lib/season-theme.ts` plus a `season-accent-engine`
island. Six of the twelve months are warm and the two months of the actual trip are cool, which is
worth knowing before anyone reads a warm cast as a regression.

**The Home hero is a photograph again (#89).** It was a labelled NASA satellite relief map with
"Tibetan plateau", "Ganges river" and a `200 km` scale bar burned into the pixels, full-bleed under
the `h1` inside an `alt=""` image. It is now Ama Dablam for the Nepal leg and every day outside the
trip window, and the Shinjuku skyline with Fuji for the Japan leg, following the trip clock through
a pure `heroImageForLeg()`.

That swap had a hole worth recording, because it is the kind that passes every check.
`public/images/**` was excluded from the precache, so `hero-japan.*` was a URL the device had never
requested: offline on 19 Dec — a travel day, on an offline-first app — the fetch fails and the hero
paints the invented SVG mountain range it keeps as fallback art. Fixing it surfaced a worse one.
`trimImageCache()` evicts oldest **by insertion** and a cache hit does not refresh recency, so the
runtime image cache is FIFO-80 against 105 manifest images, and Home is the entry route — **the
default hero was already cold offline before any of this**. Six hero AVIFs are now precached
(D-335, amending D-073 and D-086(b), which are LOCKED and said images are never precached). It
costs 555.2 KiB, which is 11.9% of the raw precache but **30.0% of the gzip install**. AVIF does
not compress and the HTML and JS do; the raw number understates it, and it is paid knowingly. The
map-engine change further down this entry gives back more than this spends.

Also on that slice: a per-frame `object-position` knob, a one-div highlight cap
(`mix-blend-mode: darken` over the leg's duotone token) that raises hero contrast rather than
lowering it and still does not unlock the floor tier, and the four assertions the feature had none
of — the hero paths are pinned to real manifest keys, the resolved raster is pinned per leg, the
offline decode is pinned with the image cache wiped, and every text pairing over the new composite
is in the contrast harness.

**Four sync and export defects that could lose data, found in the bug sweep**
(#123, #126, #124, #115).

One malformed itinerary item arriving over sync could empty the whole trip on every device (#123).
It was two bugs wearing one hat: a `null` or primitive row threw inside `mergeItems`, and the
snapshot handler's `catch` swallowed it, so sync went silently dead for that trip — no apply, no
push, no error; separately, a merely *invalid* row rode through to disk and failed the
whole-payload parse on the **next** load, which is the wipe people saw. The itinerary was the last
domain with no per-row sanitizer, and it now shares one definition of a valid row with the Vault
schema (D-363). The load path drops bad rows instead of quarantining 31 good days over one of them.

That fix then broke a different guarantee, and the review caught it before it shipped. Making the
shared parser lenient also made the **import** path lenient, so a garbage backup file validated as
an empty trip and `savePlans([])` wiped the live one while reporting success — and under sync
`restorePlans` propagates that as tombstones to every device. The two boundaries now use
deliberately different strictness, because the tradeoff inverts: on disk there is no second copy,
so partial beats nothing; on import the user still holds the file, so rejecting costs them nothing.
D-098 is unchanged and now has a test that fails if anyone weakens it again (D-364).

**Expenses and docs had the same bare cast at the remote read boundary (#126).** A single poison
row rejected the transaction, so the chunk stayed dirty and retried forever — that device's sync
wedged, silently. The sanitizers already existed and were already used on local reads; they were
just never wired at the remote edge (D-365).

**The outbox could mark an edit synced that never reached Firestore (#124).** Two rapid edits to
the same day started two independent pushes, and the older one's ack cleared the dirty flag while
the newer was still in flight; if that newer push then failed, nothing retried it. Pushes now
serialize per day, and an ack only counts for the attempt carrying the newest state (D-366).

**The expense CSV export executed formulas (#115).** A traveller's note beginning with an equals,
plus, minus or at sign ran as a live formula when the organizer opened the export — a shell escape
in one direction, a link function that exfiltrates the row in the other. The payload author and the
victim are different people, which is what made it worth fixing now rather than later. Leading
triggers are neutralized, tab/CR/LF included since spreadsheets strip those first; values that are
entirely a number are exempt so the Amount column still sums (D-367).

### One app, any trip

`v5.15.0` shipped custom trips and then treated them as a special case of Nepal × Japan in about a
dozen places. The sweep that followed found the pattern rather than the instances: a two-value
`nepal`/`japan` ternary, or a hardcoded pair of leg ids, in whichever module nobody had revisited.
Every one of them now derives from the active trip's own legs.

- **Expenses never synced on a custom trip, in either direction, and the pull was destructive.**
  `expenses-remote.ts` declared its own leg pair, and `applySnapshot` rebuilds the entire local
  row-set by iterating it before overwriting the slot — so on a single-leg trip the loop never
  considered the only leg there was, and the first empty server snapshot wrote `[]` over every
  logged expense. `expenses-ports.ts` had the identical hardcode in `chunkDiff`, so the write side
  was equally dead and nothing had ever pushed. Two independent no-ops sharing one wrong constant:
  nothing had ever synced, so the first snapshot had nothing to confirm and everything to erase.
  The `v5.15.0` notes below record this as "expenses do not sync on a custom trip"; it was worse
  than that sentence says.
- **A leg id that was not `nepal` or `japan` quietly became `japan` everywhere.** Item times,
  timezone badges, map pins, My Places and Travel Mode's safety panel all defaulted into the Japan
  branch. Worst case, a traveller who is not in Japan saw Japan's real emergency numbers, and via
  date-keyed flight data could see someone else's real flight numbers, under a panel headed "Japan".
- **Money assumed two legs (#95, #96).** The budget panel rendered fixed Nepal and Japan cards, so a
  typed leg budget on a custom trip had nowhere real to go, and Wrapped and the story recap tallied
  spend against a hardcoded pair, so a custom trip's spend reported as zero or came back labelled in
  yen. `formatMoney` also rounded every USD amount to whole dollars — a $4.50 coffee showed $5 — so
  a three-way split's displayed transfers did not sum to the displayed balance. USD now keeps two
  decimals, and `settle()` apportions the rounding remainder before splitting into transfers, so the
  two agree to the cent.
- **The seeded checklist and packing lists leaked Nepal and Japan content into every trip (#102),**
  and because a custom trip has its own remote document, that seed was pushed on first sync.
  Durable, not merely rendered. A non-default trip now seeds from a country-neutral template.
- **A trip joined by token carries no config block, which is that field's normal state for a
  joiner,** and the app silently handed the joiner a 32-day Nepal × Japan itinerary instead. The
  same line was also reachable with a prototype key name, which returned a function where every
  caller expects a trip config — a module-load throw on every route, with no in-app recovery.
- **Forgetting a trip left all of its data on the device (#100).** Only the entry in the known-trips
  list was removed; every itinerary, expense, budget, photo and outbox slot stayed on disk — a
  privacy problem on a shared device, and a dirty outbox that could resurrect deleted items on
  re-join. The last two raw `localStorage` holdouts moved onto the storage gateway in the same pass.
- **Restoring a backup could silently replace a different trip.** The envelope has carried its
  `tripId` since it was written and the import path never read it back, so exporting trip A and
  restoring it while trip B was active replaced every domain of B with A's — no warning, no undo,
  and under sync it propagated to B's other members. It now refuses on a mismatch, before the first
  write. The same envelope never carried My Places, so the "Back up this trip first" button in the
  sign-out dialog promised something it could not deliver: sign-out wipes My Places and the restore
  could not bring it back.
- **Five smaller correctness bugs (#98).** A multi-day item stayed exempt from clash detection
  forever once its end date fell behind the day it was moved to; the recap used device-local "today"
  while the hero uses destination-local, so the two disagreed by a day near the date line; pre-trip
  Travel Mode read "0 days" for the whole day before departure; "Next up" showed the day's first
  stored item rather than its earliest by time; and the Home hero had no post-trip state at all, so
  it showed a zeroed countdown clock forever after the trip ended.

### The keyboard, and what a screen reader could actually hear

Accessibility is an acceptance criterion here, and this pass found defects at the root of the app
rather than at its edges.

- **Nothing linked to the `<main>` that all 19 routes already rendered.** Every keyboard user tabbed
  brand, primaries, More, Travel Mode and sign-out before reaching the content, on every navigation.
  One anchor, and one id on a wrapper that already existed.
- **Sixty card titles on `/nepal` and `/japan` were not headings.** Three sibling card components
  wrapped the whole card body in a `<button>`, which is invalid twice over — a button may only
  contain phrasing content, and everything inside one collapses into its accessible name. The
  heading outline on those routes ran `h1`, `h2`, nothing. Inverted rather than patched: the title
  is now the control, and its button stretches the hit area back over the whole card, so nothing
  changes for a mouse or a finger.
- **The serif faked 70 bolds.** Instrument Serif ships weight 400 and nothing else, and 70 of the 93
  `font-display` sites across 45 files also carried `font-bold` or `font-semibold`, so every page
  title, section masthead, error heading and dialog title rendered a browser-synthesised faux bold.
  One unlayered declaration, zero component edits.
- **The 44px tap floor had no consumers (#105).** The token was declared and unreachable from a class
  name while `/plan` shipped 17×17 drag grips. Twenty controls across eight files move onto the
  floor, and `/plan` rows now wrap below 640px, because four 44px controls cost 51px of row width
  and without wrapping a 360px phone's title drops to about 92px.
- **`/plan` row actions had no focus variant,** so tabbing a day moved focus onto three fully
  transparent buttons per row, with the focus ring drawn on an invisible element.
- **There was no `not-found` page,** so the framework fallback injected a white background on a
  dark-only app — and under a static export that is also what GitHub Pages serves for every unknown
  path.
- The skip link was the first Tab stop on `/travel` but sat outside the Travel Mode root, a layover
  airport name failed contrast only once its class started working, and the axe audit was itself
  sampling `/flights` mid-reveal and failing about one run in four.

### What it weighs, and what it costs to check out

- **The map engine is out of the install.** MapLibre's chunks and the glyph PBFs are runtime-cached
  rather than precached: 363,100 B gzip off every install, for a route most sessions never open.
  The first online `/map` visit backfills it into the same cache the readiness check reads.
- **The WebP tier is deleted.** The `<picture>` order is AVIF, WebP, JPEG, so WebP could only win
  for a browser that decodes WebP but not AVIF, and within the declared browserslist that set is
  empty. 296 files nobody ever fetched were 41.1% of the tracked repo — 100.6 MB down to 59.2 MB.
  That is clone, CI and deploy time, **not** a payload win: no user was ever served those bytes.
  Outside the browserslist the fallback is now the heavier JPEG, and a device holding an old
  service worker holds old HTML pointing at deleted files for one session until the update lands.
- **`/plan` shipped two 32-day day selectors that never synced (#94).** The route rendered the same
  itinerary twice, stacked, in two different orders, and the timeline's date callback was dead code
  because the island renders its component without props. The timeline is deleted and the one
  surface it owned is remounted as its own island.
- **Eight routes hand-copied the same page header,** down to the class order — two of them differed
  in three text strings and nothing else. That duplication had already cost one recolour bug. One
  component carries it now, and all eight keep their server-component boundary.

### What stands between a merge and the live site

- **The release gate called this very release clear to ship.** Its assertion looked for a fixed
  `## v6.0.0 ` string, and its own comment claimed a `NOT DEPLOYED` heading would fail it. It never
  did — the marker is a suffix, so the string matched and the gate printed "clear to ship" on an
  entry whose body says the opposite. That gate is the only automated signal on the `dev` → `main`
  pull request, and that merge deploys. It now scans heading lines, matches the tag as a whole token
  with emphasis stripped, and refuses a hold marker wherever it sits on the line. A second assertion
  is new: the version must be strictly **above** the highest existing tag. Seven versions in this
  file were never tagged, so setting the version backwards to any of them passed the old
  inequality-only check and would then have stamped a tag that lied about history.
- **All 17 action uses are SHA-pinned,** with the version as a trailing comment so the bots still
  read them. Six are major bumps, and **three of them cannot be exercised before a push to `main`**
  — `deploy.yml` runs on that push alone and has no manual trigger — so `configure-pages`,
  `upload-pages-artifact` and `deploy-pages` run for the first time as this deploy. All three are
  runtime majors with no named input or output change, and the artifact producer and consumer moved
  in lockstep, but the first proof is the live run. Watch that job.
- **The leak scan's own self-test now runs in CI,** ahead of the scan. That table exists to stop the
  scan reporting "clean" on a partial marker set, and until now nothing exercised it.
- **All 36 visual baselines were re-shot (#93)** — all of them, not the twelve anyone expected,
  because the 2% comparison tolerance lets a stale shot pass without counting as changed. CI runs
  the visual job advisory, since Windows-generated baselines cannot be consumed on a Linux runner at
  all, so those files are proven locally and nowhere else.

### Deliberately not in this release

**#92 (the Home editorial restructure) and #88 (the UI/UX overhaul it hangs off) wait for
`v6.1.0`.** Nothing on Home is half-migrated without them: the photographic hero, the stat row, the
utility band and the inspiration gallery are a finished surface, and #92 adds to it — a
whole-journey timeline bar, numbered chapter photo bands, editorial serif titles. Holding four
data-loss fixes and a custom-trip correctness sweep behind an additive design slice buys users
nothing. #92 also carries its own acceptance criteria — motion, contrast over new photographic
composites, zero horizontal overflow at three phone widths — and another re-baselining of the Home
hero snapshots, which can only be done and eyeballed locally. It is a release of its own and it
will be a better one for not being folded into this.

One visible consequence, stated rather than buried: pre-trip, the "days to go" figure still prints
twice above the fold at widths of 420px and up, once as the hero's ring and once in the stat row.
The first slice of #92 is the fix, and it is about fifteen lines.

### Known open

- **#136** — the service worker's image branch now falls back to the cache on any non-ok response,
  which closed the captive-portal hole for redirects and 511s. A portal that answers **200** with an
  HTML login page is still treated as an image. The content-type check is not in.
- **#138 and #139** — two remote read boundaries where a field a *newer* client wrote is dropped by
  an older one, and the stripped row is written back up. Nothing round-trips badly today, because no
  build currently writes such a field. It becomes real the first time two versions are in the field
  at once, which for a lazily-updating installed app is the normal state and not the exception.
- **#125** — `pushTripList` is the one sync write in its family that is not transactional, so two
  devices reconciling the known-trips list at the same time can lose one another's change. A
  forgotten trip can come back.
- **#119** — deleting an expense or clearing the journal never frees the attached photo. The blob
  stays in IndexedDB, invisible and un-freeable short of forgetting the device.
- **#135** — the visual snapshots still carry a 2% tolerance. All 36 are fresh as of this release,
  and that tolerance is what let the previous set go stale unnoticed.
- **Firestore rules publishing is still inert.** The pipeline can publish, and proves the rules
  against a real emulator first, but the step is gated on a `FIREBASE_SERVICE_ACCOUNT` secret that
  does not exist. The live ruleset is still whatever was last applied by hand. Arming it is an owner
  step and D-399's order matters: confirm every traveller is in the live rosters first, because
  afterwards only an existing member can add anyone.
- **Worker `v1.9.0` stays unshipped.** It requires a signed token that only a `v5.14.0`-or-later
  client sends, and the condition is that such a client is live on **every** device, which this
  deploy makes likely rather than certain. The concierge stays on `v1.8.1`.

---

## ⛔ v5.15.0 (app) · **NOT DEPLOYED** · 2026-08-16 · worker stays at v1.8.0 (v1.9.0 built and deliberately unshipped)

The redesign lands, and it is the largest single release in this repo's history: 61 commits, and it closes 35 tracker issues. The app that ships here does not look like the one before it.

**The palette.** The merged palette, type scale, shadows and motion arrive as one token layer rather than as values scattered through components (#23), and the faded-white text goes with it. Roughly 728 `text-white/NN` sites across 81 files are replaced by three solid ink tiers — `--text-hi`, `--text-mid`, `--text-lo` — chosen by the role the text plays rather than by the nearest alpha (#27). That distinction is the whole point: a note's typed value sits *above* its own label, and a placeholder and a completed item both drop to the floor tier, so a sweep ordered by number would have got several of them backwards. The `@layer utilities` AA floor that used to rescue low alphas is deleted, because after the sweep it matched an empty set — verified by grep across every variant form, and held by a test so a future `text-white/40` fails loudly instead of inheriting cover that no longer exists.

**The front door.** Both of its views are photographic now (#25). The landing gets a full-bleed cover, display type and a Ken Burns drift; the auth view keeps that cover mounted *behind* the card instead of unmounting it, which is what the design rule always said and what the old code broke by rendering the two views exclusively. The panel's edge steps up to the interactive boundary on that surface, because the decorative one measured 1.04:1 against the photograph's highlights and was invisible exactly where the card crossed them. Darkening the panel instead cannot work and the arithmetic is recorded: the graded backdrop is a range the panel's fill sits inside, so a fill has no single ratio against it and tops out at 2.26:1 even at pure black.

**Motion.** The overlays are gated, the celebration tiers are enforced in code rather than documented, and entrances are ledgered so they fire once per session instead of on every mount (#24). Nothing animates behind an open form, including the cover's own loop, which now pauses rather than being deleted along with the surface it belongs to.

**Places you have been, for life rather than per trip.** A passport page stamps every visited country (#5), a profile screen lets you add the places you went before this app existed (#4), and the visited set lives outside the trip namespace so it survives the trip (#29). Days count a city when they arrive and GPS confirms it (#30), and the map fills in from that record (#31) — as a visited-city footprint rather than real national borders, which the copy says plainly.

**The map.** It draws only the selected day, numbered in that day's own order (#1); its glyphs are served from this origin instead of a third party, so day numbers survive offline (#8); and you can search for any place in the world from the panel (#22).

**The assistant.** It refuses to double-book you and names what it hit (#19), says why a suggestion was dropped instead of showing machine text, and says it is unreachable instead of surfacing "Failed to fetch" (#13). Overlapping plans are refused at the write rather than warned about afterwards (#18).

**Smaller, and still worth naming.** Inner pages get photo headers and their own accent (#3). Home gets one scrim over the hero and a live stat row under it (#26), and the weather panel becomes a curated inspiration gallery (#21). My Places follows you between phones (#17) — and only My Places: the Saved chip on /map and /guides is a different store (favorites, gateway key 14) and stays deliberately local-only, because it is a bare id list with no rows to merge on, so an add-only union would never propagate un-saving. There is a night-before readiness check that never guesses (#20) — it precaches the map *engine*, not basemap tiles, and says so. The phrasebook carries native script on every row (#2). Day one is named New York (#6). The shared-trip door sends a visitor to signup instead of asking for a key they cannot have (#70).

**Money.** The Nepali reference rate moves 134.5 → 152.7, checked 2026-08-15 against three sources that agreed, and the budget seeds move with it (#33). The old comment claimed a 133–136 band held by the peg to INR; that was wrong on its own terms, since the peg holds the NPR/INR cross and not NPR/USD, and the real rate ran 145.03 to 154.94 over the preceding six months.

**Two fixes that landed alongside, both worth naming.** A split expense with no recorded `paidBy` used to settle to *whoever was signed in*, which made "who owes whom" a function of who was looking: the same synced row settled to a different person on each device, and a claim-authorship rename silently moved that balance to the new name. `settle()` now takes no identity argument at all — an unattributable row contributes nothing, exactly like a fast-path or deleted one (D-333). And `/settings` went straight from its `<h1>` to the cards' `<h3>`, because the group titles were plain spans; they are now the `<h2>` the page was skipping, which also gave the settings section the accessible name its `aria-labelledby` had been pointing at nothing for.

**Housekeeping that is not cosmetic.** The landing screenshots were re-shot and two of their six strings corrected — one described a feature rather than the picture, the other still claimed an offline map that D-271/D-274 had retired (#34). The twelve TM hero baselines were re-shot against this build (#28); the first attempt passed green and rewrote nothing, because `--update-snapshots` defaults to `changed` and the comparison carries a 2% tolerance that a text-colour change hides under. Only `--update-snapshots=all` told the truth, and under it all twelve differed. The release pipeline can now publish `firestore.rules`, and proves them against a real emulator first (#39) — but it is still INERT: the publish step is gated on a `FIREBASE_SERVICE_ACCOUNT` secret that does not exist, so this deploy does not touch the live ruleset either. The live rules remain whatever was last applied by hand. Arming it is an owner step, and D-399's order matters — confirm every traveller uid is in the live `members` rosters BEFORE publishing, because afterwards only an existing member can add anyone.

**Known limitation, found by the two-device pass and not fixed here.** Expenses do not sync on a CUSTOM trip. The sync transport hardcodes the two default-pack legs in `lib/expenses-ports.ts` and `lib/expenses-remote.ts` — `expenses-remote.ts` acks any leg that is not `nepal` or `japan` rather than writing it — so a custom trip's `main` leg never registers as a changed chunk and the push silently no-ops. The default Nepal x Japan trip is unaffected, and plan, documents and My Places sync correctly on both. Root-caused during issue #43's manual pass; the fix is its own slice.

---

## v5.14.4 (app) · 2026-08-14 · worker stays at v1.8.0 (v1.9.0 built and deliberately unshipped)

The countdown's "month" went back to meaning a calendar month. Three days ago it changed to a fixed 28 days so the on-screen breakdown would always add up to the flat "days to go" number next to it — a real payoff, but it meant a trip 117 days out read "4 months, 5 days" instead of "3 months, 3 weeks, 5 days", because the leftover happened to land on exactly zero weeks. That's correct under the fixed-28-day rule and not what a calendar means by "month", and it looked like the app had quietly stopped counting weeks. It hadn't — reported, checked, and reverted.

Bringing calendar months back reopened an old, latent bug that had never actually surfaced: walking forward a whole number of months and landing on a day that doesn't exist in the month you land on (the 30th or 31st walking into a shorter month, or the 29th into a non-leap February) could overshoot the target by a day, and the countdown would show a negative week count and a nonsense hour reading. It had been sitting there the entire time calendar months were last in use and nothing ever hit it. Fixed alongside the revert, checked against tens of thousands of date pairs spanning every month length and every leap-year boundary.

One accessibility fix rode along: the compact countdown's screen-reader label was built from a number that no longer matched what the visible countdown showed once months stopped being a fixed length. It now reads the same numbers a sighted user sees, so the two can't disagree again.

---

## v5.14.3 (app) · 2026-08-13 · worker stays at v1.8.0 (v1.9.0 built and deliberately unshipped)

The weather card and the currency rate could hang forever. Neither ever throws — on any failure each falls back to a cached, stale reading, or a quiet "unavailable" if there is no cache — but that fallback only fires on a *settled* rejection. A connection that neither routes nor rejects settles nothing, so the card sat on its loading shimmer with no way out. This was not theoretical: CI failed on it directly, timing out at 30 seconds on three consecutive attempts, because the test runner has no route to Open-Meteo. Both fetches now carry an 8-second ceiling, the same one already used for place lookups and trip probes, and a timeout is treated as an ordinary failure — it falls through the existing fallback exactly as before. Nothing about what the card shows changed, only how long it is willing to wait before showing it.

Home's loading skeleton was reserving the wrong amount of space, and on a cold mobile load it showed. Every section that loads in lazily — including the trip strip sitting above the hero — rendered the same 826-pixel placeholder no matter what height it declared, because the declared height was only ever a floor, never a ceiling. That put roughly 700 pixels of empty space above the hero before the real content arrived: the "Open Planner" button opened off-screen, then the page visibly jumped as the trip strip mounted, briefly sliding the hero under the fixed navigation bar. The skeleton now reserves exactly the box it declares, clipped rather than overrun, and the hero sizes itself to the room actually left for it instead of claiming a full screen while sitting further down the page. On the narrowest supported phone (320px) the primary button used to sit 19 pixels below the fold; it now clears with margin on every supported width, verified directly rather than assumed.

Both fixes were found chasing the same two failing checks (#54); the loading-skeleton one turned out to be a live layout bug independent of the tests that caught it.

---

## v5.14.2 (app) · 2026-08-11 · worker stays at v1.8.0 (v1.9.0 built and deliberately unshipped)

The countdown said "29 days, 0 weeks". It now says "1 month 1 day".

Units carry the way you would say them out loud: seven days become a week, four weeks become a month, and a unit that comes out at zero is not shown at all. So 16 days reads "2 weeks 2 days" and 9 weeks reads "2 months 1 week".

That zero was not a rendering slip. The weeks field was being pinned to zero at 28 days on purpose, so that "4 weeks" could never appear on screen. It traded one bad reading for another, and the one it left behind sat there for a fortnight at a time. Carrying removes the need for the trick: four weeks becomes a month before anything renders, so there is nothing left to suppress.

The hours, minutes and seconds still show whether they are zero or not. They tick, so a 00 corrects itself within the minute, and dropping one would rearrange the row every minute.

One trade, made deliberately and worth naming: a month in the countdown is now 28 days, so it will not line up with a calendar month. What that buys is that the numbers agree with each other. "4 months 1 week 1 day" is exactly the 120 days the ring below it reports, where before the breakdown and the total were computed two different ways and were never meant to reconcile. Anything needing real calendar months works them out for itself and does not read these fields.

The same rule now applies to the compact countdown on the boarding-pass login card. The flights page's "Departs in" line already skipped its zeros and is unchanged.

Two more fixes ride along in this release.

The assistant stopped thinking it was December 9. The line telling it today's date was only built when today fell inside the trip window, so outside those five weeks it was dropped entirely, the model had nothing to anchor on, and it fell back to day one of the trip. Everything it suggested was scheduled against the wrong date, and it had been doing that every day since the window closed. It now gets the real date and time in every case, in or out of the window. The times it is handed are 12-hour too, so it stops reading "18:30" back at you: it was only repeating the format the app sent it.

A day that arrived over sync without a city of its own no longer renders a bare country. The default pack showed "USA" with nothing in front of it, and a custom trip showed nothing at all. Both now fall back to the city the date implies, which is the same city the rest of the app already uses for that day.

---

## v5.14.1 (app) — 2026-08-11 · **NOT DEPLOYED, SUPERSEDED** — never shipped on its own; its changes ride inside v5.14.2 · worker stays at v1.8.0 (v1.9.0 built and deliberately unshipped)

No application source under `trip/` changed. This is the v5.14.0 access-control client with a new version string, so every device that takes the update prompt lands on the same client it was already meant to have — which is the fleet convergence worker `v1.9.0` is waiting on, arriving slightly sooner. (The bundle does change: the version is inlined and rendered in the footer, which is what moves the service worker's cache key and raises the prompt at all.)

What changed is what stands between a merge and the live site.

- **The deploy runs the checks that gate a pull request.** `deploy.yml` calls `ci.yml` instead of gating on a marker scan alone, so repository hygiene, types, lint, unit tests and the build all have to pass before anything publishes. Until now a push to `main` reached the live site after a version check and a build and nothing else.
- **The release gate answers before the merge, not after it.** The version check used to live only on the push to `main`, so a pull request could go green, merge into the live branch, and only then fail to deploy — leaving `main` ahead of the site with the quick fix forbidden. It now also runs on the pull request into `main`, and it additionally requires that the release say what it changed, and that it came through `dev`.
- **The manual deploy button is gone.** It ran the *chosen branch's* copy of the workflow, and six branches still sit at an untagged `5.12.0`. Dispatching one of them would have passed the version gate, published a tree predating the whole access-control release, and tagged it as a release. To re-run a failed deploy, use "Re-run all jobs" on the run itself.

---

## v5.14.0 (app) — 2026-08-10 · **DEPLOYED** · worker stays at v1.8.0 (v1.9.0 built and deliberately unshipped)

Access control, tier 2. The previous release made sure the person logging in was real. This one makes sure the *device* asking for a trip is one the trip knows about, and it moves the concierge from "you sent me a trip id" to a check Google performs.

Every device now signs itself in silently the first time it syncs. That identity is anonymous, free, and invisible — you are never asked for anything — but it is a stable name the trip can hold, which is the thing the app has never had. It survives reloads, it survives signing out of the app (deliberately: the identity belongs to the browser, not the login), and it can optionally be linked to a Google account so you can get it back after clearing your browser data or changing phone. Linking preserves the identity rather than replacing it, which is the whole reason to offer linking rather than a sign-in. If you link an account you already used on another device, the app offers to adopt that identity here instead — that is the lost-phone path.

A trip can now hold a list of the devices allowed to open it. It is opt-in per trip, and it has to be: rules changes take effect instantly and globally, so a mandatory list would have shut every existing trip and every share link already sitting in someone's chat history, with no way back in. A trip you create is locked to your device from the moment it is created. A trip that predates this becomes locked the first time one of your devices opens it, and that device becomes its owner — after which the other travellers need adding. Settings has a new "Trip access" section with your device's code (send it to a friend, they paste it in), the list of devices on the trip, and — for the owner only — a way to remove one. If you open a trip you are not on yet, the app says so in one sentence and tells you where to fix it, rather than showing you an empty trip and letting you conclude the data is gone.

Two smaller things fell out of that and are worth naming. The presence heartbeat used to retry a refused write once a minute forever; it now stops after the first refusal and says why once. And the presence layer no longer starts its own copy of Firebase — it shares the one every other sync path uses, which is what guarantees it never writes before the sign-in it depends on has finished.

The concierge now sends a signed token with every request. The Worker verifies it by reading the trip document from Firestore as *you*, so the same rules that guard the app guard the concierge, and there is no second copy of the access model to drift. That half fails closed. This half is careful about ordering: the token is attached only when there is a session to attach, so a build with no sync configured — which includes the entire browser test suite — sends exactly the request it sent before, and the Worker's requirement can be switched on only once a client that satisfies it is actually live.

**This client ships first, and the two halves that enforce it follow — that order is deliberate.** With the old rules still in place the app simply signs in and writes a membership list nothing is yet checking, which is what makes it safe to ship ahead of them, and equally why shipping it does not on its own close anything. Three things must follow it, in this order, and each is a manual owner action:

1. **Rotate the shared trip onto a fresh id.** Until this happens the old trip id — which shipped inside the public bundle for months — still reaches real data under the old rules. This release stops the app from using that id, so the shared trip is local-only on every device until the rotation is done and everyone rejoins by link. Local data is untouched; so is the remote copy.
2. **Everyone opens the app on every device** while the old rules are still live. That is when each device mints its identity and adds itself to the trip. It cannot be done afterwards: once a trip carries a membership list, the new rules correctly refuse a device that is not on it.
3. **Publish the rules, then deploy worker v1.9.0.** Only after step 2 is confirmed device-by-device. Publishing early denies every read and write from any device still on an older build, because the auth floor those rules add did not exist before this release.

---

## v5.13.0 (app) — 2026-08-10 · **NOT DEPLOYED, SUPERSEDED** — never ships on its own; its changes ride inside v5.14.0

Access control, tier 1 of the redesign approved on issue #10. Until now, any pasted string was a working login: the door validated nothing, and the sync layer would quietly manufacture an account document for whatever key you invented. Four changes close that, each shaped so a network failure can never lock a real user out.

Signing in now checks the key is real. A new key pasted at the door triggers one server read of the account's identity document; if the server answers and the account does not exist, the door says "This user does not exist" and writes nothing to the device — no half-created session to clean up. Every failure shape (offline, timeout, a build with no sync configured, even a rules mistake) admits exactly as before, because being locked out of your own data on hotel wifi is a worse failure than a stranger getting past a door that leads to their own empty account. A key already stored on the device is never re-checked at all: a returning traveler logs in fully offline. Two things make the check meaningful: creating an account now writes both profile documents up front (and the confirm button waits for those writes, capped at five seconds, instead of reloading over them), and the sync layer's "no document yet? seed one from local" branch — the thing that made invented keys work — is deleted.

The built-in Nepal × Japan trip is now a sample that lives on your device only. Its remote database id used to be injected at build time and described as a secret, but anything injected that way ships in the public bundle, so the world could read and write the shared trip it named. The id is retired: nothing on the default pack syncs, nothing is shareable from it, and the trips page and Settings both say so honestly instead of offering an empty token with copy buttons. Real shared trips are the custom ones, whose unguessable id is the capability and never appears in any bundle. Rotating the old exposed remote data is an owner runbook step, not app code.

The concierge answers only for trips on your account. A custom trip the device never actually joined gets a refusal instead of a digest of whatever sits under that pointer, and on a sync-configured build the local sample gets a pointer to your own trips. Dormant builds — including the whole browser test suite — keep today's behavior on the sample, by construction.

And the wall now withholds the app instead of covering it. Since the landing shipped, a logged-out visitor's DOM still contained the whole home dashboard under the overlay — trip name and all, readable in view-source. That was recorded at the time as an open finding with a log-only test, because closing it needed an architectural call. The call is made: the app renders only for an identified traveler, the static export's HTML carries no trip content, and the log-only test is now a hard assertion that fails if any of it comes back.

---

## v5.11.2 (app) + v1.8.0 (worker) — 2026-08-09 · **DEPLOYED**: the first live deploy since v5.9.2

The Worker is live for the first time. `trip-planner-concierge` v1.8.0 deployed to `https://trip-planner-concierge.official-shadowverse.workers.dev` (Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`), predeploy gate green on typecheck plus 104/104 tests, with CORS locked to the site origin. Two rulings from the previous release had been sitting entirely inside it and had never reached anyone. The third-party web-search leg is now actually gone from the running service, not only from the repo, and the system prompt is trip-aware.

The concierge is now available on your own trips, not only Nepal × Japan. That switch was deliberately left off until the Worker shipped. A concierge that answers an Iceland trip as a Kathmandu guide, and then silently discards every change it proposes because plan edits are validated against the active trip's dates, is worse than no concierge. The Worker deploy above is what made flipping it correct, and the deploy date and version are recorded beside the switch so nobody later reads it as having been bypassed.

This deploy carries three releases at once. Live was v5.9.2, so everything in v5.10.0, v5.11.0 and v5.11.1 reaches users with this push: the eight rulings from 2026-08-06, the three from 2026-08-08, and the countdown fix.

A test that certified the opposite of the shipped behaviour was caught on the way out. With the concierge gate lifted, an end-to-end check still asserted the concierge must be *absent* on a custom trip, and it passed, because the local build has no Worker URL and the feature is therefore absent everywhere. Rebuilt with the URL present, it failed as it should have: expected absent, found present. The same run is the positive proof the feature works. A check that passes because the thing it tests is switched off is the failure mode this project guards hardest against.

Known, and stated rather than buried: whether the concierge actually answers in production depends on the `NEXT_PUBLIC_CONCIERGE_URL` repository variable being set to the Worker URL above. If it is unset the feature stays inert and the app is otherwise unaffected; the deploy log prints `concierge-url present: yes/NO`. (Superseded, issue #41: the deploy build now halts when that variable is empty, and also when it carries a path, instead of printing `NO` and shipping the app without its AI. The success-path log line is unchanged, so `present: yes` still means what it did.) Also unchanged from the previous release: two Travel-Mode hero screenshots remain stale and are deliberately not regenerated, and a synced custom trip still has its leg coerced on read.

---

## v5.11.1 (app) — 2026-08-09 · bug fix

The countdown said "3 months 4 weeks 1 day." Reported by the owner, whose objection was that four weeks is a month and should have been carried. He was right that the display was wrong, and right about the cause being the week bucket, though not for the reason first assumed.

What was actually happening: after counting whole calendar months, the leftover can be anything from 0 to 30 days, because months are 28–31 days long. Split into sevens, a 29-day leftover reads "4 weeks 1 day". The arithmetic was exact and the total time was never misstated, but nobody wants to read four weeks inside a month.

The leftover is now shown in days once it reaches 28, so that case reads "3 months 29 days". Every shorter leftover keeps the months/weeks/days shape. It is deliberately not rounded up to "4 months": that would overstate the wait by up to three days, and a countdown that misstates the date is worse than one that looks unusual.

A guard is now in place that would have caught this class of error, and it caught a worse one on the way. The first attempt at the fix re-anchored the maths on calendar dates, which looked right and passed every test written for it, while quietly double-counting the day you are standing in. Six hours before departure it would have read "1 day 6 hours"; a week out, "1 week 1 day 15 hours" for what was really 1 week 15 hours. Every displayed field was defensible on its own, and the total was wrong by a full day, every day.

It was caught by summing the displayed fields back into a date and checking they land on the trip start exactly, to the second, across 2,928 instants spanning a year, both daylight-saving transitions, and times of day either side of midnight, plus 12,000 more against non-midnight targets across a leap year. That check is now permanent. The lesson is the general one: the earlier tests asserted the two properties someone thought to ask for, and both stayed green while the total was wrong. The invariant nobody writes down is the one that breaks.

Also corrected: the "arriving soon" line on a flight card keyed off weeks alone, so with the week bucket suppressed a month-distant flight would have started showing a live hours-and-minutes countdown. It now checks days too.

---

## v5.11.0 (app) — 2026-08-09 · **NOT SHIPPED UNDER ITS OWN VERSION · reached users inside `v5.11.2`** · worker unchanged at v1.8.0 (deployed 2026-08-09)

Three owner rulings, each of which changed shape once the code was actually read. The worker was untouched by this release; its outstanding deploy from `v5.10.0` was cleared on 2026-08-09, when `v1.8.0` went live alongside app `v5.11.2`.

The map's search box now finds any place in your trip. It previously knew only the 27 curated guide locations, so Syracuse, the departure city as of the last release, could not be reached by name at all. Search now also covers the cities the trip actually visits and the stops you have planned yourself, and results say which of the three you are looking at. The stated ceiling, which the owner accepted rather than had imposed on him: somewhere you have never planned will not resolve. Making arbitrary world places work needs a geocoding service, and the free keyless ones forbid search-as-you-type, so it is a design decision rather than a switch. A test asserts that an unknown name returns nothing *and* that no request URL contains what was typed, which pins the ceiling against a future change quietly turning it into a network call.

What this release does not do is widen the default map view, which is what the owner originally asked for. The constant that was to be widened turned out to be read once when the map is constructed and overwritten a frame later by a fit derived from the data, so changing it would have looked like a fix and done nothing. Its comment now says so. The consequence that *is* real, that turning the itinerary overlay on fits a route spanning about 217° of longitude, is recorded and deliberately untouched, because no one has ruled on what it should do instead.

The day header no longer says "Syracuse, Nepal." `country` on a day is a leg identifier that selects currency and the day's time offset. It was never a label, but eleven separate places hand-rolled it into one anyway. There is now a single helper, and a day can carry its own label (Dec 9 says USA). Two of those eleven sites were worse than the one that prompted this: they printed "Tokyo, Japan" on every day of every custom trip. The rule is structural rather than cosmetic. The leg label is appended only on a multi-leg trip, so "Bali, Japan" and "Bali, Bali × Lombok" are both unreachable by construction rather than filtered out by string comparison.

That fix came within one merge of silently reverting on every synced device. The new per-day label uploads to the database intact, because the write path passes everything through. But both read paths rebuild a day from a fixed four-field list, and the label was not on it, so it would have been discarded on the first sync and the header would have gone back to "Syracuse, Nepal", with every test on the build machine still green. Both boundaries now carry the field. It is a pass-through, not a default: the frozen mapper contract holds and its pinned suite needed no edits.

You can now claim your old name on expenses and documents, and it cannot move any money. The previous release added this for itinerary items only. It now also rewrites the "logged by" stamp on an expense and the attribution stamp on a document, and it deliberately never touches who paid or who a bill was split with. The owner asked for the wider version and then narrowed it himself once shown why: the settlement maths de-duplicates split members before dividing, so renaming yourself into a split you are already in collapses two people into one, drops the divisor and re-points the balances. In a seeded case that is a real 1500 NPR debt disappearing. A test asserts the settlement output is byte-identical across a claim, and it was verified by deliberately breaking it and watching it fail.

A guard we shipped last release was weaker than it read. The money test pinned the two payment fields, which is what settles, but the spend totals also read an expense's *category*, which the settlement maths never sees. Corrupting `category` on every claimed row left the money guard, the settlement check and both sync proofs green. The assertion now derives which fields changed by diffing the records, so a field added later is covered without anyone remembering to add it. The general form is worth more than the fix: a hand-listed "this must only touch X" check covers exactly the fields whoever wrote it thought of.

Known and not fixed here: two Travel-Mode hero screenshots have been stale since the Dec 9 relabel in the previous release and are left failing rather than regenerated, because a second unexplained difference appeared alongside the expected one, and blessing an unexplained screenshot is how a real regression becomes permanent. A synced custom trip still has its leg silently coerced on read, which is wrong currency and wrong time offset rather than cosmetics; it is reported, out of scope, and needs its own slice. The map search panel's left edge sits 4.9px off-screen at 390px from its own centring maths, pre-existing.

---

## v5.10.0 (app) + v1.8.0 (worker) — 2026-08-06 · **BUILT HERE, BOTH HALVES LIVE 2026-08-09**: the worker shipped as `v1.8.0`, the app half inside `v5.11.2`

The owner ruled on all eight parked questions, and this release implements them. Neither artifact was deployed at the time of this release; both reached users on 2026-08-09, the worker as `v1.8.0` (Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`) and the app half inside `v5.11.2`. The ordering note below is what made that sequence correct, and it is a correctness constraint rather than a preference: the worker half could not reach a user until the owner ran `npm run deploy` from `worker/`.

Says the true time zone on the nine flight-day items. Nine seeded items carry a per-item zone (the Syracuse/JFK legs, the Delhi layover, Guangzhou, the Detroit layover home). The app badged them with the *day's* country, so the Jan 9 Detroit layover read "3:35 PM JST", 14 hours wrong. The previous release suppressed the badge as harm reduction; it now names the real zone (EST / IST / CST), resolved from an offset table. The displayed time is unchanged and is still wall-clock-at-place, so only the label moved. An offset with no table entry shows no badge rather than an invented one. Known ceiling: the table maps a UTC offset, not a zone id, so it is sound only because `-300` occurs here solely in December and January and the Asian zones observe no DST. A summer-dated trip needs real zone ids first (D-137 amendment).

Dec 9 is Syracuse, not Kathmandu. The first day was labelled with the destination while actually being spent in Syracuse, JFK and the air. The day's city, weather, header and concierge digest all follow the label, so relabelling moved expectations across ten test files in deliberate lockstep, counted by diff rather than estimated. Two consequences were accepted rather than hidden: the day header now reads "Syracuse, Nepal" (`country` is a leg id driving currency and offset, not a display label), and `/map`'s default camera, hardcoded to the Kathmandu→Tokyo region, no longer contains Day 1's pin, so those stops sit off-screen until you fly to them. Both are logged for a follow-up decision.

The map now works offline without having to be opened online first. The maplibre engine (1.01 MiB across two chunks, under the owner's 2 MB bar) is precached at install. Previously `/map` only survived a flight if you happened to visit it while connected, a ritual no user could have known about. What this does not buy is basemap imagery: tiles are cross-origin and the service worker passes those through uncached, so offline you get your pins and your day's route on the styled canvas with no street artwork and no marker numbers. Bulk-caching a free keyless tile CDN was rejected. The landing copy says exactly this and no more.

Corrects a protection this project believed it had. The map error boundary was documented, in a locked decision, a component docblock and a test comment, as catching the missing ~1 MB engine. It never did and could not: the engine is loaded by an `await import()` inside an effect, and a React error boundary sees render-phase throws, not rejected promises. What it actually catches is the smaller island chunk. The build gate that enforces the boundary survives the precache reversal, now keyed to "renders a map island" rather than "we withheld its chunk", and it fails loudly if either input set comes back empty.

The web-search leg is deleted, not disabled. Its provider's terms had disqualified it months ago, but the code remained and would re-arm the moment anyone provisioned a key, so every single deploy carried a standing precondition that the deploy command could not check. Gone: the module, its 34-test suite, the key field on both env interfaces, the prompt paragraph, and every mention in config and docs (net −656 lines). The concierge disclosure no longer claims search, and a compact privacy label, "Sent to a third-party AI — nothing stored here.", now sits by the input with its own screen-reader association. Two mutation-proved tests keep the leg gone: one asserts the outbound host set is exactly the model provider's even with a provisioned key, the other greps every source file for the provider's name. A mutation that re-arms to a different host with the key name assembled at runtime fails the first and passes the second, which is why both exist.

The concierge can serve any trip once the worker is deployed. Its persona is now built per request from an optional trip descriptor, and an absent or malformed one degrades to the current prompt rather than erroring. At this release the client gate was deliberately still closed, behind a single documented constant; it was opened in `v5.11.2`, once the worker it depended on was live. Opening it before the worker deploy would have put the concierge on a custom trip still speaking as the Nepal × Japan guide with this trip's date fence, and every change it proposed would have been silently discarded, because op validation checks dates against the active trip's calendar. The descriptor is also sent *only* for non-default trips: passing one for this trip would select the generic prompt and drop the local-knowledge paragraph, quietly making the answers worse.

You can claim items stamped with your old name. Renaming yourself left earlier items attributed to the previous name, so one person appeared as two in the traveller filter. A Settings action rewrites those stamps, but it shows the count first, because the old default name is also the app's login placeholder, which makes a stored "Traveler" ambiguous between you and anyone who signed in before their name resolved. The count is the safeguard: it hands that ambiguity to the only person who can settle it. Timestamps are preserved so claimed items do not flood "Recent changes". Expenses and documents are not rewritten, because their name fields include who paid and how a bill was split, and silently rewriting those would re-point who owes whom.

Bulk move can be undone. It was the only destructive bulk action without an Undo, while its delete and clear-day siblings both had one. The inverse addresses the ids the items actually landed under, not the ids they started with. Under sync a move mints new ids, so an inverse built the obvious way would have produced an Undo toast that did nothing, which is the exact defect fixed in the concierge one release ago.

The concierge's error row is accessibility-tested for the first time. Its axe scan had only ever run on the panel's empty state, so the "Try again" row had never been checked. It now is, and the scan is mutation-proved to actually fail when something is wrong. That is worth stating because a predicted violation did *not* reproduce for a subtle reason (the relevant rule is unreachable inside a dialog), and an unproved zero would have been worthless.

Also: the project's own contract demanded a dark/light toggle that a locked decision forbids. Three stale clauses, one of them in the QA checklist, were instructing the reviewer to verify a control that does not exist.

Gate, run in full on the merged tree: app typecheck 0, worker typecheck 0, 1719 unit tests / 151 files, 104 worker tests, `npm run build` green with 158 precache entries, and the full chromium end-to-end net. A printable itinerary was declined by the owner and is not built.

---

## v5.9.2 (app) — 2026-08-03 · **LIVE**

A shared trip is no longer empty for the person you shared it with. Patch release; no contract change.

- Fixed: creating a trip usually never published its metadata. The create handler fired the remote push and navigated immediately. The push first had to load a ~456 kB module and complete a connection handshake before the write was even issued, and the page unloaded in 370–740 ms, killing the write in flight. The creator saw nothing wrong (their copy is local); the joiner's `/plan` rendered no day cells for their whole session. Measured, not inferred: the meta doc was absent after 20 s of polling on 5 of 6 creates, while the identical call without navigating landed in 179 ms. Create now awaits its pushes under a 5-second budget (`Promise.allSettled`, so a dead network can never block creating a trip), then navigates regardless.
- Fixed: the joiner-side self-heal could dead-end. It marked its sessionStorage guard *before* checking whether it had found anything, so a joiner who looked one second early stayed broken for the whole browser session, even after the owner repaired the trip. The guard is now set only when a doc was actually found. (Renaming a broken trip also fixes it, since rename does not navigate; re-verified live 9/9.)
- Fixed: the `/map` offline banner claimed "showing cached map tiles". The service worker passes every cross-origin request through untouched, so those tiles are never cached, and the copy now says so.
- Docs: the worker's README no longer contains an instruction that would re-arm the disabled search leg. A `secret put` step sat five lines below the step requiring that secret's deletion.

Known, not closed by this release: a second create path in the settings panel never pushes trip metadata and then reloads, which is the same defect, deterministic, on a second surface (filed as a follow-up); a joiner's first `/plan` load can still render the default 33-day calendar until a reload; same-item concurrent-edit tie-break behaviour remains unproven live.

---

## v5.9.0 (app) — 2026-08-02 · **LIVE**

The mirror went from `v5.7.0` straight to `v5.9.0`, so this release contains everything in the never-deployed `v5.8.0` block below plus the work here. Do not assume `v5.8.0` ever ran. Minor, not patch: the installed-PWA contract changed for existing users, with precache 80 → 155, and a cold-offline install went from crashing every route to rendering the app.

- Fixed: a cold-offline install crashed every route. The service-worker precache was built by scraping route HTML, and client-only islands are by construction absent from that HTML, so the app's entire chrome (navbar, footer, tab bar, quick-add, and four more islands) was silently dropped. The first-ever page load fetches its chunks before the SW controls the page, so install → go offline = a bare crash card on every route, while browsing two pages online first masked it completely, which is why every manual check passed. The offline regression test was itself satisfied by the crash screen (it only asserted a visible, non-empty `h1`) and was rewritten to fail on it, before the fix.
- The precache seed is now derived from the build's loadable manifest plus the static import graph (never hand-listed) and widened to every page, while keeping ~600 KiB of Firebase and ~1 MiB of maplibre out of the shell. The map islands whose chunks are withheld are wrapped in a real React error boundary so the map pane degrades to a named surface instead of taking its route down; the build now throws if a withheld island is left unwrapped; the offline check asserts 16 derived routes (2 skipped with stated reasons).
- Concierge: the "What's the plan for tomorrow?" starter chip is now answerable. The trip digest carries one trip-local date line, a client-only change with no Worker deploy. An edge-side clock would have been wrong: UTC is the wrong calendar day for NPT (+5:45) or JST (+9) for part of every night.
- Landing-page product shots re-taken. Two of three still showed a control removed from the planner, and they now match the shipped UI.
- Decision-log cleanup: 19 stale entries corrected, several of which still prescribed values for a component deleted releases ago.
- Publishing-pipeline repairs (public mirror): the scrub patterns missed letter-suffixed ids (74 lines across 28 files had slipped through), `.npmrc` bypassed both scrub and scan, a failure could silently hide the workflow-drift check, and test directories were being mirrored. The patterns now derive from one shared map so the drifted copies cannot re-drift. Marker strings that had landed inside build-script template literals (which the scrubber, rewriting comments only, cannot reach) were stripped at source.

**Shipped:** mirror `main` HEAD `0a68d548d0784326b7fac6acef041901ade2004f`, confirmed via a live `git ls-remote` query (exact match), 2026-08-02 19:15:52 -0400. Pages deploy run #32 succeeded 2026-08-02T23:17:49Z, and the live site serves `5.9.0`. Checked against the deployed bundle (121 precached chunks scanned): the concierge URL is baked as the bare origin (no trailing slash, no path) in 2 chunks; Firestore sync is live, with the project id and API key baked into 1 chunk, so the six `NEXT_PUBLIC_FIREBASE_*` values are populated; no firebase reference in `index.html` (control: `_next` = 64 in the same file, so the check can fire). A previously published personal-data exposure is confirmed closed on the published tree, verified with a positive control (a common term still found) and a negative control (the older published commit still shows the removed values, so the zero discriminates).

---

## v1.7.0 (worker) — 2026-08-02 · **LIVE**

Contains everything in the never-deployed `v1.6.0` block below plus the change here. The deploy went from `v1.4.0` straight to `v1.7.0`.

- The Gemini leg is removed from the concierge ladder. The ladder is now `openai/gpt-oss-120b` → `openai/gpt-oss-20b` on Groq, with the unchanged all-legs-failed 502 (still no `model` field, because no model answered).
- Why removal and not demotion: a fallback leg still receives the full trip digest on every promotion, and the ladder logs nothing, so an intermittent exposure would have been unobservable. Gemini's free-tier terms state that human reviewers may read and process API input/output and forbid sensitive or personal information on the unpaid service, and the digest carries a real person's trip.
- Removed means deleted, not un-listed. The old leg had no key guard, so the digest left the edge even with the key absent. `GEMINI_API_KEY` is gone from both `Env` interfaces, `.dev.vars.example`, the `wrangler.toml` comment, and the README's `secret put` instruction. Re-arming now requires a code change, not a provisioned secret, and the test suite pins the Groq endpoint positionally and asserts the removed host absent, so a leg re-inserted ahead of Groq fails.
- Deploy hygiene: `TAVILY_API_KEY` and `GEMINI_API_KEY` were both deleted from the live Worker before this deploy, confirmed by a fresh `wrangler secret list` returning `GROQ_API_KEY` alone, and at runtime by `[search] no-key` logged alongside the new version id. Outstanding: the Gemini key itself has not been revoked at Google. Deleting the Cloudflare secret only makes the credential unreachable from this Worker, not invalid.

**Shipped:** version id `6985daf5-4360-47bd-89d5-49523d9e6f86` at 100% traffic, deployed 2026-08-03T00:30:41Z. Live-probed after deploy: `POST /chat` → 200 on `openai/gpt-oss-120b` with zero Gemini involvement; `GET /resolve` on a valid Google link → 200 `ok:true`; a non-Google host and an `evil-google.com` lookalike → 400 `unsupported url`. A subtlety worth recording: a Secret Change on 2026-08-01 minted a new version id `f3e8f21b-7857-42d9-9075-bf790bdbed64` carrying the previous code (`27fd618d`, deployed 2026-07-28), so the version serving traffic immediately before tonight was `f3e8f21b`. Version id and code revision do not always move together. Live secrets now: `GROQ_API_KEY` only.

---

## ⛔ v5.8.0 (app) — BUILT 2026-08-01 · **NOT DEPLOYED · NOTHING BELOW IS LIVE**

Never shipped as its own version, superseded before deploy. The app went `v5.7.0` → `v5.9.0` on 2026-08-02, and that release contains everything in this block. The version was bumped and this note filed at build time, because a silently undeployed version is how a reader ends up debugging production against code that was never there.

Three claims in the `v5.7.0` entry further down are corrected by this build:
1. Guest mode is deleted. No guest identity, no sandbox scope, no "Keep this trip" conversion, no "Explore the demo". A logged-out visitor gets a marketing landing page and an auth form, nothing else.
2. "User Token" is renamed "your key" across 24 user-visible sites; the old name survives only in code comments.
3. Sign-out is now a full local teardown, reversing the earlier "identity only" rule: identity plus the active trip, sync code, known/removed trips, and every trip-scoped key in both storage namespaces (the default pack's bare `nepal_japan_*` literals as well as `trip:*`). With no email and no password, sign-out on your only device is irreversible, and the confirm now says so. A separate "Forget this device" additionally clears the IndexedDB photo store.

**Privacy / content**
- Real personal booking data scrubbed from the public bundle: flight numbers and seat strings deleted outright, hotel street addresses and postcodes reduced to area level, and the prose content rewritten. Structure and item ids/dates/categories/times are unchanged, so the flights page and its integrations stay exercised on fictional same-shape values. (Not live until the mirror push; shipped with `v5.9.0`.)

**Front door and visual identity**
- Guest mode deleted (above), plus the `/travel` redirect loop it left behind: a signed-out visitor carrying a stale `travelMode` flag was bounced into an inescapable loop. Fixed, and the flag joins the sign-out wipe set.
- A marketing landing page at `/` with three device-framed product shots at 390/768/1440, generated against a fictional sample trip and fed through the existing AVIF/WebP/JPG pipeline. The show-once key screen gained a required "I've saved my key" checkbox gating Continue.
- The visual overhaul: new dark ramp, Geist plus a conditional Instrument Serif display face (gated on a font-leak audit that found and repaired four leak sites), retuned radii, elevation and motion durations, then a three-bucket palette reconciliation (cyan for interaction, gold for status, ink for decoration) swept twice, the second time against the merged tree.
- Motion cleanup: the reveal fade is floored instead of opacity-pinned, and the aurora / grain / ambient-drift decoration plus all four infinite animation loops are gone. The floor shipped at 0.95, not the planned 0.7, because 0.7 multiplies straight through the AA text floor and composited to a real `color-contrast [serious]` failure on five accessibility checks. Honest consequence, logged not hidden: at 0.95 the fade is near-imperceptible, and a visible fade needs a different mechanism (fade a decorative layer, not the text container) rather than a different number.

**Planner**
- The composer half of the planner redesign: a sticky quick-add composer under the day header with inline time parsing. Type `7pm dinner`, press Enter, done. It delegates to the existing pinned time parser so all time knowledge stays in one place. The item editor collapses to 3 visible fields behind a native `<details>` disclosure (joined to the focus trap so Tab cannot escape). The dashed full-width "Add Activity" CTA is gone, and a compact "Details" control keeps the blank-editor path. The map-pick / chrome half is separate, later work.
- Known and deliberately accepted: on mobile the composer placeholder reads `Add a plan…`, so the `7pm dinner` syntax has no visible affordance at 390 px. The hint moved to the accessible name because the full placeholder truncated mid-word.

**Place import and the Worker**
- Worker `GET /resolve`: the Google host allow-list duplicated server-side, redirects followed, the response body never read, no Google API key. Client-side, place import now carries lat/lng into the plan item, mirrors the allow-list, explains rejections for non-Google links, and builds coordinate-first outbound map links, which completes link → pin, the actual reported bug.
- A live-breaking regression fixed inside the wave, before deploy: the Worker briefly gated chat on `pathname === '/chat'` while the client posts to the bare origin, so every chat request would have 405'd. Worker `v1.5.0` was never released and must not be.

**Concierge**
- Real rendering: a two-pass block grouper for lists / fences / headings / paragraphs (the literal typed bullet glyph is gone), a system code face, three starter chips, and the chat's first browser test coverage.
- Sharper prompt and a richer trip digest: itinerary start times and categories, with the coupled caps raised to fit, plus a trip-date drift guard that fails loudly when the pack is restructured. (Naming correction, to avoid a false impression: "time-aware" here means item start times, not today's date. The concierge still had no current-date source while the UI offered a "What's the plan for tomorrow?" chip. That gap was closed in `v5.9.0`.)
- The model-visibility chip: every successful reply names the model that produced it, stamped by the Worker from its own constant, never by asking the model what it is. Absent on the all-legs-failed 502. This was the ladder's first observability of any kind; a permanently-dead primary leg was previously invisible.
- The provider-disclosure copy is a correction, not a feature. The old line said "This conversation is local to this session only", which reads as a privacy assurance while meaning only "not persisted locally". It now states plainly that messages and trip details go to third-party AI and search services that may retain and review them on free plans, names the answering model, and keeps the true half ("Nothing is stored here; the chat clears on reload"). The disclosure and the outbound request are gated by the same switch in the same component, so they ship together or neither ships.
- Grounded web search is built and merged but deliberately not shipped. The Worker would run one web search itself and inject results into the unchanged structured call, because the provider's search grounding and forced structured output are mutually exclusive; "just turn on grounding" would have silently destroyed the plan-editing feature. The leg activates solely on the presence of `TAVILY_API_KEY`, which is kept unprovisioned by standing decision (see the deploy preconditions below, where not shipping it is an action).

**Sync, perf, and enforcement**
- Firestore rule hardening: every create/update is shape-guarded and deletes are split out. (The planned document-size / field-count guard turned out not to exist as a rules primitive, so the shape guard replaced it.) Live two-device verification was still outstanding at this build.
- `@next/bundle-analyzer` behind `ANALYZE=1` to attribute the eager chunks against the measured baseline, with the unchanged precache count as the control proving the analyzer itself changed nothing.
- The Worker's typecheck and tests run in CI config for the first time, and the concierge category vocabulary is compile-time enforced in both directions: a category added on the client alone, or in the Worker alone, fails the typecheck naming the offending member. (Caveat, re-checked directly on 2026-08-02: that CI job executed in no repository this project pushes to. The public mirror carries no `worker/` directory and no CI workflow. It becomes live enforcement the day a remote carries the worker.)

**Deploy preconditions (all resolved at the actual `v5.9.0` / `v1.7.0` deploys):**
1. `TAVILY_API_KEY` deleted from the live Worker before deploying. Done, and the search leg gated solely on that secret and never activated.
2. The six `NEXT_PUBLIC_FIREBASE_*` values configured. Done, and confirmed baked into the deployed build.
3. `NEXT_PUBLIC_CONCIERGE_URL` has to be the bare origin, no path. A `/chat` suffix means place-resolve builds `…/chat/resolve` and is dead on arrival while chat keeps working, which is exactly how it would hide. The variable is inlined at build time, and note that the landing-page shots were captured on a build where it was unset, so they show the app without its AI.

---

## ⛔ worker v1.6.0 — BUILT 2026-08-01 · **NOT DEPLOYED · NOTHING BELOW IS LIVE**

Never shipped as its own version. The worker went `v1.4.0` → `v1.7.0` on 2026-08-02, and that release contains everything from `1.5.0` onward (`GET /resolve`, the bare-origin chat POST, the prompt/digest work, the dormant search leg, and this model stamp). Recorded because a silently undeployed version is how a reader ends up debugging production against code that was never there.

- The reply names the model that produced it. The Worker stamps `model` onto every successful `{reply, ops}` envelope, from the constant it called that leg with. Optional on the wire, and absent on the all-legs-failed 502, because no model answered.
- The model is never asked what it is. Models misreport their own identity, and the Worker already knows which leg it called. The raw provider id is used as-is, with no friendly-name map to go stale.
- The category vocabulary seam is compile-time enforced in both directions (see the `v5.8.0` block).
- CI config runs the worker's typecheck and tests for the first time; neither had ever run in any workflow.
- Ship command: deploy with `npm run deploy` from `worker/`, never `wrangler deploy` directly. Only `npm run deploy` runs typecheck + tests first and blocks a red build; a direct invocation bypasses both.
- Two independent preconditions rode on the same deploy, and doing either alone still ships the problem: delete the Tavily secret first, and land the Gemini-leg removal in the same deploy. Both were met before `v1.7.0` shipped, so the zero-exposure outcome held through the deploy.

---

## v5.7.0 (app) + v1.4.0 (worker) — 2026-07-28 · **LIVE**

Accounts & concierge wave. A two-token account model replaces the name-only front door, guests get the whole app in a private sandbox, and the AI concierge can finally edit the plan, renders properly, and follows you into Travel Mode. Storage schema unchanged, and no migration: a device that already had a sync code is silently already an account, and the three original travelers keep working with a one-tap account finish.

**Accounts: two tokens, never mixed**
- User Token = your account, holding many trips. It is the promoted sync code (same on-disk key, hence zero migration). The front door asks for it, or mints one via **Create an account** and shows it once with a save-this / never-share warning.
- Trip Token = access to one trip. Created with each trip, shareable, and usable only from `/trips` once logged in. You cannot log in with one.
- Logging in lands on `/trips`: select a trip · create a trip (mints its Trip Token) · add a trip by Trip Token.
- Settings' "enter a code" form is gone (login replaces it), and the old "Trip Key" / "Sync Code" names are retired app-wide, with a runtime test pinning the copy.
- Sign-out clears identity only, so the User Token stays on the device and signing out can never lock you out. *(Reversed in `v5.8.0`/`v5.9.0`: sign-out became a full teardown.)*

**Guests: full demo instead of a locked door** *(guest mode was later deleted, see `v5.8.0` above)*
- A guest could open every route and edit freely; every write was namespaced to a private sandbox scope, so demo edits could no longer pollute the real trip's local data (a real pre-existing defect, fixed at the root).
- Capability secrets and trip-mutating actions were hidden from guests entirely.
- **"Keep this trip"** converted an explorer into an owner: it minted a User Token and moved everything from the demo into a new trip of their own.
- Travel Mode stayed traveler-only, with its block moved into the route itself, covering every entry point.

**Concierge: it can actually edit the plan now**
- Root cause of "it can't modify my plans": proposed edits were silently discarded whenever the model echoed a date in the wrong format or year, or put the new date on an edit. Targets now resolve by item id, and an edit lands on the item's real day.
- Discarded suggestions are no longer invisible; the panel says how many didn't match.
- Worker prompt hardened: ISO date format and the exact trip window, copy the id exactly, use move (not update) to change days, a worked example, and an explicit "never tell the user you can't edit the itinerary".
- Replies render properly: numbered lists, nested bullets, inline and fenced code, bold/italic, real paragraph spacing, and links (href allow-listed, since model output is treated as untrusted at the render boundary).
- The input no longer loses focus after every send. It was disabling itself mid-reply; type → Enter → type → Enter now works with no pointer.

**Travel Mode**
- Per-day map: pins are exactly the selected day's plans and follow you as you change days; collapsed by default with a live "N of M stops pinned" count, so the map library only loads when opened.
- The concierge is now mounted in Travel Mode (it previously lived in the navbar, which Travel Mode hides).

**Also fixed**
- The content schema never learned the authored `Journey.departDate` / `Layover.verdict` fields, so content validation had been failing since they were introduced.

**Deploy targets:** Cloudflare Worker; GitHub Pages mirror.

**Shipped:** worker version id `27fd618d-7df5-4a3b-9776-ac87fb94a2fe` (CORS preflight verified); mirror `cd549dc..f65c16a`. Live build verified in a real browser from empty localStorage.

---

## v5.6.0 (app) + v1.3.0 (worker) — 2026-07-26

Simplicity wave: an iOS-like simplification pass across the whole app plus the AI concierge's upgrade to a plan-editing agent. Storage schema unchanged (still v5, no migration); default Nepal×Japan pack byte-identical.

**Travel Mode v2**
- Plan-card completion attribution: additive `doneBy`/`doneAt`, a "✓ Completed · name · time" footer on both agenda variants, synced cross-device via the existing per-item merge.
- `/travel` is checklist-first: the day's plans lead, static now/next strip, essentials collapsed into one native `<details>`, an offline/sync line, and an inline "Log something different" quick-add.

**Simplicity / IA**
- Mobile nav decluttered to a single bottom tab bar (hamburger deleted); 5-tab IA (Today · Plan · Map · Guides · More) with new `/guides` and `/more` landing routes; desktop top row consolidated 6 → 4.
- Content-first "Today" Home: hero reduced to one state-aware CTA, dashboard 9 → 3 temporal cards, timeline moved to `/plan`.
- `/plan` decluttered (money views behind an accessible segmented tablist; backup lives in Settings only); guide filters collapsed behind one "Filters · n" sheet on `/nepal` + `/japan`.
- Token repaint: glass tiers 6 → 1 (content de-glassed, nav keeps its blur), one gold chrome accent, fonts 3 → 1, shadows 6 → 2, ~14 sizes → 6, 17px body, hairline separators. Latent sub-AA content text floored to AA.
- Free platform polish: overscroll containment, tap-highlight removal, native keyboard-resize viewport, `prefers-reduced-transparency` fallback.

**Flight page**
- `/flights` made honest: dead placeholder panels removed, copy corrected (all flights + hotels booked), a "Check live status" rail with FR24 / Rome2Rio / Google deep links per journey.
- New `FlightJourneyCard`: phase strip, structured route (e.g. `KTM → NRT`), verbatim depart/arrive labels, proximity countdown, per-leg gate/confirmation chips, and human-authored layover verdicts, all derived from the existing trip clock with no label parsing.

**AI concierge → plan-editing agent**
- The Worker now emits schema-constrained `{reply, ops[]}` JSON on both provider legs; ops address itinerary items by stable id (add/update/remove/move, with no bulk-destructive verbs).
- The client validates ops (drop-invalid-silently), renders Confirm/Dismiss proposal chips, and only mutates the store on confirm, with an undo toast. Nothing changes on render.
- Trip digest raised to ~7000 chars (client + worker) so the concierge sees the whole trip; each item tagged with its stable id.

**Worker model swap**
- The Groq ladder moved off the soon-to-be-removed `llama-3.3-70b`/`llama-3.1-8b` (retired upstream 2026-08-16) to `openai/gpt-oss-120b`/`gpt-oss-20b`, the free-tier family that also supports strict constrained decoding, which the plan-editing contract relies on.

**Bug fixes**
- Custom trips now resolve their own leg city; xs hero fold at 360×740 (17px kept); map popup favorite button no longer intercepted by the fixed navbar.

**Deploy targets:** GitHub Pages mirror; Cloudflare Worker → 1.3.0 (the JSON plan-mode worker and the JSON client ship together, a coupled contract).

---

## v5.5.0 — 2026-07-24

Large release: three completed waves since v5.4.0 (multi-trip, tech-debt paydown, reliability) plus the place-link import's client side. Worker unchanged, staying at v1.1.0, so the import feature ships in manual mode and the optional `/resolve` resolver endpoint (v1.2.0) is a separate future deploy.

**Multi-trip**
- Custom trips: per-trip dates/vibe/destinations config, a new-trip wizard on the Create card, a universal vibe hero, and clean-slate empty itineraries. Default Nepal×Japan pack is byte-identical.
- Cross-device trip list via a personal **Sync Code**, with no Firestore rules change. Trip meta (name/dates) syncs on create/rename with joiner self-heal.
- Desktop **More** menu plus a visible command-palette trigger. 57 seed itinerary items back-linked with `sourceId` so "Added" badges fire on the built-in plan.

**Tech-debt paydown**
- Real **ESLint flat config** plus a CLI lint script (it was non-runnable). The service-worker generator now auto-discovers route HTML from `out/` and strips the legacy nomodule polyfill chunk.
- Expense-split roster derived from expense history on custom trips (fixed roster on the default pack). `/trips` metadata split, dead auth mocks removed, historical doc banners.
- **Trip forget** with Sync-Code tombstones (local forget plus a last-write-wins tombstone; it never deletes remote data). xs-hero fold fix; concierge gated to the default trip.

**Reliability**
- **Wake-lock** re-acquires after backgrounding (it was dying after the first). **Storage persistence** request plus a near-quota warning and a once-ever install-to-Home hint. **Service-worker atomic install** (it rejects on any precache miss, so the last-good cache survives a torn deploy) plus activation GC. localStorage write-quota failures surfaced.
- Clock-skew clamp on the sync clock bounds a wrong device clock (convergence preserved). Travel-Mode **trip-day** derives from the destination leg's UTC offset on the real clock; the Dec-19 Guangzhou layover instant corrected. Essentials honesty (NPR reference rate, weather age, offline deep-links).
- **Full-trip backup/restore lifeboat** (journal + photos, never-destroy import). React error boundaries via native `error.tsx`/`global-error.tsx`. `/travel` battery: four 1 Hz clocks consolidated into one shared tick. Unit coverage for presence/journal hooks.

**Place-link import, client side**
- Share/paste a Google Maps link → an always-manual **Import Place** confirm sheet (it works fully offline; a resolver merely pre-fills it). New **My Places** section on the guide/home surfaces, a paste-a-link entry and an "Import as place" action on `/share`, and a command-palette entry. Local-only storage domain; plan items reuse the existing recommendation source-linking (vault schema untouched).
- `calendar-planner.tsx` decomposed 1806 → 1332 lines into co-located hooks/subcomponents (zero behavior/visual drift).

**Deploy target:** GitHub Pages mirror. No worker changes (worker stays at v1.1.0).

---

## v5.4.0 — 2026-07-22

**Content: Nepal nightlife**
- Fixed the two dead/weak Kathmandu nights the previous pass missed: Dec 12 (Saturday, the leg's best club night) gained a Casino Royale → Club Deja Vu evening, and Dec 15 named its venue (House of Music) and extended into a Mazaaj Hookah Lounge close.
- Added 8 sourced venues to the Nepal nightlife roster: Club OMG, Prive Nepal, Casino Royale, Fat Monk's Rooftop Bar, House of Music, Shisha Lounge & Bar, Mazaaj Hookah Lounge, Fire and Ice (24h late-night food).
- Trimmed two pacing collisions against the Nagarkot/Phulchowki pre-dawn starts.

**Content: Japan nightlife**
- Breadth pass (the leg had no dead nights): added 34 sourced venues across Tokyo (clubs, karaoke boxes, standing-bar culture, jazz/whisky bars, themed novelty spots), Osaka (clubs, Hozenji Yokocho izakaya alley, standing sake bar), and Kyoto (atmospheric jazz/dive bars). The Japan nightlife roster grows 18 → 52.
- NYE note upgraded with WOMB's confirmed Dec 31 2026 countdown date/price.
- 7 repetitive nights gained an additive alternative-venue mention (existing named venues kept).

**Content: Photography guide**
- Added 22 Instagrammable spots (6 Nepal, 16 Japan), so the Photography Guide grows 12 → 34.
- Nepal: Bhaktapur, Patan, Chandragiri, Garden of Dreams, Thamel streets, Budhanilkantha.
- Japan: Osaka (Dotonbori/Glico sign, Osaka Castle, Umeda Sky Building, Hikari-Renaissance illumination), Kyoto (Gion/Hanamikoji, Nishiki Market, Philosopher's Path, Nara Park), Tokyo (Harajuku, Senso-ji, Tokyo Tower, Meiji Shrine, Odaiba, Nakano Broadway, Marunouchi & Tokyo Midtown winter illuminations).
- Verified illumination dates against the actual trip window; excluded 3 events that don't overlap (Roppongi Keyakizaka, Kobe Luminarie, Arashiyama Hanatouro).

**Feature: glance-able "already added" state**
- Place cards (Nepal/Japan recommendations, nightlife, photography) now show at a glance whether they're already in the plan, including which date(s), without opening the card. New "Planned" filter chip.

**Deploy target:** GitHub Pages mirror. No worker changes this release (worker stays v1.1.0).

---

## v5.3.0 (app) + v1.1.0 (worker) — 2026-07-21

**Fixes**
- iPhone "zoomed-in" bug on non-home pages and Travel Mode. The root cause was iOS Safari's auto-zoom on focusing form controls with font-size under 16px (app inputs were 14px). One iOS-only CSS rule in `globals.css` forces 16px form controls, and it applies app-wide.
- Concierge replies now render readably: line breaks preserved (`whitespace-pre-wrap`) plus markdown-lite rendering (bold, bullets, heading markers). Previously it was raw text with collapsed newlines.
- Nightlife content: removed the permanently-closed Robot Restaurant (closed 2023).

**Features**
- Concierge persona (worker v1.1.0): the first-ever system prompt, a "trip buddy" voice preloaded with the trip skeleton (Kathmandu Dec 9–18 → Japan Dec 19–Jan 9, nightlife-first vibe), plain-text replies, no AI-isms. The client now sends a ≤1500-char digest of the actual itinerary each turn so answers reference the real plan; outgoing history capped at 12 turns; worker body cap 8 KB → 16 KB, `context` server-side truncated at 2000 chars.
- Nightlife guide: named venue cards for Tokyo (Harlem, Club Camelot, ATOM, WARP), Osaka (Bambi, GHOST, Pure) and Kathmandu (Club Deja Vu plus the existing Thamel set); NYE note (the Shibuya street countdown is cancelled, so book a club or the Shinjuku Met-Gov countdown).
- Default itinerary: Japan club nights name a candidate venue plus a late-night food anchor (Ichiran/Nagi, Kinryu) and a last-train note; 4 Kathmandu evenings gained Thamel nightlife items.
- Travel Mode: a Japan-phase last-train chip (with the Dec 31 all-night exception) and a "Tonight" card surfacing today's evening plan.

**Deploy targets:** GitHub Pages mirror; Cloudflare Worker.

---

## v5.2.0 — 2026-07-20 (retro entry)

Trip registry + `/trips` hub, home trip strip, service-worker precache content-hash fix (stale-shell window closed), mirror deploy workflow env-var fix + drift guard, iPhone zoom runbook.
