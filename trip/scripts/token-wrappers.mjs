// The bare-triplet wrapper audit. Exits 1 on any failure.
//   npm run token-check     (or: node scripts/token-wrappers.mjs)
//   node scripts/token-wrappers.mjs --self-test
//
// WHY THIS EXISTS. `--accent` and friends are declared as BARE NUMERIC TRIPLETS
// (`--accent: 192 100% 62%`) so Tailwind's `hsl(var(--x) / <alpha-value>)` keys can add an
// alpha. That declaration is correct. What is not correct, and what this catches, is a bare
// `var(--accent)` used where a COLOUR is expected: it expands to `192 100% 62%`, which is not
// a colour, so the declaration is invalid at computed-value time. Per CSS custom-property
// resolution that makes it `unset` — it does NOT fall back to the lower-priority rule
// underneath, it silently paints `currentColor`/`transparent`/nothing.
//
// The whole class is invisible to tsc, to eslint and to review: the markup carries the token,
// names the right colour, and reads as live. It shipped 32 dead declarations at once, including
// BOTH app-wide focus rings (`.head .f`, `.sys .r`, `.list .r`, `.nav a`) — a WCAG 2.4.7 failure
// with nothing red anywhere. The tell is that the sibling longhands still compute:
// `outline-offset: -3px` was live while `outline-style` read `none`.
//
// It reads app/globals.css rather than mirroring it, for the same reason motion-loops.mjs does:
// the CSS *is* the fact here. There is no allowlist and there is deliberately no room for one —
// a bare triplet in a colour position is never a matter of taste, it is always dead CSS.
//
// Dependency-free and runs before `npm ci` in CI, same as the other three.
//
// KNOWN CEILING, named rather than hidden: "colour position" is not parsed. The rule enforced is
// the tighter, simpler invariant that has the same effect — a bare-triplet token may appear ONLY
// as a direct channel argument to hsl()/rgb() (where the triplet IS the channel list), or as the
// whole value of another custom property (`--surface: var(--navy-900)`, one triplet aliasing
// another). Anything else fails, including inside color-mix()/oklch()/lab()/lch()/color(), whose
// arguments must each be a full <color> rather than a channel list — a bare triplet there is
// exactly as invalid as anywhere else. That over-approximates "colour position", and the
// over-approximation has no false positives in this tree because there is no legal third use.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, resolve } from 'node:path';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS_PATH = resolve(APP_ROOT, 'app/globals.css');
const SOURCE_ROOTS = ['app', 'components', 'core', 'hooks', 'lib'];

/**
 * The wrappers that take a bare triplet DIRECTLY as their own channel arguments — `hsl(H S L)`,
 * `rgb(R G B)`. `color-mix()` is deliberately excluded: its arguments must each be a full
 * `<color>`, not a channel list, so `color-mix(in srgb, var(--accent) 20%, black)` is just as
 * invalid as a bare `var(--accent)` anywhere else — it needs `hsl(var(--accent))` inside it.
 */
const COLOUR_FN = /(?:hsla?|rgba?)\($/;

/**
 * A BARE TRIPLET, and the shape is what makes this safe to run without an allowlist. Only these
 * four forms are channel lists; everything else declared with a leading digit carries a unit
 * (`--shadow-sm: 0 8px 20px …`, `--tap: 44px`) or is two numbers (`--plate-ar: 16 / 10`), and a
 * bare `var()` of THOSE is legal in the position they are written for.
 */
const TRIPLET = [
  /^[\d.]+\s+[\d.]+%\s+[\d.]+%$/,                    // HSL:  192 100% 62%
  /^[\d.]+\s+[\d.]+%\s+[\d.]+%\s*\/\s*[\d.]+$/,      // HSL + alpha
  /^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/,                   // RGB channels:  10 8 24
  /^\d{1,3}\s+\d{1,3}\s+\d{1,3}\s*\/\s*[\d.]+$/,     // RGB + alpha:   207 198 224 / 0.14
  /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/,                 // RGB, comma form:  62, 216, 255
];
const isTriplet = (value) => TRIPLET.some((re) => re.test(value.trim()));

/**
 * Comments blanked IN PLACE so line numbers survive and a token named in prose is not a hit.
 * The trailing-`//` pass is wider than motion-loops.mjs's leading-`//` one because the rule this
 * audit enforces is itself documented inline mid-expression (`: // \`hsl(var(--accent))\`, NOT
 * \`var(--accent)\``), which a leading-only strip reports as a defect. `[^:]` keeps `https://`.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .split('\n')
    .map((line) => (/^\s*\*/.test(line) ? '' : line));
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The audit itself, over already-comment-stripped lines. Returns one entry per bare use.
 * Exported shape is `{ line, token, text }`; the caller adds the file.
 */
