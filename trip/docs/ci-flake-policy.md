# CI Flake-Quarantine Policy

_Slice S88 (M15/v3 Phase A). Owner: test infra (per S80/D-093)._

This policy exists so the enforcing **"No Green, No Deploy"** gate cannot be
blocked by a known *environmental* flake, while never weakening or deleting a
real spec. That gate is the `e2e` job in `.github/workflows/ci.yml`, which runs
on pull requests into `dev` and `main` and whose behavioural step carries no
`continue-on-error`, so a failure fails the run. `.github/workflows/deploy.yml`
is the release path and runs no test suite at all. Its jobs are `version-gate`,
`markers` (the repository-hygiene marker check), `build` and `deploy`, so "no
green, no deploy" is enforced at the pull request, not at the push to `main`.
This policy governs how CI treats a test that fails intermittently for
non-product reasons.

> Guiding rule: a flake is quarantined, never silenced. We keep the assertion
> exactly as strong as it is and change only *how the runner reacts* to a
> non-deterministic environment. If a failure is a real regression the gate has
> to stay red. Retries and quarantine apply only to failures with a documented
> environmental signature.

---

## 1. The known flake: D-093 (CRUD-then-reload under load)

**Specs:** `e2e/persistence.spec.ts`
- `:131` _create an item, reload, it survives (hasStoredPlans becomes true)_
- `:161` _edit an item title, reload, the new title persists_
- `:224` (CRUD-reload family)
- `:254` (CRUD-reload family)

**Signature (how to recognize it):** after a `page.reload()`, the just-rendered
calendar card is transiently not found:
`locator('[data-testid^="calendar-item-"]') … resolved to 0 elements`, a
DOM-detachment / element-not-found error immediately following a reload. It
surfaces under sustained load (the full pack, or repeated runs), and the same
assertion passes on an isolated re-run or on retry.

**Root cause (environmental, not a product bug):** `/plan` lazy-mounts
`CalendarPlanner` via `next/dynamic({ ssr:false })` behind a `SectionSkeleton`
fallback, and the app registers a service worker. A reload under load can catch
the brief remount window where the freshly-hydrated agenda is replaced, detaching
the node Playwright was about to assert on. That is a harness/timing interaction
between the lazy mount and the service worker, not a persistence defect: the
`localStorage` write/read itself is correct (unit-covered in `lib/`, and the same
behavior is stable in isolation). Recorded as D-093. The deeper fast-follow
(portal/settle the `ItemEditor` and the lazy-mount remount) is tracked separately
and sits outside this slice's fence, so no app or spec code is touched here.

**Verified behavior (S88 local proof, dev sandbox):**
- Full pack once: `:131` + `:161` failed (2 failed), the flake under load.
- `persistence.spec.ts --retries=2`: `:131` reported **`1 flaky`** (failed attempt 1,
  passed on retry), `:161` green, **6 passed, 0 failed**. So retries recover it.

---

### S114 update: root-caused and de-flaked at the source (FU-15)

The flake is now fixed deterministically; retries are no longer the mechanism for
these specs. Two findings on the current tree:

1. **S113E (`4026d29`) shrank the remount window.** The original signature
   (`calendar-item-* resolved to 0 elements` right after a reload) was a
   node-detachment race driven partly by the service worker's first-install
   `clients.claim()` reload, a spurious ~200ms post-load full re-hydration that
   double-mounted the tree. S113E guarded that reload (`hadController` in
   `components/service-worker-registrar.tsx`) so it fires only on a genuine update,
   not first install. After S113E the detach signature no longer reproduces.

2. **The real remaining culprit was `waitUntil: 'networkidle'`.** Re-measured on the
   post-S113E tree with `persistence.spec.ts --repeat-each=20 --retries=0` on the
   served dormant `out/`, the flake resurfaced under load as a `page.goto … waiting
   until "networkidle"` timeout (1 failure in 120 runs), not a card detach. The
   production service worker precaches ~80 entries on install and runs periodic
   update checks, so the network never reliably goes quiet for 500ms under
   sustained load. `networkidle` is simply not a deterministic settle signal for
   this app.

**Deterministic fix (no retries, no sleeps, no weakened assertions):** the spec's
`gotoSettled`/`reloadSettled` helpers now navigate with a bounded
`waitUntil: 'domcontentloaded'` and then block on a real app-readiness signal.
That signal is `waitForPlannerReady`, which waits for the lazy `CalendarPlanner`
island's `calendar-day-*` grid to be present, i.e. for the
`next/dynamic({ssr:false})` island to have hydrated and replaced the
`SectionSkeleton` (which is `aria-hidden` and never renders a `calendar-day-*`).
Every persistence assertion is byte-for-byte unchanged (D-101).

