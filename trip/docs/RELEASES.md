# Releases

Every live deployment gets an entry: version, date, what shipped, deploy targets. Newest first.

Not every entry is live. An entry headed **NOT DEPLOYED** is a build that exists in the repo and has never run anywhere. The newest live app is `v5.14.0` and the newest live worker is `v1.8.0`. Worker `v1.9.0` is built and deliberately unshipped: it requires a signed token that only `v5.14.0` sends, so it can only go out after this client is live on every device. Read the heading before assuming a version is in production.

> After any merge intended for users, verify the deployment with `git ls-remote` plus a grep of the live artifact for a string only the new code contains. A push succeeding is not the same as the served artifact changing, and only the second half catches a push that targeted the wrong commit. (Lesson of `v5.9.2`: for 40 minutes a merged, green build was assumed live while the mirror had actually been pushed from an earlier commit.)

---

## v5.14.0 (app) — 2026-08-10 · **DEPLOYED** from `main` · worker stays at v1.8.0 (v1.9.0 is built and deliberately unshipped)

Access control, tier 2. The previous release made sure the person logging in was real. This one makes sure the *device* asking for a trip is one the trip knows about, and it moves the concierge from "you sent me a trip id" to a check Google performs.

Every device now signs itself in silently the first time it syncs. That identity is anonymous, free, and invisible — you are never asked for anything — but it is a stable name the trip can hold, which is the thing the app has never had. It survives reloads, it survives signing out of the app (deliberately: the identity belongs to the browser, not the login), and it can optionally be linked to a Google account so you can get it back after clearing your browser data or changing phone. Linking preserves the identity rather than replacing it, which is the whole reason to offer linking rather than a sign-in. If you link an account you already used on another device, the app offers to adopt that identity here instead — that is the lost-phone path.

A trip can now hold a list of the devices allowed to open it. It is opt-in per trip, and it has to be: rules changes take effect instantly and globally, so a mandatory list would have shut every existing trip and every share link already sitting in someone's chat history, with no way back in. A trip you create is locked to your device from the moment it is created. A trip that predates this becomes locked the first time one of your devices opens it, and that device becomes its owner — after which the other travellers need adding. Settings has a new "Trip access" section with your device's code (send it to a friend, they paste it in), the list of devices on the trip, and — for the owner only — a way to remove one. If you open a trip you are not on yet, the app says so in one sentence and tells you where to fix it, rather than showing you an empty trip and letting you conclude the data is gone.

Two smaller things fell out of that and are worth naming. The presence heartbeat used to retry a refused write once a minute forever; it now stops after the first refusal and says why once. And the presence layer no longer starts its own copy of Firebase — it shares the one every other sync path uses, which is what guarantees it never writes before the sign-in it depends on has finished.

The concierge now sends a signed token with every request. The Worker verifies it by reading the trip document from Firestore as *you*, so the same rules that guard the app guard the concierge, and there is no second copy of the access model to drift. That half fails closed. This half is careful about ordering: the token is attached only when there is a session to attach, so a build with no sync configured — which includes the entire browser test suite — sends exactly the request it sent before, and the Worker's requirement can be switched on only once a client that satisfies it is actually live.

**The client is live; the two halves that enforce it are not, and that order is deliberate.** With the old rules still in place the app simply signs in and writes a membership list nothing is yet checking — which is exactly what makes it safe to ship first, and exactly why shipping it does not on its own close anything. Three things must follow, in this order, and each is a manual owner action:

1. **Rotate the shared trip onto a fresh id.** Until this happens the old trip id — which shipped inside the public bundle for months — still reaches real data under the old rules. This release stops the app from using that id, so the shared trip is local-only on every device until the rotation is done and everyone rejoins by link. Local data is untouched; so is the remote copy.
2. **Everyone opens the app on every device** while the old rules are still live. That is when each device mints its identity and adds itself to the trip. It cannot be done afterwards: once a trip carries a membership list, the new rules correctly refuse a device that is not on it.
3. **Publish the rules, then deploy worker v1.9.0.** Only after step 2 is confirmed device-by-device. Publishing early denies every read and write from any device still on an older build, because the auth floor those rules add did not exist before this release.

---

## v5.13.0 (app) — 2026-08-10 · **SUPERSEDED** — never shipped on its own; its changes went live inside v5.14.0

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

Known, and stated rather than buried: whether the concierge actually answers in production depends on the `NEXT_PUBLIC_CONCIERGE_URL` repository variable being set to the Worker URL above. If it is unset the feature stays inert and the app is otherwise unaffected; the deploy log prints `concierge-url present: yes/NO`. Also unchanged from the previous release: two Travel-Mode hero screenshots remain stale and are deliberately not regenerated, and a synced custom trip still has its leg coerced on read.

---

## v5.11.1 (app) — 2026-08-09 · bug fix

