import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import tailwindConfig from '@/tailwind.config';

/**
 * Issue #27 — the `text-white/NN` alpha ramp is replaced by three solid tiers. THE SWEEP IS
 * FINISHED: all ~729 sites across 84 files are on `--text-hi/-mid/-lo`, so this file stopped
 * being a per-route allowlist and became a repo-wide gate.
 *
 * WHY THE LIST WENT AWAY. While the sweep ran, `SWEPT` named the routes already converted and
 * the ratchet only guarded those — everything unlisted was expected to still carry the ramp.
 * That shape cannot express "nobody may reintroduce it anywhere", and reintroduction is the
 * whole failure mode now: the next author copies a class string out of git history into a file
 * that was never on the list, and an allowlist stays green. Walking the tree instead means a
 * NEW file is covered the moment it exists, which an allowlist can never manage.
 *
 * The mapping from the old alphas to the three tiers, and the role rule that decides which tier
 * a site takes, are recorded beside the token declarations in app/globals.css. Read that rather
 * than re-deriving per site — including the settled recurring calls and the one contrast-driven
 * exception over photography.
 *
 * The `@layer utilities` floor block is GONE, deleted with the last of the ramp, and this file
 * now asserts its ABSENCE — a floor matching an empty set cannot fail loudly, so keeping it
 * would have let a future `text-white/40` inherit AA cover instead of being caught here.
 * `FADE_FLOOR` in lib/motion.ts STAYS: it guards a wrapper opacity dimming text mid-entrance,
 * which is a different defect that solid tiers do not touch.
 */

const ROOT = resolve(__dirname, '../../');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

/** Every .tsx/.ts under app/ and components/ — the surfaces that carry text. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(entry.name)) out.push(rel.replace(/\\/g, '/'));
    }
  };
  walk('app');
  walk('components');
  return out;
}

describe('issue #27 — the three-tier line holds across every surface', () => {
  const files = sourceFiles();

  // Fails CLOSED: a walk that returned nothing, or a bad root, would make the sweep below
  // vacuously true. 84 files carried the ramp when it finished, so the tree is far larger.
  it('the file walk actually finds the app', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files).toContain('components/docs-checklist.tsx');
    expect(files).toContain('app/page.tsx');
  });

  it('no file under app/ or components/ carries a `text-white/NN` alpha', () => {
    const offenders = files
      .map((f) => ({ f, hits: read(f).match(/text-white\/[0-9[]/g) ?? [] }))
      .filter((r) => r.hits.length > 0)
      .map((r) => `${r.f} (${r.hits.length})`);
    expect(
      offenders,
      `the alpha ramp is back in:\n  ${offenders.join('\n  ')}\n` +
        'Use text-ink-hi / -mid / -lo. The role rule is in app/globals.css beside the tokens.',
    ).toEqual([]);
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

  it('the retired AA floor is really gone, not merely unused', () => {
    // The inverse of the assertion this file used to carry. While the ramp existed, deleting the
    // floor dropped every unswept route below AA at once; now the ramp is gone, KEEPING the floor
    // is the hazard, because it would silently re-cover any reintroduced alpha and stop the sweep
    // above from being the thing that fails.
    const css = read('app/globals.css');
    for (const step of [25, 30, 35, 40, 45, 50, 55, 60])
      expect(css, `the retired floor still covers text-white/${step}`).not.toContain(
        `[class~='text-white/${step}']`,
      );
    expect(css).not.toContain('color: rgb(255 255 255 / 0.62)');
  });

  it('FADE_FLOOR stays — it guards entrances, not the ramp', () => {
    // Deliberately NOT retired with the floor, though an older note in globals.css paired them.
    // A wrapper `opacity` during an entrance multiplies whatever colour it contains, solid tiers
    // included, so text can still be sampled sub-AA mid-fade. Several e2e specs settle an
    // entrance before scanning for exactly this reason.
    expect(read('lib/motion.ts'), 'FADE_FLOOR was lowered or removed').toContain(
      'FADE_FLOOR = 0.95',
    );
  });
});