**Proof:** `persistence.spec.ts --repeat-each=20 --retries=0` gives **120 passed, 0
failed** on the served dormant `out/` (vs 1 failed pre-fix). Retries (section 2)
remain in config as a generic backstop but are demonstrably not load-bearing for
these specs.

---

### S167 update: the sweep, every spec is now off `networkidle` (FU-26)

S114 fixed only `persistence.spec.ts`. S167 finishes the job: no live `goto`/`reload`
in the E2E pack uses `waitUntil: 'networkidle'` any more. The root cause (the SW
precache means the network never idles for 500ms under load) is the same for every
spec that navigates the app, so the same deterministic pattern is applied everywhere:
navigate with `waitUntil: 'domcontentloaded'`, then wait on a real app-readiness
signal before the first assertion.

Two shapes, both preserving every assertion byte-for-byte (D-101):

- **Drop-only** (`budget`, `burn-rate`, `expenses`, `export-import`, `today`,
  `today-next`, `weather`, `recap`, `journal`): each already ran a real settle helper
  (or an auto-waiting `toBeVisible` on a rendered testid) after the nav, so
  `networkidle` was pure redundant flake. The `waitUntil` is simply changed to
  `domcontentloaded` and the existing settle carries the readiness guarantee.
- **Added readiness wait** (`a11y-intrip.spec.ts`, the spec that actually flaked in
  S117, an axe scan racing a pre-hydrate frame): the `gotoInTrip` helper now navigates
  `domcontentloaded` and then blocks on the route's in-trip dynamic island
  (`/plan/` → `budget-panel`, `/` → `today-panel`) before the axe scan.

The comment-only `networkidle` references that remain in the pack (`smoke.spec.ts`,
`nightlife-gate.spec.ts`, `a11y.spec.ts`, `visual.spec.ts`, `pwa.spec.ts`,
`interaction.spec.ts`, `motion.spec.ts`, and this doc) are policy prose documenting
why those specs avoid `networkidle`, not live nav calls. `grep -rn "waitUntil:
'networkidle'" e2e/` returns zero live `goto`/`reload` calls.

**Proof:** `a11y-intrip.spec.ts` + the `/plan` budget family at
`--repeat-each=20 --retries=0` on the served dormant `out/` gives 0 failures, and the
full pack reconciles to its prior pass count with 0 assertion changes.

---

## 1a. The E2E build has to be dormant, no live Firebase (FU-25)

The whole `networkidle`→`domcontentloaded` migration rests on one environmental
invariant: the E2E build is dormant. It runs with no `NEXT_PUBLIC_FIREBASE_*`
secrets, so there is no live `onSnapshot` connection. A live Firestore listener
holds an open streaming request, which would keep the network perpetually non-idle
(the original `networkidle` timeout would just move to a different cause) and,
worse, inject non-deterministic cross-tab sync into the persistence specs.

This is already true by design and must stay so. `ci.yml`'s `e2e` job deliberately
does not set the `NEXT_PUBLIC_FIREBASE_*` env. Its only build env is
`NEXT_PUBLIC_CONCIERGE_URL`, a non-resolving `.test` origin, unlike `deploy.yml`'s
production `build` job, which passes the Firebase secrets through.
S113E's fixtures identity flip made the pack depend on this dormancy (a guest-bypass
build with no Firebase config). All local de-flake measurement in S114/S167 was taken
the same way, on a served `out/` built with no `.env.local`.

**Guarantee (do not regress):** `ci.yml`'s `e2e` job stays dormant. Never add the
`NEXT_PUBLIC_FIREBASE_*` secrets to it. If a future slice needs the E2E pack to run
against live sync, it must first re-establish a deterministic settle signal that does
not depend on the network going idle. The specs' readiness waits already do this at the
per-nav level, but a live listener would still defeat any `networkidle` fallback.

---

## 2. Retry policy (the first line of defense)

`playwright.config.ts`:

```ts
retries: process.env.CI ? 2 : 0,
```

- **CI = 2 retries.** `ci.yml`'s `e2e` job sets `CI: '1'` on both Playwright
  steps, so every CI E2E run grants each spec up to two retries. The D-093 flake
  passes within that budget, so it is reported flaky (green run) rather than
  failed: the gate stays green and the pull request can merge.
- **Local = 0 retries** (unchanged). A bare local failure should surface
  immediately and honestly, not be papered over while developing.
- A test that passes on retry is a flaky pass. The run is green, but the
  flake is logged in the Playwright report (and, in CI, the report is uploaded on
  failure and the visual diff always). Flaky is not the same as ignored; see section 4.

Retries are the right tool because the flake is a low-frequency timing race that
clears on a fresh attempt. It is deliberately a *small* budget (2), not a
blunt-force large number: if a spec needs more than two retries to pass, that is a
signal the failure may not be the benign D-093 flake, so escalate (section 3).

---

## 3. Escalation: when retries are not enough (`@flaky` quarantine)