The countdown said "3 months 4 weeks 1 day." Reported by the owner, whose objection was that four weeks is a month and should have been carried. He was right that the display was wrong, and right about the cause being the week bucket, though not for the reason first assumed.

What was actually happening: after counting whole calendar months, the leftover can be anything from 0 to 30 days, because months are 28–31 days long. Split into sevens, a 29-day leftover reads "4 weeks 1 day". The arithmetic was exact and the total time was never misstated, but nobody wants to read four weeks inside a month.

The leftover is now shown in days once it reaches 28, so that case reads "3 months 29 days". Every shorter leftover keeps the months/weeks/days shape. It is deliberately not rounded up to "4 months": that would overstate the wait by up to three days, and a countdown that misstates the date is worse than one that looks unusual.

A guard is now in place that would have caught this class of error, and it caught a worse one on the way. The first attempt at the fix re-anchored the maths on calendar dates, which looked right and passed every test written for it, while quietly double-counting the day you are standing in. Six hours before departure it would have read "1 day 6 hours"; a week out, "1 week 1 day 15 hours" for what was really 1 week 15 hours. Every displayed field was defensible on its own, and the total was wrong by a full day, every day.

It was caught by summing the displayed fields back into a date and checking they land on the trip start exactly, to the second, across 2,928 instants spanning a year, both daylight-saving transitions, and times of day either side of midnight, plus 12,000 more against non-midnight targets across a leap year. That check is now permanent. The lesson is the general one: the earlier tests asserted the two properties someone thought to ask for, and both stayed green while the total was wrong. The invariant nobody writes down is the one that breaks.

Also corrected: the "arriving soon" line on a flight card keyed off weeks alone, so with the week bucket suppressed a month-distant flight would have started showing a live hours-and-minutes countdown. It now checks days too.

---

## v5.11.0 (app) — 2026-08-09 · **NOT DEPLOYED** · worker unchanged at v1.8.0 (also never deployed)

Three owner rulings, each of which changed shape once the code was actually read. The worker is untouched by this release; its own deploy is still outstanding from v5.10.0.

The map's search box now finds any place in your trip. It previously knew only the 27 curated guide locations, so Syracuse, the departure city as of the last release, could not be reached by name at all. Search now also covers the cities the trip actually visits and the stops you have planned yourself, and results say which of the three you are looking at. The stated ceiling, which the owner accepted rather than had imposed on him: somewhere you have never planned will not resolve. Making arbitrary world places work needs a geocoding service, and the free keyless ones forbid search-as-you-type, so it is a design decision rather than a switch. A test asserts that an unknown name returns nothing *and* that no request URL contains what was typed, which pins the ceiling against a future change quietly turning it into a network call.

What this release does not do is widen the default map view, which is what the owner originally asked for. The constant that was to be widened turned out to be read once when the map is constructed and overwritten a frame later by a fit derived from the data, so changing it would have looked like a fix and done nothing. Its comment now says so. The consequence that *is* real, that turning the itinerary overlay on fits a route spanning about 217° of longitude, is recorded and deliberately untouched, because no one has ruled on what it should do instead.

The day header no longer says "Syracuse, Nepal." `country` on a day is a leg identifier that selects currency and the day's time offset. It was never a label, but eleven separate places hand-rolled it into one anyway. There is now a single helper, and a day can carry its own label (Dec 9 says USA). Two of those eleven sites were worse than the one that prompted this: they printed "Tokyo, Japan" on every day of every custom trip. The rule is structural rather than cosmetic. The leg label is appended only on a multi-leg trip, so "Bali, Japan" and "Bali, Bali × Lombok" are both unreachable by construction rather than filtered out by string comparison.

That fix came within one merge of silently reverting on every synced device. The new per-day label uploads to the database intact, because the write path passes everything through. But both read paths rebuild a day from a fixed four-field list, and the label was not on it, so it would have been discarded on the first sync and the header would have gone back to "Syracuse, Nepal", with every test on the build machine still green. Both boundaries now carry the field. It is a pass-through, not a default: the frozen mapper contract holds and its pinned suite needed no edits.

You can now claim your old name on expenses and documents, and it cannot move any money. The previous release added this for itinerary items only. It now also rewrites the "logged by" stamp on an expense and the attribution stamp on a document, and it deliberately never touches who paid or who a bill was split with. The owner asked for the wider version and then narrowed it himself once shown why: the settlement maths de-duplicates split members before dividing, so renaming yourself into a split you are already in collapses two people into one, drops the divisor and re-points the balances. In a seeded case that is a real 1500 NPR debt disappearing. A test asserts the settlement output is byte-identical across a claim, and it was verified by deliberately breaking it and watching it fail.

