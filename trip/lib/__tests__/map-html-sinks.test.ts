import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * No app-owned code may hand a string to an HTML sink.
 *
 * Dependabot reports a critical XSS in maplibre-gl (a `DOM.sanitize()` bypass, vulnerable
 * <= 6.4.0, patched 6.4.1). We pin 5.24.0 and are NOT upgrading for it, because the sink is
 * unreachable here: `DOM.sanitize` has exactly one production caller in maplibre,
 * `AttributionControl`, whose only inputs are `options.customAttribution` (we pass none) and a
 * source's `attribution`, which for us is `MAP_ATTRIBUTION` — a module-level string literal in
 * lib/map-style.ts that no trip data reaches. Popups use `setDOMContent` with a React portal.
 *
 * That analysis is only true while it stays true, and one careless line undoes it. This file is
 * the thing that notices:
 *
 *   `setHTML(`             maplibre's popup.ts does `temp.innerHTML = html` with NO sanitiser at
 *                          all, in 5.x and 6.x alike. Converting a popup from `setDOMContent` to
 *                          `setHTML` with a place name in it is stored XSS that no upgrade fixes.
 *   `customAttribution`    re-opens the actual reported sink.
 *   `dangerouslySetInnerHTML`  the general case.
 *
 * Why this is not paranoia, and why deleting it would be a mistake: the live Firestore ruleset
 * has no auth floor. An unauthenticated read of a trip document answers 404 (rule passed), not
 * 403, and the subtree list answers 200 — so anyone holding a trip id can write to that trip.
 * Place names and item titles are attacker-controllable in practice, not just in theory. The
 * sink being unreachable is the whole of our defence.
 *
 * Same shape as text-tier-sweep.test.ts: walk the tree rather than keep an allowlist, so a file
 * that does not exist yet is covered the moment someone adds it.
 */

const ROOT = resolve(__dirname, '../../');
const ROOTS = ['app', 'components', 'core', 'hooks', 'lib'];

const SINKS: { name: string; pattern: RegExp; why: string }[] = [
  {
    name: 'setHTML(',
    pattern: /\bsetHTML\s*\(/,
    why: "maplibre's Popup.setHTML assigns straight to innerHTML with no sanitiser. Use setDOMContent (see trip-map.tsx) and render the content as React.",
  },
  {
    name: 'customAttribution',
    pattern: /\bcustomAttribution\b/,
    why: 'this is the input to the maplibre DOM.sanitize() bypass. Attribution must stay the literal MAP_ATTRIBUTION in lib/map-style.ts.',
  },
  {
    name: 'dangerouslySetInnerHTML',
    pattern: /\bdangerouslySetInnerHTML\b/,
    why: 'renders an unsanitised string as markup. Render the value as a React child instead.',
  },
];

/** Every .ts/.tsx under the app's own source roots. Tests and node_modules are not app code. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
  };
  for (const dir of ROOTS) walk(dir);
  return out;
}

describe('no HTML sink in app-owned source', () => {
  const files = sourceFiles();

  // Fails CLOSED. A bad root or a walk that returned nothing would make the sweep below
  // vacuously green, which is the one way a guard like this dies quietly.
  it('the walk actually finds the app', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('components/trip-map.tsx');
    expect(files).toContain('lib/map-style.ts');
    expect(files).toContain('app/page.tsx');
  });

  // The instrument itself: each pattern must fire on a line that really does carry the sink.
  it.each(SINKS)('detects $name when it is present', ({ pattern }) => {
    const planted = [
      'popup.setHTML(`<b>${place.name}</b>`);',
      'new maplibregl.AttributionControl({ customAttribution: note });',
      '<div dangerouslySetInnerHTML={{ __html: place.name }} />',
    ];
    expect(planted.some((line) => pattern.test(line))).toBe(true);
  });

  it.each(SINKS)('no file under app/ components/ core/ hooks/ lib/ uses $name', ({ name, pattern, why }) => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(resolve(ROOT, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (pattern.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    expect(
      offenders,
      `\`${name}\` is back in:\n  ${offenders.join('\n  ')}\n\n${why}\n\n` +
        'The maplibre XSS advisory is survivable here only because no untrusted string reaches ' +
        'an HTML sink, and the live Firestore rules let anyone with a trip id write place names. ' +
        'Read this file\'s header before relaxing this.',
    ).toEqual([]);
  });
});
