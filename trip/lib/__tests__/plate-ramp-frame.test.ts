import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';

/**
 * The `.plate` ramp is the legibility scrim over photography, and it only has a size because
 * `.plate .frame` is a grid it spans (`grid-area: 1 / 1 / 3 / 2`). Nested anywhere else it
 * collapses to height 0 and the gradient never paints — silently, because the class still
 * reads as live in source.
 *
 * Two things make that invisible to review. `.plate .ramp` is (0,2,0) and sets
 * `position: relative`, so an `absolute inset-0` utility on the element is (0,1,0) and loses;
 * Tailwind 3.3.3 emits no native `@layer` here, so plain specificity decides. And a ramp with
 * no `.frame` parent has no grid row to take a height from either. Five call sites shipped
 * that way and measured h=0 in Chromium against the compiled stylesheet.
 *
 * So the structural rule is the guard: a ramp must sit inside a `.frame`.
 */

const ROOT = resolve(__dirname, '../../');

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.tsx')) out.push(rel.replace(/\\/g, '/'));
    }
  };
  walk('app');
  walk('components');
  return out;
}

/** The whitespace-separated class tokens of a JSX element. `empty-frame` stays one token. */
function classTokens(el: ts.JsxOpeningLikeElement): string[] {
  const attr = el.attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === 'className',
  );
  if (!attr?.initializer) return [];
  return attr.initializer
    .getText()
    .replace(/\$\{[^}]*\}/g, ' ')
    .replace(/[`"'{}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function hasAncestorClass(node: ts.Node, cls: string): boolean {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isJsxElement(cur) && classTokens(cur.openingElement).includes(cls)) return true;
  }
  return false;
}

function ramps() {
  const found: { file: string; line: number; framed: boolean }[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(resolve(ROOT, file), 'utf8');
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        if (classTokens(node).includes('ramp')) {
          found.push({
            file,
            line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            framed: hasAncestorClass(node, 'frame'),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return found;
}

describe('.plate ramp — the scrim only has a height inside a .frame', () => {
  const sites = ramps();

  // Fails CLOSED: a broken walk or a renamed class would make the sweep below vacuously true.
  it('the scan actually finds the ramps', () => {
    expect(sites.length).toBeGreaterThanOrEqual(8);
    expect(sites.map((s) => s.file)).toContain('components/travel-inspiration.tsx');
    expect(sites.map((s) => s.file)).toContain('components/trip-map.tsx');
  });

  it('every ramp has a .frame ancestor', () => {
    const orphans = sites.filter((s) => !s.framed).map((s) => `${s.file}:${s.line}`);
    expect(orphans).toEqual([]);
  });

  /**
   * The other half of the same defect. The ramp spans both grid rows, so the alpha under the
   * caption is decided by where row 2 starts — literal stops were correct for the 56% default
   * and dropped the 42% modifiers to 0.307. Written as offsets from `--plate-split` both splits
   * land on 0.753.
   *
   * `contrast-check` cannot see a regression here any more: scripts/contrast-tokens.mjs derives
   * both plate rows from one `PLATE_ROW_TOP`, so re-hardcoded stops print identically and stay
   * green. This is the only check left that reads the stops themselves.
   */
  it('the ramp stops are offsets from --plate-split, not literal percentages', () => {
    const css = readFileSync(resolve(ROOT, 'app/globals.css'), 'utf8');
    const body = css.slice(css.indexOf('.plate .ramp {'));
    const grad = body.slice(0, body.indexOf('}')).match(/linear-gradient\(([\s\S]*)\)/)?.[1] ?? '';

    // `var(--plate-split, 56%)` carries a comma of its own, so split the stop list at depth 0.
    const args: string[] = [];
    let depth = 0;
    let cur = '';
    for (const ch of grad) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        args.push(cur);
        cur = '';
      } else cur += ch;
    }
    args.push(cur);

    const stops = args.flatMap((arg) => {
      const m = arg
        .replace(/\s+/g, ' ')
        .trim()
        .match(/^rgb\(\s*var\(--scrim-ink-rgb\)\s*\/\s*([\d.]+)\s*\)\s*(.+)$/);
      return m ? [{ alpha: Number(m[1]), pos: m[2] }] : [];
    });

    // Fails CLOSED: a moved selector or a reworded colour would empty the sweep below.
    expect(stops.map((s) => s.alpha), 'the scan no longer finds the ramp stops').toEqual([
      0, 0, 0.69, 0.88, 0.97,
    ]);

    // Structural, not an exact string — only `0%`, the top anchor, may be a literal.
    const relative = /^calc\(\s*var\(--plate-split[^)]*\)\s*[-+]\s*[\d.]+%\s*\)$/;
    const hardcoded = stops
      .filter((s) => s.pos !== '0%' && !relative.test(s.pos))
      .map((s) => `${s.alpha} at ${s.pos}`);
    expect(
      hardcoded,
      `ramp stops no longer track --plate-split:\n  ${hardcoded.join('\n  ')}\n` +
        'A literal percentage is correct for one split and wrong for the modifiers.',
    ).toEqual([]);

    // The bracketing pair specifically: contrast-tokens.mjs weights the row line 4/12 of the way
    // from 0.69 to 0.88, which is only true while these two offsets are -4% and +8%.
    const posOf = (alpha: number) => stops.find((s) => s.alpha === alpha)?.pos;
    expect(posOf(0.69), 'the 0.69 stop moved off split-4%').toMatch(
      /^calc\(\s*var\(--plate-split[^)]*\)\s*-\s*4%\s*\)$/,
    );
    expect(posOf(0.88), 'the 0.88 stop moved off split+8%').toMatch(
      /^calc\(\s*var\(--plate-split[^)]*\)\s*\+\s*8%\s*\)$/,
    );
  });
});