function bareUses(lines, tokens) {
  const hits = [];
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)(?![-\w])/g)) {
      if (!tokens.has(m[1])) continue;
      const before = line.slice(0, m.index);
      // legal 1: wrapped in hsl()/rgb(), possibly with other channel arguments before it
      if (COLOUR_FN.test(before) || /(?:hsla?|rgba?)\([^()]*$/.test(before)) continue;
      // legal 2: one triplet aliasing another, e.g. `--surface: var(--navy-900);`
      if (/(^|[;{])\s*--[\w-]+\s*:\s*$/.test(before)) continue;
      hits.push({ line: i + 1, token: m[1], text: line.trim() });
    }
  });
  return hits;
}

// ── self-test: the detector's own cases, so a rule that stops matching fails HERE ────────────
if (process.argv.includes('--self-test')) {
  const tokens = new Set(['--accent', '--navy-900']);
  const must = [
    ['  outline: 2px solid var(--accent);', 1],
    ['  background: var(--accent);', 1],
    ['  box-shadow: inset 3px 0 0 var(--accent);', 1],
    ["  className=\"border-[color:var(--accent)]\"", 1],
    ["  className=\"shadow-[inset_3px_0_0_var(--accent)]\"", 1],
    ['  color: hsl(var(--accent));', 0],
    ['  background: hsl(var(--accent) / 0.1);', 0],
    ['  background: rgb(var(--navy-900) / 0.5);', 0],
    // color-mix() args must each be a full <color>, not a channel list — a bare triplet
    // here is exactly as invalid as anywhere else, so this must count as a hit.
    ['  border: 1px solid color-mix(in srgb, var(--accent) 20%, black);', 1],
    ['  border: 1px solid color-mix(in srgb, hsl(var(--accent)) 20%, black);', 0],
    ['  --surface: var(--navy-900);', 0],
    ['  outline: 2px solid var(--border-ui);', 0],
  ];
  const bad = must.filter(([line, want]) => bareUses([line], tokens).length !== want);
  if (bad.length) {
    console.log(`SELF-TEST FAILED — ${bad.length} case(s) the detector no longer classifies correctly:`);
    for (const [line, want] of bad) console.log(`  expected ${want} hit(s): ${line.trim()}`);
    process.exit(1);
  }
  if (!isTriplet('192 100% 62%') || !isTriplet('10 8 24') || !isTriplet('62, 216, 255') ||
      isTriplet('0 8px 20px -12px rgba(0,0,0,0.7)') || isTriplet('16 / 10') || isTriplet('44px')) {
    console.log('SELF-TEST FAILED — the triplet classifier no longer separates channel lists from lengths');
    process.exit(1);
  }
  console.log(`token-wrapper self-test: ${must.length} detector cases + 6 classifier cases OK`);
  process.exit(0);
}

// ── 1. which tokens are bare triplets ────────────────────────────────────────────────────────
const css = readFileSync(CSS_PATH, 'utf8');
const tokens = new Set();
for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) if (isTriplet(m[2])) tokens.add(m[1]);

// ── 2. every bare use of one, in the CSS and in the source that consumes it ──────────────────
const problems = [];
let filesScanned = 0;
for (const root of SOURCE_ROOTS) {
  for (const file of sourceFiles(resolve(APP_ROOT, root))) {
    filesScanned++;
    const where = relative(APP_ROOT, file).replace(/\\/g, '/');
    for (const hit of bareUses(stripComments(readFileSync(file, 'utf8')), tokens)) {
      problems.push(`${where}:${hit.line}  bare var(${hit.token}) in a colour position — wrap it: hsl(var(${hit.token}))\n      ${hit.text.slice(0, 150)}`);
    }
  }
}

// ── 3. verdict ───────────────────────────────────────────────────────────────────────────────
console.log(`bare-triplet wrapper audit · ${tokens.size} triplet token(s) · ${filesScanned} file(s)\n`);
console.log('  ' + [...tokens].sort().join('\n  ') + '\n');

// FAILS CLOSED, twice. Either number at zero means the parser or the roots moved, at which point
// the clean verdict above is vacuous — which is the failure mode a green run hides.
if (tokens.size === 0) problems.push('app/globals.css: no bare-triplet tokens found — the declaration parser stopped matching and this audit proves nothing');
if (filesScanned === 0) problems.push(`no files scanned under ${SOURCE_ROOTS.join('/')} — the roots moved and this audit proves nothing`);

if (problems.length) {
  console.log(problems.length + ' PROBLEM(S):');
  for (const p of problems) console.log('  · ' + p);
} else {
  console.log('NO BARE TRIPLET IN A COLOUR POSITION');
}
process.exit(problems.length ? 1 : 0);
