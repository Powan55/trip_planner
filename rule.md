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

Four jobs, in `.github/workflows/ci.yml`.

**Checks** (about 5 minutes) runs on every push to `lax`, `uttam` and `dev`, on
every pull request into `dev` or `main`, and again on the push to `main` that
deploys:

- repository hygiene (see below)
- `npx tsc --noEmit`
- `npm run lint`
- `npm test` (Vitest)
- `npm run build`

**Firestore rules** (3-5 minutes) runs on the same triggers as Checks, and
on nothing conditional — it must not be skippable, because the deploy publishes
`firestore.rules`. It runs `scripts/rules-check.mjs` against the real rules
engine in a local emulator. No credentials: the emulator is aimed at a fake
project id, so it cannot touch the live one.

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

The deploy run also publishes `firestore.rules` to Firebase, between the build
and the Pages deploy, so the rules and the client that expects them ship
together. It is inert until the owner sets the service-account secret; without
it the job warns and publishes nothing.

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
- internal debt-register ids
- paths under a directory the root `.gitignore` keeps out of this repo
- links to documents that do not exist in this repo

Run it yourself any time:

```
cd trip && npm run marker-check
cd trip && node scripts/marker-check.mjs --self-test   # checks the patterns themselves
```

If it flags something that is genuinely fine, add a narrow pattern to
`ALLOWED_LINES` in that file with a comment explaining why. Do not widen it just
to get to green — the point of the check is that it is annoying.

The self-test is what stops the check quietly shrinking: every rule needs a line
it must still catch, and the two lists are asserted equal. Adding a rule without
its case, or deleting a rule, fails the self-test.

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

Patch for a fix, minor for a feature. The version must also go *up*: the check refuses
anything that is not strictly above the newest `v*` tag, so even a revert bumps forward
rather than restoring an older number. And the entry may not say the release is held — a
heading carrying `NOT DEPLOYED`, `NOT SHIPPED` or `⛔` refuses the deploy, which is how you
park a built-but-unshipped version without it sliding into `main`.

After a successful deploy the workflow pushes the matching `v<version>` tag itself — and
only then, which is why a deploy that failed can be re-run on the same version. It then
publishes a GitHub Release on that tag, with the matching `trip/docs/RELEASES.md` entry as the notes
verbatim — one file to write, not a changelog kept in sync with a second one.

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

`--legacy-peer-deps` is required, not optional: `@types/node` is pinned at
20.6.2 and `vite@8` (via `vitest`) wants `^20.19.0 || >=22.12.0`.

Tests:

```
npm test                                  # unit, fast
npm run build && npm run test:e2e         # browser suite; the build must come first
```

The Playwright config serves the static export from `out/` rather than the dev
server, because that is the artifact that actually deploys. It does not build for
you, so `npm run build` first or every spec fails at startup.

## The app itself

Next.js static export. Nothing of ours serves it. Data is written to the browser
(`localStorage`, plus IndexedDB for photo bytes) and, when the build carries a
Firebase web config, mirrored to Firestore under the trip's id. `firestore.rules`
lives in this repo and is the whole access model. Everything in it sits behind
`request.auth != null` — the app signs in anonymously, so there is no login
screen but there is always a uid. Above that floor a trip is in one of two
modes. If its trip document carries a `members` map, only a uid in that map can
reach the trip's *content*; an owner may remove members, change roles and delete
the trip, while a plain member has full content read and write and may add
another member — add-only, so a member can never remove or re-role an existing
entry. Two carve-outs sit deliberately outside that gate, for two different
reasons. Any signed-in user can read and write `profile/**`, because the
front-door check reads an account's identity to validate a pasted User Token,
and it has to be able to do that before any membership exists — if that read
could come back denied, token validation would go quietly vacuous instead of
loudly broken. And any signed-in user can read `meta/**`, so that someone
opening an invite link can see which trip they are being asked to join before
anyone has added them. If the document carries no `members` map, the older capability model
still applies: any signed-in holder of the trip id can read and write it. That
second mode is what keeps trips made before the members map working. Publishing
the rules is part of the release, though it stays inert until the owner sets the
service-account secret. Separately, every route sits behind the front-door wall in
`trip/components/token-gate.tsx`; there is no guest mode. There is one
Cloudflare Worker behind the AI concierge; it is deployed, and its source is not
in this repo.

Everything is on a free tier and must stay that way.
