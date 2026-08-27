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
});