A guard we shipped last release was weaker than it read. The money test pinned the two payment fields, which is what settles, but the spend totals also read an expense's *category*, which the settlement maths never sees. Corrupting `category` on every claimed row left the money guard, the settlement check and both sync proofs green. The assertion now derives which fields changed by diffing the records, so a field added later is covered without anyone remembering to add it. The general form is worth more than the fix: a hand-listed "this must only touch X" check covers exactly the fields whoever wrote it thought of.

Known and not fixed here: two Travel-Mode hero screenshots have been stale since the Dec 9 relabel in the previous release and are left failing rather than regenerated, because a second unexplained difference appeared alongside the expected one, and blessing an unexplained screenshot is how a real regression becomes permanent. A synced custom trip still has its leg silently coerced on read, which is wrong currency and wrong time offset rather than cosmetics; it is reported, out of scope, and needs its own slice. The map search panel's left edge sits 4.9px off-screen at 390px from its own centring maths, pre-existing.

---

## v5.10.0 (app) + v1.8.0 (worker) — 2026-08-06 · **NOT DEPLOYED**

The owner ruled on all eight parked questions, and this release implements them. Neither artifact has been deployed. The worker half in particular cannot reach a user until the owner runs `npm run deploy` from `worker/`; see the ordering note below, which is a correctness constraint rather than a preference.

Says the true time zone on the nine flight-day items. Nine seeded items carry a per-item zone (the Syracuse/JFK legs, the Delhi layover, Guangzhou, the Detroit layover home). The app badged them with the *day's* country, so the Jan 9 Detroit layover read "3:35 PM JST", 14 hours wrong. The previous release suppressed the badge as harm reduction; it now names the real zone (EST / IST / CST), resolved from an offset table. The displayed time is unchanged and is still wall-clock-at-place, so only the label moved. An offset with no table entry shows no badge rather than an invented one. Known ceiling: the table maps a UTC offset, not a zone id, so it is sound only because `-300` occurs here solely in December and January and the Asian zones observe no DST. A summer-dated trip needs real zone ids first (D-137 amendment).

Dec 9 is Syracuse, not Kathmandu. The first day was labelled with the destination while actually being spent in Syracuse, JFK and the air. The day's city, weather, header and concierge digest all follow the label, so relabelling moved expectations across ten test files in deliberate lockstep, counted by diff rather than estimated. Two consequences were accepted rather than hidden: the day header now reads "Syracuse, Nepal" (`country` is a leg id driving currency and offset, not a display label), and `/map`'s default camera, hardcoded to the Kathmandu→Tokyo region, no longer contains Day 1's pin, so those stops sit off-screen until you fly to them. Both are logged for a follow-up decision.

The map now works offline without having to be opened online first. The maplibre engine (1.01 MiB across two chunks, under the owner's 2 MB bar) is precached at install. Previously `/map` only survived a flight if you happened to visit it while connected, a ritual no user could have known about. What this does not buy is basemap imagery: tiles are cross-origin and the service worker passes those through uncached, so offline you get your pins and your day's route on the styled canvas with no street artwork and no marker numbers. Bulk-caching a free keyless tile CDN was rejected. The landing copy says exactly this and no more.

Corrects a protection this project believed it had. The map error boundary was documented, in a locked decision, a component docblock and a test comment, as catching the missing ~1 MB engine. It never did and could not: the engine is loaded by an `await import()` inside an effect, and a React error boundary sees render-phase throws, not rejected promises. What it actually catches is the smaller island chunk. The build gate that enforces the boundary survives the precache reversal, now keyed to "renders a map island" rather than "we withheld its chunk", and it fails loudly if either input set comes back empty.

The web-search leg is deleted, not disabled. Its provider's terms had disqualified it months ago, but the code remained and would re-arm the moment anyone provisioned a key, so every single deploy carried a standing precondition that the deploy command could not check. Gone: the module, its 34-test suite, the key field on both env interfaces, the prompt paragraph, and every mention in config and docs (net −656 lines). The concierge disclosure no longer claims search, and a compact privacy label, "Sent to a third-party AI — nothing stored here.", now sits by the input with its own screen-reader association. Two mutation-proved tests keep the leg gone: one asserts the outbound host set is exactly the model provider's even with a provisioned key, the other greps every source file for the provider's name. A mutation that re-arms to a different host with the key name assembled at runtime fails the first and passes the second, which is why both exist.

The concierge can serve any trip once the worker is deployed. Its persona is now built per request from an optional trip descriptor, and an absent or malformed one degrades to the current prompt rather than erroring. 🔴 The client gate is deliberately still closed, behind a single documented constant. Opening it before the worker deploy would put the concierge on a custom trip still speaking as the Nepal × Japan guide with this trip's date fence, and every change it proposed would be silently discarded, because op validation checks dates against the active trip's calendar. The descriptor is also sent *only* for non-default trips: passing one for this trip would select the generic prompt and drop the local-knowledge paragraph, quietly making the answers worse.

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
