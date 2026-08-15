// The ambient-loop audit for D-293 rule 2 (the 6s floor) and D-322 (the state-indicator
// exemption). Exits 1 on any failure.
//   npm run loop-check     (or: node scripts/motion-loops.mjs)
//
// WHY THIS EXISTS. D-293 rule 2 calls itself "grep-checkable" and was never gripped — issue #24
// built the tier gate and the entrance ledger and deliberately left this one unwritten, at which
// point the two sub-6s loops already in the file were found by reading rather than by a run. The
// owner then ruled (D-322) that both stay, because they are state indicators and not ambience.
// The whole point of this file is that the ruling covers THOSE TWO and the NEXT one is caught:
// an exemption without an audit is not an exemption, it is an unenforced rule with a precedent
// attached.
//
// It reads app/globals.css rather than mirroring it (the opposite choice from
// scripts/contrast-tokens.mjs, which is a pinned mirror on purpose). The difference is what is
// being proved: the contrast harness re-derives a NUMBER the CSS cannot check itself, so a
// second copy is the evidence. Here the CSS *is* the fact, and the only useful question is
// "does anything in it break the floor" — a mirror could only prove the file agrees with itself.
//
// Dependency-free and runs before `npm ci` in CI, same as the other two.
//
// KNOWN CEILING, named rather than hidden: this parses the `animation` SHORTHAND only. The
// longhand (`animation-name` + `animation-duration` + `animation-iteration-count: infinite`) is
// detected and FAILED rather than skipped, because a hole that silently passes is worse than a
// check that tells you to write the shorthand. Same for a duration this cannot resolve.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../app/globals.css');

/** D-293 rule 2: anything repeating cycles >= 6s, so it reads as ambience and not as a blink. */
const FLOOR_SECONDS = 6;

/**
 * THE STATE-INDICATOR ALLOWLIST — the only exemption from the floor, and it is not a
 * grandfather list. A state indicator reports that the app or a cell is in a particular
 * condition RIGHT NOW; ambience says nothing and exists to be pretty. The floor exists so a
 * decoration cannot blink at you, and slowing an indicator to 6s does not calm it, it breaks
 * what it is for.
 *
 * Adding an entry here is a decision, not a fix. One line of reason each, in the entry, or the
 * next person cannot tell an indicator from a decoration somebody wanted to keep.
 */
const STATE_INDICATORS = {
  '.animate-shimmer':
    'busy: the skeleton sweep says "still loading", and a 6s cycle would outlast most of the fetches it reports on',
  '.animate-today-pulse':
    'state: marks WHICH calendar cell is today; at 6s the ring reads as decoration rather than as a marker (and it never carries the fact alone — the cell is also labelled)',
};

const css = readFileSync(CSS_PATH, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every custom property declared in the file, so a `var()`-valued duration still resolves. */
const customProps = new Map();
for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) customProps.set(m[1], m[2].trim());

/**
 * Flat rule blocks. `[^{}]*` cannot span a brace, so a nested at-rule (`@media`, `@supports`,
 * `@layer`) contributes its INNER rules and its own prelude never matches — which is exactly
 * what is wanted, since a loop inside a media query is still a loop.
 */
function rules(text) {
  const out = [];
  for (const m of text.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/\s+/g, ' ').trim();
    if (selector === '' || selector.startsWith('@')) continue;
    out.push({ selector, body: m[2] });
  }
  return out;
}

/** Seconds, or null when the value has no duration this can resolve. Null FAILS; it never passes. */
function durationSeconds(value) {
  const resolved = value.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (whole, name) =>
    customProps.get(name) ?? whole,
  );
  const t = resolved.match(/(\d*\.?\d+)\s*(ms|s)\b/);
  if (!t) return null;
  return t[2] === 'ms' ? Number(t[1]) / 1000 : Number(t[1]);
}

