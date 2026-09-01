#!/usr/bin/env node
/**
 * Repository hygiene check.
 *
 * This repo is public and is written by more than one person. A few kinds of
 * text should never land in it: internal planning vocabulary carried over from
 * private notes, the owner's personal contact details, internal debt-register
 * ids, and references to files or directories that only exist in a private
 * working copy. None of those break the build, so nothing else would ever catch
 * them.
 *
 * Detection only. It never edits a file. Run it with no arguments to scan the
 * repo, or with --self-test to check the patterns themselves still work.
 *
 *   node scripts/marker-check.mjs
 *   node scripts/marker-check.mjs --self-test
 *
 * Deliberately dependency-free so CI can run it before `npm ci`: a bad string
 * should fail in twenty seconds, not after a three-minute install.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';

// Ticket-style ids (S219, D-097, FU-15, M19) are deliberately NOT listed here.
// They read as ordinary internal ticket references, the same as a JIRA key, and
// they are useful when reading old comments. What follows is only the
// vocabulary that describes how the work was organised, which is noise to
// anyone reading this repo.
//
// Every rule name below needs a matching row in MUST_CATCH, and the self-test
// fails if the two sets differ. That is what stops the gate passing on less
// than the full marker set.
const PATTERNS = [
  ['role-word', /\b(Apex|tech-lead|[A-Za-z]+-engineer|ponytail)\b/g],
  ['owner-name', /\bLax('s)?\b/g],
  // The owner's personal identity. The scrubber can never fix these
  // automatically: a hit means the source line has to be rewritten by hand.
  ['owner-pii', /laxmipoudel|official\.shadowverse@|\bLaxmi\b|\bPoudel\b/gi],
  ['gate-word', /\b(Gate\s?[12]|gate-pass|no-gate|re-gate|handback|ratified)\b/g],
  ['section-mark', /§/g],
  // "design-spec" and "blueprint" are deliberately NOT listed. Both name real
  // published documents under trip/docs/, so flagging them would fire on every
  // legitimate reference to a file that is right there in the repo.
  ['codename', /\b(Trip OS|Yen\s?&\s?Rupee(?:\s\d+)?|Afterglow(?:\s\d+)?|Alpine Nocturne|Last Train|Lane [VMGXP])\b/g],
  ['ai-vendor', /\b(Claude(?:\sCode)?|Anthropic|subagents?)\b/g],
  // "brief" and "wave" are ordinary travel-prose words ("a brief stop"), so only
  // their process-phrase shapes count. The apostrophe is a character class
  // because prose in this repo carries both the straight and the typographic
  // one, and "the brief’s" is the same marker as "the brief's".
  ['process-prose', /\b(?:per|in|from|of)\s+the\s+brief\b|\bthe\s+brief(?:['’]s|\s+(?:says|asks|wants|names|specifies))\b|\bthis\s+wave\b|\bwave\s+(?:closes?|closed|ships|punishes)\b|\bJUDGEMENT CALL\b/gi],
  // Files that live only in the private working copy. A reference to one of
  // these is a dead link for anyone reading this repo.
  //
  // Case-insensitive since S417: these are filenames, and the filesystems this
  // repo is written on are case-insensitive, so `claude.md` and `state.md` name
  // exactly the same private files. The last publish leaked a lowercase one
  // straight past the uppercase-only spelling.
  ['private-doc', /\b(STATE\.md|STATE-archive[\w-]*\.md|BACKLOG\.md|BACKLOG-archive[\w-]*\.md|CLAUDE\.md|PONYTAIL-DEBT\.md|CLEANUP-REVIEW\.md|NEEDS-LAX\.md|DECISIONS-archive[\w-]*\.md)/gi],
  // Directories from the internal-planning block of the root .gitignore. A path
  // that is excluded from this repo must not be *mentioned* in it either: the
  // reference is dead here, and it names the private tree's layout.
  //
  // Anchored on a look-behind rather than \b, because \b before a leading "." is
  // a boundary only when the preceding character is a word character, so a
  // \b-anchored spelling would miss `.claude/` in every place it actually gets
  // written (`` `.claude/` ``, "(.claude/)", start of line).
  //
  // Settled once, so nobody re-opens it: S417 words this rule as "references
  // to lib/__tests__/ and e2e/ paths". Do not implement that literally. Those
  // were two thirds of the old mirror script's EXCLUDE_DIRS, the directories it
  // withheld when it copied a private tree into a public one, so in the mirror
  // any reference to them dangled. That script is gone and this repo IS the
  // published one: docs/ (22 files), e2e/ (135) and lib/__tests__/ (154) are all
  // committed here, and 231 of 231 real references to them resolve on disk. The
  // four that do not are the gitignored live-vault fixture, named as absent on
  // purpose in three places, and one comment recording a test it supersedes.
  // A literal rule would fire on 332 lines across 136 files, every one of them
  // pointing at something a reader can open. The class S417 meant (a path this
  // repo excludes) is now exactly the internal-planning block of the root
  // .gitignore, which is what this pattern tracks. Keep the two in step.
  ['excluded-path', /(?<![\w-])(\.claude|briefs|docs\/plans|docs\/reports)\//gi],
  // Tech-debt register ids. Unlike the ticket-style ids above, these name rows
  // of an internal register rather than a shipped thing, and the last publish
  // leaked them. The optional letter suffix is deliberate: `TD-01g` is the exact
  // shape a \d-only pattern reports clean on.
  ['debt-id', /\bTD-\d{1,2}[a-z]?\b/g],
];

// Every entry is a named, understood exception. Widening this list to make the
// check pass is how the check stops working, so each line needs a reason.
const ALLOWED_LINES = [
  // "reverse-engineer" is a normal verb, not one of the role names above.
  /reverse-engineer/i,
  // Real place names and UI copy, not the review-gate sense of "gate".
  /Thunder Gate|torii gate|length gate/i,
  // The deployed Worker hostname is a public endpoint the app has to call, and
  // it already ships inside lib/concierge-config.ts. It is not a private
  // address, even though it contains the account handle.
  /trip-planner-concierge\.official-shadowverse\.workers\.dev/,
  // The site credit in components/footer.tsx is deliberate, and it is JSX text
  // rather than a comment. Kept narrow so any OTHER use of the name still fails.
  /getFullYear\(\)\} Lax/,
  // SVG keyword and the npm package name, neither related to work-slicing.
  /xMidYMax slice|prototype\.slice/,
  // Cloudflare Worker deploy "Version ID"s (RELEASES.md, DECISIONS.md,
  // V-FINAL-DEVPLAN.md) are UUID-shaped but name a `wrangler` deploy, not a
  // Firestore trip — a different namespace entirely, recorded on purpose.
  /version id `/i,
  // trip-key-migration.md's own instructions show the UUID SHAPE as a worked
  // example ("a v4 UUID, e.g. `...`"), not a real trip's id.
  /UUID, e\.g\. `/,
];

// Two files legitimately contain the very strings this script looks for: the
// ignore rules have to name the private files in order to exclude them, and
// this script has to spell out its own patterns. Scanning either is circular.
const EXEMPT_FILES = new Set([
  '.gitignore',
  'trip/.gitignore',
  'trip/scripts/marker-check.mjs',
]);

function scanText(text, relPath) {
  const hits = [];
  text.split('\n').forEach((line, idx) => {
    if (ALLOWED_LINES.some((re) => re.test(line))) return;
    for (const [rule, re] of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(line)) {
        hits.push({ file: relPath, line: idx + 1, rule, text: line.trim().slice(0, 120) });
      }
    }
  });
  return hits;
}

/**
 * Flag references to markdown files that do not exist anywhere in the repo.
 *
 * Checked against the filesystem rather than a hard-coded list, so moving or
 * adding a doc never requires editing this script.
 */
