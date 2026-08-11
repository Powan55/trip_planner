# How we work on this repo

Two people work here. This file is the agreement between them. If something in
it stops matching reality, change the file in the same pull request that made it
wrong.

## Branches

| Branch | What it is |
|---|---|
| `lax` | One working branch. Force-push it, rebase it, break it. Nobody else builds on it. |
| `uttam` | Uttam's working branch. Same freedom. |
| `dev` | Where the two meet. Everything is tested here together before it can ship. It is **not** the repository's default branch, so check the base before you open a pull request — GitHub will offer you `main`. |
| `main` | What is live at https://powan55.github.io/trip_planner/. Every push to it deploys. |

## The flow

```
lax  ─┐
      ├─►  dev  ─►  main   (deploys)
uttam ─┘
```

1. Work on your own branch. Push whenever, as often as you like.
2. Open a pull request into `dev` when the change is ready for the other person's
   code to meet it. CI has to be green.
3. When `dev` is in a state worth shipping, bump the version and write the release
   note **on `dev`** (see "Versions and deploys"), then open a pull request from
   `dev` into `main`. That one needs a review from the other person, the full suite
   green, and the release gate green.
4. Merging into `main` runs Checks and the release gate once more against the commit
   that ships, then deploys automatically. There is nothing else for you to run.

Never push straight to `main`. It is live, and there is no staging site between
you and the people using it. If someone does it anyway the deploy still runs
Checks first and refuses to publish a red tree. That is a backstop. Do not read
it as permission.

There is no manual deploy button. It used to exist and it ran the *chosen branch's*
copy of the workflow, which meant any branch left behind at an unshipped version
could publish itself over the live site. If a deploy fails for a reason you have
since fixed elsewhere, use **Re-run all jobs** on that run — it replays the same
workflow at the same commit, which is the only thing the button was good for.

Start every new piece of work from an up-to-date `dev`:

```
git switch dev && git pull
git switch lax && git merge dev
```

## What CI runs

Three jobs, in `.github/workflows/ci.yml`.

**Checks** (about 5 minutes) runs on every push to `lax`, `uttam` and `dev`, on
every pull request into `dev` or `main`, and again on the push to `main` that
deploys:

- repository hygiene (see below)
- `npx tsc --noEmit`
- `npm run lint`
- `npm test` (Vitest)
- `npm run build`

**E2E** (about 13 minutes) runs on pull requests only, after Checks passes:

- `npm run build`, then Playwright against the built static export
- the behavioural suite, which must pass
- the visual-regression suite, which is **advisory**. The committed screenshot
  baselines were generated on Windows and cannot match on the Linux runner, so
  this step reports but never fails the build. The diff is uploaded as an artifact.

**Release gate** (seconds) runs on a pull request into `main` only, and again on the
push to `main` that deploys. It needs no dependencies, so it answers before anything
is installed. It fails if:

- `trip/package.json`'s version already carries a `v<version>` tag, meaning it has
  been deployed before
- `trip/docs/RELEASES.md` has no `## v<version> ` entry
- the pull request came from a branch other than `dev`

The first two are the two things you were already told to do before shipping. See
"Versions and deploys".

Pushing to your own branch gives you the fast half. The full suite runs when you
open the pull request, which is where it matters. Expect to wait.

`.github/workflows/deploy.yml` calls that same Checks workflow and will not build
or deploy until it is green, so nothing reaches the live site without passing it.
One consequence worth knowing before you need it: a red check now blocks every
deploy, including a fix you are in a hurry to ship. There is deliberately no
bypass. The way out is to revert, or to fix the check.

E2E stays on the pull request. When the deploy came from a merged pull request
that is just economy, because the browser suite already ran against the merge
result and repeating it would add thirteen minutes for the same answer. A direct
push to `main` is the case that is *not* covered, because no pull request ever
ran it. Which is the older reason not to do it.

## Repository hygiene