// ── 1. find every infinite loop ─────────────────────────────────────────────────────────────
const loops = [];
const longhand = [];
for (const { selector, body } of rules(css)) {
  for (const m of body.matchAll(/(?:^|;)\s*animation\s*:\s*([^;]+)/g)) {
    const value = m[1].replace(/\s+/g, ' ').trim();
    if (!/\binfinite\b/.test(value)) continue;
    loops.push({ selector, value, seconds: durationSeconds(value) });
  }
  if (/animation-iteration-count\s*:\s*infinite/.test(body)) longhand.push(selector);
}

// ── 2. the reduced-motion hard-stop, which is not optional for ANY loop ─────────────────────
// D-007/D-293 rule 8. The universal `animation-duration: .01ms` rule in that block would leave
// an infinite animation running one ultra-fast iteration forever, so a loop needs its selector
// named explicitly with `animation: none`. This is what stops the exemption above from becoming
// a loop nobody can turn off.
const rmStart = css.indexOf('@media (prefers-reduced-motion: reduce)');
let rmBlock = '';
if (rmStart !== -1) {
  let depth = 0;
  for (let i = css.indexOf('{', rmStart); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) {
      rmBlock = css.slice(rmStart, i + 1);
      break;
    }
  }
}
const hardStopped = new Set();
for (const { selector, body } of rules(rmBlock)) {
  if (!/animation\s*:\s*none/.test(body)) continue;
  for (const one of selector.split(',')) hardStopped.add(one.trim());
}

// ── 3. verdicts ─────────────────────────────────────────────────────────────────────────────
const problems = [];
console.log(`ambient-loop audit · ${FLOOR_SECONDS}s floor · app/globals.css\n`);
console.log('selector'.padEnd(24), 'cycle'.padEnd(8), 'rm-stop'.padEnd(8), 'verdict');
for (const { selector, value, seconds } of loops) {
  const exempt = Object.hasOwn(STATE_INDICATORS, selector);
  const stopped = hardStopped.has(selector);
  let verdict;
  if (seconds === null) {
    verdict = `*** FAIL *** no resolvable duration in "${value}"`;
  } else if (seconds >= FLOOR_SECONDS) {
    verdict = 'ambient, over the floor';
  } else if (exempt) {
    verdict = 'EXEMPT (state indicator)';
  } else {
    verdict = `*** FAIL *** under the ${FLOOR_SECONDS}s floor and not a listed state indicator`;
  }
  if (verdict.startsWith('***')) problems.push(`${selector}: ${verdict.replace('*** FAIL *** ', '')}`);
  if (!stopped) problems.push(`${selector}: loops with no explicit animation:none under prefers-reduced-motion`);
  console.log(
    selector.padEnd(24),
    (seconds === null ? '?' : `${seconds}s`).padEnd(8),
    (stopped ? 'yes' : 'NO').padEnd(8),
    verdict,
  );
}

for (const selector of longhand) {
  problems.push(`${selector}: animation-iteration-count:infinite — write the shorthand so this can read the duration`);
}

// FAILS CLOSED. An allowlist entry that matches nothing means either the rule was deleted (drop
// the entry) or the parser stopped seeing it (fix the parser) — and in the second case every
// assertion above would be vacuously true, which is the failure mode a green run hides.
for (const selector of Object.keys(STATE_INDICATORS)) {
  if (!loops.some((l) => l.selector === selector)) {
    problems.push(`${selector}: allowlisted as a state indicator but no infinite loop was found for it`);
  }
}

console.log('\nstate-indicator exemptions (D-322) — each is a decision, not a grandfather clause:');
for (const [selector, reason] of Object.entries(STATE_INDICATORS)) console.log(`  ${selector} — ${reason}`);

if (problems.length) {
  console.log('\n' + problems.length + ' PROBLEM(S):');
  for (const p of problems) console.log('  · ' + p);
} else {
  console.log(`\n${loops.length} INFINITE LOOP(S), ALL EITHER OVER THE ${FLOOR_SECONDS}s FLOOR OR LISTED STATE INDICATORS, ALL HARD-STOPPED UNDER REDUCED MOTION`);
}
process.exit(problems.length ? 1 : 0);