function scanDocRefs(text, relPath, repoRoot) {
  const hits = [];
  // The left edge is a look-behind for "not a filename character" rather than a
  // hand-listed set of delimiters. The listed set was the punctuation defect:
  // it named space ( ` ' " and [, so every reference wrapped in markdown
  // emphasis (**docs/x.md**, *docs/x.md*, _docs/x.md_), sat in a table cell
  // (|docs/x.md|), in angle brackets or in typographic quotes went unchecked.
  // This repo's docs are markdown, where bold is the usual way to write one.
  // A rule that says what may NOT precede a path does not go stale the way a
  // list of the punctuation that may does.
  const re = /(?<![\w./-])((?:[\w.-]+\/)*[\w.-]+\.md)\b/g;
  text.split('\n').forEach((line, idx) => {
    if (ALLOWED_LINES.some((r) => r.test(line))) return;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const ref = m[1];
      const candidates = [
        path.join(repoRoot, ref),
        path.join(repoRoot, 'trip', ref),
        path.join(repoRoot, path.dirname(relPath), ref),
      ];
      if (!candidates.some((p) => fs.existsSync(p))) {
        hits.push({ file: relPath, line: idx + 1, rule: 'dangling-doc-ref', text: ref });
      }
    }
  });
  return hits;
}

