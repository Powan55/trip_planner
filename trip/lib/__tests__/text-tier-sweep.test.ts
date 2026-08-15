import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import tailwindConfig from '@/tailwind.config';

/**
 * Issue #27 — the `text-white/NN` alpha ramp is replaced by three solid tiers, ONE ROUTE AT A
 * TIME. This is the ratchet: a route that has been swept must never quietly get the ramp back,
 * which is the realistic failure mode when 80 other files still carry it and the next author
 * copies a class string across.
 *
 * TO EXTEND: convert your route, then add its file to SWEPT. Nothing else. The mapping from the
 * old alphas to the three tiers, and the role rule that decides which tier a site takes, are
 * recorded beside the token declarations in app/globals.css — read that rather than re-deriving
 * per route, and note that the ramp's WRITTEN alpha is not always its RENDERED one (Tailwind's
 * default opacity scale has no /55 or /85 step, so those sites are painted by inheritance or by
 * the @layer utilities floor instead).
 *
 * The floor block in globals.css and `FADE_FLOOR` in lib/motion.ts stay until SWEPT covers every
 * file — the 80 unswept ones still depend on both.
 */

/** Routes converted so far. One entry per landed slice. */
const SWEPT = [
  'components/docs-checklist.tsx',
  // Issue #26 (the Home hero). Converted because the sweep was FORCED, not opportunistic:
  // the hero's copy sits over a photograph, and a photograph has no fixed colour to measure
  // an alpha-on-white against. The three tiers gave it one. The scrim floor that makes those
  // ratios true is measured in scripts/contrast-tokens.mjs, and the rule the hero adds on top
  // of the general one is: over the photograph, ink-lo is a decorative mark and never a word.
  'components/hero-section.tsx',
  // Born on the tiers rather than converted onto them — listed anyway, because the ratchet
  // is about what gets copied INTO a file later, and a brand-new Home section sitting next
  // to 80 files that still carry the ramp is exactly where a class string gets pasted.
  'components/home-stat-row.tsx',
  // Issue #25 (the front door) — BOTH views of the wall, and the same forcing that took the
  // Home hero: the landing's cover copy sits over a photograph, and a photograph has no fixed
  // colour to measure an alpha-on-white against. The auth card came with it rather than being
  // left half-swept, since one file renders both and a class string crosses that boundary in
  // one keystroke. The rule the front door adds on top of the general one is the hero's,
  // restated: over the photograph, ink-lo is a decorative mark and never a word.
  'components/landing-page.tsx',
  'components/token-gate.tsx',
];

const read = (rel: string) => readFileSync(resolve(__dirname, '../../', rel), 'utf8');

describe('issue #27 — swept routes hold the three-tier line', () => {
  // Fails CLOSED: an empty list, or a path typo that reads an empty file, would make every
  // assertion below vacuously true.
  it('SWEPT is non-empty and every entry is a real, non-trivial file', () => {
    expect(SWEPT.length).toBeGreaterThan(0);
    for (const f of SWEPT) expect(read(f).length, f).toBeGreaterThan(500);
  });

  it.each(SWEPT)('%s uses no `text-white/NN` alpha', (file) => {
    const hits = read(file).match(/text-white\/[0-9[]/g) ?? [];
    expect(hits, `${file} reintroduced the alpha ramp: ${hits.join(', ')}`).toEqual([]);
  });

  it.each(SWEPT)('%s actually paints its text with the tiers (not just stripped of colour)', (file) => {
    expect(read(file)).toMatch(/text-ink-(hi|mid|lo)\b/);
  });

  it('the tier utilities resolve to the tier tokens, and there is no fourth tier', () => {
    const ink = (tailwindConfig.theme?.extend?.colors as Record<string, unknown> | undefined)?.ink;
    expect(ink).toEqual({ hi: 'var(--text-hi)', mid: 'var(--text-mid)', lo: 'var(--text-lo)' });

    // A tier class pointing at a var nobody declares would paint nothing at all, and would do it
    // silently — so tie the Tailwind key to the declaration in the same assertion.
    const css = read('app/globals.css');
    for (const v of ['--text-hi: #FFFFFF', '--text-mid: #CFC6E0', '--text-lo: #A79BC0'])
      expect(css, `globals.css no longer declares ${v}`).toContain(v);
  });

  it('the AA floor for every UNSWEPT route is still in place', () => {
    // 80 files still carry the ramp (D-235/D-246). Deleting the floor before the sweep finishes
    // drops each of them below AA at once, which is the one way this issue can do real harm.
    const css = read('app/globals.css');
    // ALL EIGHT, not just the ends. Pinning only /25 and /60 let someone delete the /35, /45 or
    // /55 selectors — the middle of the ramp — and stay green while dropping unswept routes below
    // AA, which is the precise harm this assertion exists to prevent.
    for (const step of [25, 30, 35, 40, 45, 50, 55, 60])
      expect(css, `the floor no longer covers text-white/${step}`).toContain(
        `[class~='text-white/${step}']`,
      );
    expect(css).toContain('color: rgb(255 255 255 / 0.62)');
    // FADE_FLOOR is the other half of the same bargain: the spec retires it only once every route
    // is swept, and this file's own docblock promises it stays until then. Promise, meet check.
    expect(read('lib/motion.ts'), 'FADE_FLOOR was lowered or removed before the sweep finished').toContain(
      'FADE_FLOOR = 0.95',
    );
  });
});
