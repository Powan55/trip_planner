#!/usr/bin/env node
/**
 * Repository hygiene check.
 *
 * This repo is public and is written by more than one person. A few kinds of
 * text should never land in it: internal planning vocabulary carried over from
 * private notes, the owner's personal contact details, and references to files
 * that only exist in a private working copy. None of those break the build, so
 * nothing else would ever catch them.
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
const PATTERNS = [
  ['role-word', /\b(Apex|tech-lead|[A-Za-z]+-engineer|ponytail)\b/g],
  ['owner-name', /\bLax('s)?\b/g],
  // The owner's personal identity. The scrubber can never fix these
  // automatically: a hit means the source line has to be rewritten by hand.
  ['owner-pii', /laxmipoudel|official\.shadowverse@|\bLaxmi\b|\bPoudel\b/gi],
  ['gate-word', /\b(Gate\s?[12]|gate-pass|no-gate|re-gate|handback|ratified)\b/g],
  ['section-mark', /§/g],
  ['design-spec', /\bdesign-spec\b/gi],
  ['codename', /\b(Trip OS|Yen\s?&\s?Rupee(?:\s\d+)?|Afterglow(?:\s\d+)?|Alpine Nocturne|Last Train|Lane [VMGXP])\b/g],
  ['ai-vendor', /\b(Claude(?:\sCode)?|Anthropic|subagents?)\b/g],
  // "brief" and "wave" are ordinary travel-prose words ("a brief stop"), so only
  // their process-phrase shapes count.
  ['process-prose', /\b(?:per|in|from|of)\s+the\s+brief\b|\bthe\s+brief(?:'s|\s+(?:says|asks|wants|names|specifies))\b|\bthis\s+wave\b|\bwave\s+(?:closes?|closed|ships|punishes)\b|\bJUDGEMENT CALL\b/gi],
  // Files that live only in the private working copy. A reference to one of
  // these is a dead link for anyone reading this repo.
  ['private-doc', /\b(STATE\.md|BACKLOG\.md|CLAUDE\.md|PONYTAIL-DEBT\.md|CLEANUP-REVIEW\.md|NEEDS-LAX\.md|DECISIONS-archive[\w-]*\.md|briefs\/)/g],
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
];

// Two files legitimately contain the very strings this script looks for: the
// ignore rules have to name the private files in order to exclude them, and
// this script has to spell out its own patterns. Scanning either is circular.
const EXEMPT_FILES = new Set([
  '.gitignore',
  'trip/.gitignore',
  'trip/scripts/marker-check.mjs',
]);

const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md',
  '.css', '.svg', '.txt', '.yml', '.yaml', '.html',
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
  const re = /(?:^|[\s(`'"[])((?:[\w.-]+\/)*[\w.-]+\.md)\b/g;
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

function selfTest() {
  const t = (s) => scanText(s, 'x.ts').map((h) => h.rule);

  // Catches what it must.
  assert.deepEqual(t('// Apex reviewed this'), ['role-word']);
  assert.deepEqual(t('// frontend-engineer built it'), ['role-word']);
  assert.deepEqual(t("// Lax's call"), ['owner-name']);
  assert.deepEqual(t('// mail laxmipoudel311@gmail.com'), ['owner-pii']);
  assert.deepEqual(t('// see blueprint §4'), ['section-mark']);
  assert.deepEqual(t('// Gate 2 passed'), ['gate-word']);
  assert.deepEqual(t('// per the brief'), ['process-prose']);
  assert.deepEqual(t('// ask Claude'), ['ai-vendor']);
  assert.deepEqual(t('// see STATE.md'), ['private-doc']);
  assert.deepEqual(t('// the Last Train wave'), ['codename']);

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
      continue; // deleted or unreadable; git status will surface it
    }
    // Skip binaries by content, not by extension, so an unknown text extension
    // is still scanned rather than silently ignored.
    if (buf.includes(0)) continue;
    if (buf.length > 2_000_000) continue;
    const ext = path.extname(rel).toLowerCase();
    if (ext && !TEXT_EXT.has(ext)) continue;

    const text = buf.toString('utf-8');
    scanned++;
    hits.push(...scanText(text, rel));
    if (ext === '.md') hits.push(...scanDocRefs(text, rel, repoRoot));
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