/**
 * Flag a bare UUID-shaped string in a markdown doc — the shape
 * `crypto.randomUUID()` produces for a Firestore trip id (`core/trips/custom.ts`,
 * `getTripId()`). A trip id IS the capability: anyone who opens one is
 * self-enrolled into that trip's roster (`ensureMembership`,
 * `lib/trips-remote.ts`), so one landing in this public repo's prose is a
 * live leak, not a cosmetic one — D-341 records the one this rule follows.
 *
 * Markdown-only, deliberately, same reasoning as `dangling-doc-ref`: a
 * UUID-shaped constant in a `.test.ts`/`.spec.ts` fixture or in
 * `scripts/rules-check.mjs` is a synthetic id exercised only against the
 * local emulator project — a different risk class — and a repo-wide rule
 * would be swamped by those before it ever caught a real doc leak.
 */
function scanTripIds(text, relPath) {
  const hits = [];
  const re = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  text.split('\n').forEach((line, idx) => {
    if (ALLOWED_LINES.some((r) => r.test(line))) return;
    re.lastIndex = 0;
    if (re.test(line)) {
      hits.push({ file: relPath, line: idx + 1, rule: 'trip-id', text: line.trim().slice(0, 120) });
    }
  });
  return hits;
}

// One line per rule that MUST still be caught, keyed by rule name. The self-test
// asserts these keys are exactly the rule names in PATTERNS, so the gate cannot
// go green on a partial marker set: deleting a rule, renaming one, or leaving a
// pattern in place that has quietly stopped matching all fail here.
//
// The PII line is assembled from fragments on purpose. A working address written
// out in full would be the exact thing that rule exists to keep out of the repo.
const MUST_CATCH = {
  'role-word': '// Apex reviewed this',
  'owner-name': "// Lax's call",
  'owner-pii': '// mail ' + 'laxmi' + 'poudel311@example.invalid',
  'gate-word': '// Gate 2 passed',
  'section-mark': '// see blueprint §4',
  'codename': '// the Last Train run',
  'ai-vendor': '// ask Claude',
  'process-prose': '// per the brief',
  'private-doc': '// see STATE.md',
  'excluded-path': '// see briefs/2026-08/x',
  'debt-id': '// TD-07 is still open',
};