`trip/scripts/marker-check.mjs` runs first in CI, before anything is installed,
so a problem fails in twenty seconds rather than after a three-minute install.

It fails the build on:

- internal planning vocabulary carried over from private notes
- personal contact details
- links to documents that do not exist in this repo

Run it yourself any time:

```
cd trip && npm run marker-check
```

If it flags something that is genuinely fine, add a narrow pattern to
`ALLOWED_LINES` in that file with a comment explaining why. Do not widen it just
to get to green — the point of the check is that it is annoying.

## Never commit

- `trip/e2e/fixtures/live-v5-vault/live-dump.json` — a real capture from a real
  browser profile: live flights, hotels, traveller names. It is gitignored. The
  acceptance spec that uses it skips itself when the file is absent, which is why
  CI is green without it. **Do not replace it with a made-up file to "fix" the
  skip.** The only reason that fixture is worth anything is that it contains
  bytes nobody would think to invent.
- `trip/.env.local` — local keys.
- Anything listed in the root `.gitignore` under internal planning files.

## Commits

`<area>: <what it does, in the imperative>`

```
map: keep the day filter when a pin is reopened
docs: correct the storage-key table
```

Lower case after the colon, no trailing full stop. Explain the *why* in the body
if it is not obvious from the diff.

## Versions and deploys

Every deploy must carry a version nobody has shipped before, and every deploy must
say what it changed. Both are checked, by `scripts/release-gate.mjs` — on the pull
request into `main`, and again on the push that deploys.

So before opening the pull request from `dev` into `main`, on `dev`:

1. Bump `version` in `trip/package.json`.
2. Add an entry at the top of `trip/docs/RELEASES.md` headed `## v<version> `,
   saying what changed.

Patch for a fix, minor for a feature. After a successful deploy the workflow pushes
the matching `v<version>` tag itself — and only then, which is why a deploy that
failed can be re-run on the same version.

What changed here is *when* you find out. The version check used to run only on the
push to `main`, so a pull request could go green, merge into the live branch, and
only then refuse to deploy — leaving `main` ahead of the site with the fastest fix
being the direct push you are not allowed to make.

You can run the same check yourself, from the repository root:

```
node scripts/release-gate.mjs
```

## Where to look

| Document | For |
|---|---|
| `DECISIONS.md` | Every constraint that still binds, and why. **Read the relevant entry before changing an architectural decision** — most of them have a reason that is not obvious from the code. |
| `trip/docs/design-spec-v2.md` | Colours, type, spacing, motion. Read before touching UI. |
| `trip/docs/data-core-blueprint.md` | The data model and the storage-key registry. |
| `trip/docs/time-model-blueprint.md` | Dates, timezones, the trip clock. The easiest place to be subtly wrong. |
| `trip/docs/test-ids.md` | The `data-testid` contract the E2E specs are written against. Needed to write or fix any spec. |
| `trip/docs/sync-everywhere-blueprint.md` | Cross-device sync via Firestore. |
| `trip/docs/photo-storage-blueprint.md` | Photos and IndexedDB. |
| `trip/docs/ci-flake-policy.md` | Read before blaming a red run on flake. |
| `trip/docs/RELEASES.md` | What shipped, when. |

## Running it locally

```
cd trip
npm ci --legacy-peer-deps
npm run dev
```

`--legacy-peer-deps` is required, not optional: `cmdk`, `next-themes` and
`sonner` pin React 18 peers against this app's React 19.

Tests:

```
npm test                                  # unit, fast
npm run build && npm run test:e2e         # browser suite; the build must come first
```

The Playwright config serves the static export from `out/` rather than the dev
server, because that is the artifact that actually deploys. It does not build for
you, so `npm run build` first or every spec fails at startup.

## The app itself

Next.js static export, no server. Data lives in the browser's localStorage, with
optional cross-device sync through Firestore. There is one Cloudflare Worker
behind the AI concierge; its source is not in this repo.

Everything is on a free tier and must stay that way.