If a spec repeatedly flakes beyond the 2-retry budget in CI (i.e. it fails all
attempts on multiple runs) and the failure carries the documented environmental
signature from section 1 rather than being a genuine regression, quarantine it.
Do not weaken it:

1. **Confirm it's environmental, not a regression.** Reproduce in isolation
   (`npx playwright test e2e/<file>:<line>`) and inspect the trace/screenshot.
   If the assertion is genuinely wrong or the product broke, that is a real
   failure: fix the product or the spec, and let the gate be red. Quarantine is only
   for confirmed-environmental flakes.
2. **Tag, don't delete.** Add a `@flaky` marker to the spec's title (e.g.
   `test('… @flaky', …)`). The assertion body stays byte-for-byte unchanged.
3. **Split it out of the blocking run.** The blocking E2E steps already scope
   with grep; add an exclusion and a separate non-blocking job:
   - blocking step: `npm run test:e2e -- --grep-invert "@flaky"` (and keep the
     existing `--grep-invert visual`, combined as needed).
   - non-blocking step/job: `npm run test:e2e -- --grep "@flaky"` with
     `continue-on-error: true`, so the quarantined spec still runs and reports on
     every CI run (visibility preserved) but cannot block a deploy.
4. **File a fast-follow** to de-flake the root cause and remove the tag. A
   quarantine is a temporary holding pen with a ticket attached, never a
   permanent home. Quarantined specs are reviewed each milestone; an
   indefinitely-quarantined spec is a bug to fix, not a state to accept.

Never do any of these: delete a spec, loosen an assertion (`toHaveCount(1)` →
`toBeGreaterThanOrEqual(0)`), widen a timeout to hide a race, remove a reload, or
`test.skip` a real behavior. Those destroy the coverage the gate exists to
provide. The only sanctioned levers are retries (section 2) and non-blocking
`@flaky` quarantine (section 3).

---

## 4. Visual regression is separately non-blocking (related, not this flake)

Distinct from D-093: the visual pack (`e2e/visual.spec.ts`, grep `visual`) runs as
a separate `continue-on-error: true` step inside `ci.yml`'s `e2e` job (`deploy.yml`
runs no Playwright step at all), and the reason is mechanical, not cosmetic: the
committed baselines are named `-win32`, and Playwright's default snapshot path puts
the platform in the filename, so on a Linux runner the expected `-linux` baseline
does not exist and the comparison cannot pass at all. `visual.spec.ts`'s header
documents the same cross-OS caveat from the font-antialiasing angle. Either way it
is expected cross-environment drift, not a regression. This is a
non-blocking-by-configuration case, not a quarantined-flake case: the fix is to
commit `-linux` baselines on the runner (`--grep visual --update-snapshots`) and
then drop `continue-on-error`, not to retry. Listed here so the two "non-blocking"
mechanisms are not conflated.

---

## 5. Summary table

| Case | Signature | CI treatment | Fix / exit |
|---|---|---|---|
| **D-093 CRUD-reload flake** (`persistence.spec.ts`), fixed at source in S114 (FU-15) | was: card `resolved to 0 elements` (pre-S113E), then `page.goto "networkidle"` timeout under load (post-S113E) | ~~`retries: 2`~~ → now deterministic: navigate `domcontentloaded` + wait `calendar-day-*` island mounted; 120/120 at `--retries=0` | Done. S113E killed the SW first-install reload; S114 replaced `networkidle` with a real readiness wait |
| **`networkidle` nav flake**, all app-navigating specs, swept in S167 (FU-26) | `page.goto/reload … waiting until "networkidle"` timeout under load (SW precache never idles) | deterministic: `waitUntil:'domcontentloaded'` + a real readiness wait before the first assertion (drop-only where a settle already ran; added wait for `a11y-intrip`) | Done. Zero live `networkidle` nav calls remain in `e2e/` |
| **E2E build must be dormant (FU-25)** | live `onSnapshot` keeps the network non-idle + injects non-determinism | `ci.yml`'s `e2e` job omits `NEXT_PUBLIC_FIREBASE_*` by design (unlike `deploy.yml`'s `build` job); measure on `out/` with no `.env.local` | Guarantee: never add Firebase secrets to `ci.yml`'s `e2e` job (section 1a) |
| **Any spec flaking beyond 2 retries** (confirmed environmental) | fails all attempts across runs, but env-signature not a regression | tag `@flaky`, split to non-blocking job (`continue-on-error`) | de-flake root cause, remove tag |
| **Visual drift** (`visual.spec.ts`) | pixel diff on text AA across OS | `continue-on-error: true` (non-blocking) | commit `-linux` baselines, drop `continue-on-error` |
| **A real regression** | assertion genuinely wrong / product broke | the gate stays red; no retry or quarantine applies | fix the product or the spec |
