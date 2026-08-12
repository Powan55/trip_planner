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
//    re-running a FAILED deploy at the same version is still allowed. Inequality only —
//    this does not check that the version went UP. See D-134, and D-305 on why
//    monotonicity is deferred rather than smuggled in here.
try {
  execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], { stdio: 'ignore' });
  fail(`Version ${version} was already deployed (tag ${tag} exists). Bump trip/package.json.`);
} catch {
  pass(`${version} has no deploy tag yet (${tag} absent).`);
}

// 2. Says what it changed. `rule.md` has always asked for this; nothing enforced it, and
//    the file has drifted from reality in both directions before.
//
//    The match is a fixed string, including the trailing space. A heading marked with the
//    NOT DEPLOYED prefix therefore does NOT satisfy it — that is correct, not a bug to fix
//    with a laxer pattern: such a release is one you have explicitly said must not ship.
const releases = readFileSync('trip/docs/RELEASES.md', 'utf-8');
if (releases.includes(`## ${tag} `)) {
  pass(`trip/docs/RELEASES.md documents ${tag}.`);
} else {
  fail(`trip/docs/RELEASES.md has no "## ${tag} " entry. Every deploy says what it changed.`);
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
