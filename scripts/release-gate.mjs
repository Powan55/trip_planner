// Release preconditions for a tree aimed at `main`.
//
// Called from TWO places, deliberately (see DECISIONS.md D-305):
//   - .github/workflows/ci.yml, on a pull request into `main`, so the answer arrives
//     BEFORE the merge.
//   - .github/workflows/deploy.yml, on the push to `main`, because the pull-request
//     answer can go stale if another deploy claims the version in between, and because
//     a direct push to `main` never opened a pull request at all.
//
// REQUIRES A TAG-VISIBLE CHECKOUT. `actions/checkout@v4` defaults to `fetch-depth: 1`
// with no tags, and under that default assertion 1 finds no tags, passes, and this whole
// script reports green on a version that is already live. Both call sites therefore pin
// `fetch-depth: 0` and `fetch-tags: true`. If you add a third caller, pin them there too.
// Assertion 1b turns that hazard into a loud failure rather than a silent pass: with zero
// tags visible it refuses instead of assuming the version went up.
//
// No dependencies and no npm install, so this answers in seconds and can run before
// anything is installed. Run it by hand from the repo root: `node scripts/release-gate.mjs`.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const version = JSON.parse(readFileSync('trip/package.json', 'utf-8')).version;
const tag = `v${version}`;

let failed = false;
const fail = (msg) => { console.error(`::error::${msg}`); failed = true; };
const pass = (msg) => console.log(`ok   ${msg}`);

// Every assertion runs even after one fails, so a single run reports everything that is
// wrong rather than making you rediscover the next problem on the next push.

// 1. Never deployed before. The tag is pushed only AFTER a successful deploy, so
//    re-running a FAILED deploy at the same version is still allowed (D-134) — a failed
//    deploy writes no tag, so that version is still above the newest one. This assertion is
//    inequality only; assertion 1b immediately below is what checks the version went UP.
//    D-305 deferred that check, D-337 supersedes the deferral and adds it.
try {
  execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { stdio: 'ignore' });
  fail(`Version ${version} was already deployed (tag ${tag} exists). Bump trip/package.json.`);
} catch {
  pass(`${version} has no deploy tag yet (${tag} absent).`);
}

// 1b. Went UP, not just sideways. Assertion 1 is inequality only, and the tag list has real
//     holes (v5.8.0, v5.10.x, v5.11.0/.1, v5.12.x, v5.13.0, v5.14.1, v5.15.0 were versioned
//     in RELEASES.md and never tagged), so every one of those numbers passes assertion 1
//     today. Setting the version BACKWARDS therefore ships old-looking bytes and then stamps
//     a tag that lies about history — deploy.yml's own header records that happening once.
//
//     ZERO PARSEABLE TAGS IS A FAILURE, deliberately. That is the shallow-checkout state the
//     file header warns about, and it is exactly when a silent pass is most expensive: the
//     gate cannot answer "did it go up" without tags, so it says so instead of guessing. The
//     catch covers the same ground for a checkout that is not a repo at all.
const triple = (s) => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(s.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
// Numeric, NOT string order: 'v5.9.2' sorts ABOVE 'v5.14.0' as text.
const higher = (a, b) => (a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]);
const NO_TAGS =
  `No v*.*.* tags are visible, so this gate cannot tell whether ${version} is an upgrade. ` +
  'Check out with `fetch-depth: 0` and `fetch-tags: true` (see this file\'s header).';
try {
  const tags = execFileSync('git', ['tag', '-l', 'v*'], { encoding: 'utf-8' })
    .split('\n')
    .map(triple)
    .filter(Boolean);
  const mine = triple(version);
  const newest = tags.length ? tags.reduce((a, b) => (higher(b, a) ? b : a)) : null;
  if (!newest) {
    fail(NO_TAGS);
  } else if (!mine) {
    fail(`trip/package.json version "${version}" is not a plain N.N.N, so it cannot be ordered.`);
  } else if (higher(mine, newest)) {
    pass(`${version} is above the newest deploy tag v${newest.join('.')}.`);
  } else {
    fail(`Version ${version} is not above the newest deploy tag v${newest.join('.')}. ` +
      'A release may only move the version forward.');
  }
} catch {
  fail(NO_TAGS);
}

