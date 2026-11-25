# CI flake policy

The behavioural E2E job (`e2e` in `.github/workflows/ci.yml`) blocks merges into `dev` and `main`.
This policy keeps a known environmental flake from blocking that gate without weakening or
deleting a real test.

A flake is quarantined, never silenced. Assertions stay exactly as strong as they are; only the way
the runner reacts to a non-deterministic environment changes. A real regression keeps the gate
red.

E2E runs on pull requests only. `deploy.yml` calls `ci.yml` for the full checks job
(markers, types, lint, unit, build, rules emulator) but runs no Playwright, so the browser suite is
enforced at the pull request, not at the push to `main`.

## 1. Settle on app readiness, never `networkidle`

The service worker precaches on install and runs update checks, so the network never reliably goes
quiet for 500 ms under load. `waitUntil: 'networkidle'` is not a deterministic settle signal for
this app, and no spec uses it for a live `goto` or `reload`.

Navigate with `waitUntil: 'domcontentloaded'`, then wait on a real readiness signal before the
first assertion: a rendered testid, or the lazy island the route mounts (`calendar-day-*` for
`/plan`'s `CalendarPlanner`, `today-panel` on `/`). `persistence.spec.ts` was the original case
(D-093): a card lookup right after a reload raced the lazy remount. With the readiness wait it
passes 120/120 at `--repeat-each=20 --retries=0`, with no assertion changed (D-101).

## 2. E2E builds never reach a real Firebase project

A live Firestore listener holds an open streaming request and injects cross-tab sync into the
persistence specs. The `e2e` job never gets the real `NEXT_PUBLIC_FIREBASE_*` secrets. The first
build sets only `NEXT_PUBLIC_CONCIERGE_URL` to a non-resolving `.test` origin; the `@firebase`
rebuild adds `demo-*` placeholder ids. Only `deploy.yml`'s `build` job passes real values. Measure
locally the same way, on an `out/` built without `.env.local`.

## 3. Retries

`playwright.config.ts` sets `retries: process.env.CI ? 2 : 0`.

- CI gets two retries as a backstop for new environmental noise. No known spec depends on them.
- Local runs get none, so a failure shows up immediately.
- A pass on retry is a flaky pass. The run stays green, but the test is listed in the job summary
  ("Flaky e2e (passed only on retry)") with a warning annotation. Run it with
  `--repeat-each=20 --retries=0` to tell a flake from a bug.

Needing more than two retries means the failure is probably not benign. Go to section 4.

## 4. Quarantine with `@flaky`

Only for a spec that fails every attempt across several runs with a confirmed environmental cause.

1. Reproduce in isolation (`npx playwright test e2e/<file>:<line>`) and read the trace. If the
   product or the assertion is wrong, fix it and leave the gate red.
2. Add `@flaky` to the test title. Leave the body unchanged.
3. Split it out. No spec carries `@flaky` today, so the first quarantine adds both parts: extend the
   blocking step's `--grep-invert @visual` to `"@flaky|@visual"`, and add a non-blocking step
   with `--grep "@flaky"` and `continue-on-error: true` so it still runs and reports.
4. Open an issue to fix the root cause and remove the tag. Quarantine is temporary.

Never delete a spec, loosen an assertion, widen a timeout to hide a race, remove a reload, or
`test.skip` real behaviour. Retries and `@flaky` quarantine are the only levers.

## 5. Visual regression is not a flake

The visual specs (`e2e/visual.spec.ts` and the visual cases in `tm-acceptance.spec.ts`) run in
their own `visual` job on `windows-latest`, because the baselines are `-win32` snapshots. The job
is blocking (D-379). A pixel diff there is a real diff: rebaseline or fix, never retry.