function selfTest() {
  const t = (s) => scanText(s, 'x.ts').map((h) => h.rule);

  // Why this file has a self-test: every rule is exercised, and every exercise
  // names a live rule.
  assert.deepEqual(
    PATTERNS.map(([rule]) => rule).sort(),
    Object.keys(MUST_CATCH).sort(),
    'PATTERNS and MUST_CATCH have drifted: every rule needs one case, and every case a rule',
  );
  for (const [rule, line] of Object.entries(MUST_CATCH)) {
    assert.deepEqual(t(line), [rule], `${rule} no longer catches its own case: ${line}`);
  }

  // Catches what it must, beyond the one case per rule above.
  assert.deepEqual(t('// frontend-engineer built it'), ['role-word']);
  // The three shapes the last publish leaked. Each one is a near-miss of a rule
  // that was already there, which is why they survived a green run.
  assert.deepEqual(t('// see state.md'), ['private-doc']); // lowercase
  assert.deepEqual(t('// see .claude/agents/pm.md'), ['excluded-path']);
  assert.deepEqual(t('// see docs/plans/v6.md'), ['excluded-path']);
  assert.deepEqual(t('// TD-01g is still open'), ['debt-id']); // letter suffix
  // Punctuation: a marker glued to a typographic apostrophe is the same marker.
  assert.deepEqual(t('// the brief’s deadline'), ['process-prose']);

  // Leaves alone what it must. These are the regressions that matter: a check
  // that fires on ordinary content gets switched off.
  assert.deepEqual(t('// S219 and D-097 are ticket refs'), []);
  assert.deepEqual(t('// FU-15, M19, Phase 0'), []);
  assert.deepEqual(t('const a = arr.slice(0, 2);'), []);
  assert.deepEqual(t('// reverse-engineer the format'), []);
  assert.deepEqual(t('// near Thunder Gate in Asakusa'), []);
  assert.deepEqual(t('// a brief stop in Nara'), []);
  assert.deepEqual(t('// the wave of tourists'), []);
  assert.deepEqual(t('// calls https://trip-planner-concierge.official-shadowverse.workers.dev'), []);
  assert.deepEqual(t('// docs/ and reports/ are ordinary words'), []);

  // The dangling-doc-ref rule is part of the marker set too, and its left edge
  // is where the punctuation defect lived: a reference in markdown bold was not
  // checked at all. Both spellings must reach the filesystem check.
  const repoRoot = path.resolve(process.cwd(), process.cwd().endsWith('trip') ? '..' : '.');
  const refs = (s) => scanDocRefs(s, 'x.md', repoRoot).map((h) => h.text);
  assert.deepEqual(refs('see docs/definitely-not-here.md'), ['docs/definitely-not-here.md']);
  assert.deepEqual(refs('see **docs/definitely-not-here.md**'), ['docs/definitely-not-here.md']);
  assert.deepEqual(refs('see `DECISIONS.md` at the root'), []);

  // trip-id is markdown-only too (same reasoning as dangling-doc-ref above):
  // catches a bare Firestore trip id in prose, leaves the two UUID-shaped
  // exceptions already living in this repo alone.
  const tripIds = (s) => scanTripIds(s, 'x.md').map((h) => h.rule);
  assert.deepEqual(
    tripIds('a throwaway trip ("QA Sync Check", id `0a1b2c3d-4e5f-6789-abcd-ef0123456789`)'),
    ['trip-id'],
  );
  assert.deepEqual(tripIds('**Shipped:** Version ID `157ed2e0-2cfb-4044-af3e-ea80bc1b4ce6`'), []);
  assert.deepEqual(
    tripIds('Copy the result (a v4 UUID, e.g. `e1a9c2f4-7b3d-4c1a-9e2b-6f8a1d4c7b90`).'),
    [],
  );

  console.log('self-test: all assertions passed');
}

function main() {
  const repoRoot = path.resolve(process.cwd(), process.cwd().endsWith('trip') ? '..' : '.');
  const files = execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean);

  const hits = [];
  let scanned = 0;
  for (const rel of files) {
    if (EXEMPT_FILES.has(rel)) continue;
    const abs = path.join(repoRoot, rel);
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      hits.push({
        file: rel,
        line: 0,
        rule: 'unscanned',
        text: 'tracked but unreadable — nothing was scanned',
      });
      continue;
    }
    // Skip binaries by content, not by extension, so an unknown text extension
    // is still scanned rather than silently ignored.
    if (buf.includes(0)) continue;
    if (buf.length > 2_000_000) {
      hits.push({
        file: rel,
        line: 0,
        rule: 'unscanned',
        text: `${buf.length} bytes, over the 2 MB read cap — nothing was scanned`,
      });
      continue;
    }
    const ext = path.extname(rel).toLowerCase();

    const text = buf.toString('utf-8');
    scanned++;
    hits.push(...scanText(text, rel));
    if (ext === '.md') {
      hits.push(...scanDocRefs(text, rel, repoRoot));
      hits.push(...scanTripIds(text, rel));
    }
  }

  // FAILS CLOSED. A zero scan means the enumeration or the root moved, at which point a
  // clean verdict proves nothing — which is the failure mode a green run hides.
  if (scanned === 0) {
    hits.push({
      file: repoRoot,
      line: 0,
      rule: 'unscanned',
      text: 'git ls-files yielded no scannable file — the root moved and this scan proves nothing',
    });
  }

  if (hits.length === 0) {
    console.log(`marker-check: clean (${scanned} files scanned)`);
    return;
  }

  console.error(`marker-check: ${hits.length} problem(s) in ${scanned} scanned files\n`);
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}  [${h.rule}]  ${h.text}`);
  }
  console.error(
    '\nRewrite the offending lines. If a hit is genuinely a false positive, add a' +
      '\nnarrow pattern to ALLOWED_LINES in scripts/marker-check.mjs with a comment' +
      '\nsaying why. Do not widen it just to go green.',
  );
  process.exit(1);
}

if (process.argv.includes('--self-test')) selfTest();
else main();