// 2. Says what it changed, AND does not say it must not ship. `rule.md` has always asked
//    for the entry; nothing enforced it, and the file has drifted from reality in both
//    directions before.
//
//    HOW THE MATCH WORKS. This scans `## ` heading lines, not the whole file, and takes the
//    FIRST heading that carries the tag as a whole token. Markdown emphasis is stripped
//    first, so `**NOT DEPLOYED**` and `· NOT DEPLOYED ·` read the same. That heading is then
//    refused if it carries a hold marker, wherever on the line it sits. The old check was
//    `releases.includes('## <tag> ')` and its comment claimed a NOT DEPLOYED heading failed
//    it; that was never true, because the marker is a suffix and the fixed string matched
//    anyway. v6.0.0 was "clear to ship" on an entry whose own body says it is not.
//
//    CEILING, FIRST MATCH: a heading may NAME an older release, so the first hit is not
//    always that release's own entry — `## v5.11.2 … the first live deploy since v5.9.2`
//    (RELEASES.md:165) shadows v5.9.2's own entry at :243. That is the file's only shadow
//    today, and it is safe: a shadowing heading is always a NEWER release, so a shadowed
//    version sits below the newest documented one, and 1b now refuses everything at or below
//    v5.14.4 — the only two headings above it (v6.0.0, v5.15.0) are both held, so a shadow
//    match fails closed. The one fail-open shape is a held target named by a newer, still
//    untagged, NOT-held heading; nothing in the file has it, and writing one means putting
//    "supersedes v5.15.0" into an unshipped release's heading. If it ever bites, the upgrade
//    is two lines: prefer the heading whose first token after `## ` (past an optional
//    marker) IS the tag, falling back to this scan. Every app heading already has that shape.
//
//    CEILING: every heading line also names WORKER versions (`v1.8.0`, `v1.9.0`), so a
//    whole-token scan of a heading is only correct because it is fed the APP version out of
//    trip/package.json. Feed it a worker version and it will match the wrong line.
const releases = readFileSync('trip/docs/RELEASES.md', 'utf-8');
const HOLD_MARKER = /NOT DEPLOYED|NOT SHIPPED|⛔/;
const tagToken = new RegExp(`(^|[^0-9A-Za-z.-])${tag.replace(/\./g, '\\.')}([^0-9A-Za-z.-]|$)`);
const heading = releases
  .split('\n')
  .filter((line) => line.startsWith('## '))
  .map((line) => ({ line, clean: line.replace(/\*\*/g, '') }))
  .find(({ clean }) => tagToken.test(clean));

if (!heading) {
  fail(`trip/docs/RELEASES.md has no "## ${tag}" heading. Every deploy says what it changed.`);
} else if (HOLD_MARKER.test(heading.clean)) {
  fail(`trip/docs/RELEASES.md marks ${tag} as held, so it must not ship: ${heading.line.trim()}`);
} else {
  pass(`trip/docs/RELEASES.md documents ${tag} with no hold marker.`);
}

// 3. Came through `dev`. Set only on the pull-request path; absent on a push, where there
//    is no source branch to check. This encodes the working agreement's one hard rule about
//    where releases come from — see rule.md, "The flow".
//
//    CEILING: this makes the pull request red, it cannot prevent a merge. Only a required
//    status check does that, and that is a repository setting, not a file in this repo.
const head = process.env.HEAD_REF;
if (!head) {
  pass('no HEAD_REF set, so this is not the pull-request path; source-branch check skipped.');
} else if (head === 'dev') {
  pass(`source branch is ${head}.`);
} else {
  fail(`Pull requests into main come from dev, not "${head}". Merge into dev first.`);
}

if (failed) process.exitCode = 1;
else console.log(`\nrelease-gate: ${tag} is clear to ship.`);
