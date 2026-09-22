// `scripts/release-gate.mjs` must refuse a release whose own RELEASES.md heading says
// it is held. It did not: the check was `releases.includes('## <tag> ')`, the marker is a
// SUFFIX on the heading, so `## v6.0.0 (app) · NOT DEPLOYED · ...` satisfied a check whose
// comment claimed it did not. The gate printed "v6.0.0 is clear to ship" and exited 0 — on
// the only automated signal the dev -> main pull request has, and that merge deploys.
//
// WHY A CHILD PROCESS AND NOT AN IMPORT. The gate is a dependency-free .mjs script that reads
// its inputs from cwd and reports through `::error::` on stderr; CI runs the file, not a
// function. Running the real file against a fixture cwd tests the artifact that ships and
// cannot drift from it, which exporting helpers for the test to call would immediately allow.
//
// ASSERT ON THE MESSAGE, NOT THE EXIT CODE. The fixture directory is not a git repository, so
// the tag assertions fail there too and every run exits 1. Pinning the specific refusal text
// keeps this file about the heading scan and nothing else.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// lib/__tests__ -> trip/ -> repo root. Same `resolve(__dirname, ...)` shape the other
// disk-reading specs here use (text-tier-sweep, motion-budget).
const SCRIPT = resolve(__dirname, '../../../scripts/release-gate.mjs');
const NOTES_SCRIPT = resolve(__dirname, '../../../scripts/release-notes.mjs');

const VERSION = '6.0.0';

/** Runs the real gate against a throwaway tree holding just the two files it reads. */
function runGate(heading: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-gate-'));
  try {
    mkdirSync(join(dir, 'trip', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'trip', 'package.json'), JSON.stringify({ version: VERSION }));
    writeFileSync(
      join(dir, 'trip', 'docs', 'RELEASES.md'),
      `# Releases\n\n---\n\n${heading}\n\nWhat shipped.\n`,
    );
    try {
      // process.execPath rather than 'node' so the child is this run's interpreter.
      return execFileSync(process.execPath, [SCRIPT], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      // The gate exits 1 here (no tags in a non-repo), so both streams come off the error.
      const e = err as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs the real notes extractor against the same heading shape the gate receives. */
function runNotes(heading: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    mkdirSync(join(dir, 'trip', 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'trip', 'docs', 'RELEASES.md'),
      `# Releases\n\n## v6.0.1 Next\n\nOther.\n\n---\n\n${heading}\n\nWhat shipped.\n`,
    );
    return execFileSync(process.execPath, [NOTES_SCRIPT, `v${VERSION}`], {
      cwd: dir,
      encoding: 'utf-8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HELD = /::error::.*marks v6\.0\.0 as held/;

describe('release-gate refuses a held release', () => {
  it('refuses a heading carrying NOT DEPLOYED, and quotes it', () => {
    const out = runGate(
      '## v6.0.0 (app) · NOT DEPLOYED · prepared 2026-08-16 · worker stays at v1.8.0',
    );
    expect(out).toMatch(HELD);
    expect(out).toContain('NOT DEPLOYED · prepared 2026-08-16');
  });

  it('refuses the leading-marker form too, emphasis and all', () => {
    expect(runGate('## ⛔ v6.0.0 (app) — BUILT 2026-08-16 · **NOT DEPLOYED**')).toMatch(HELD);
  });

  it('lets a deployed heading through — "DEPLOYED" is not "NOT DEPLOYED"', () => {
    // Shaped on the real v5.11.2 entry, which is the line a laxer marker test would break.
    const out = runGate(
      '## v6.0.0 (app) + v1.8.0 (worker) — 2026-08-09 · **DEPLOYED**: the first live deploy',
    );
    expect(out).not.toMatch(HELD);
    expect(out).toContain('ok   trip/docs/RELEASES.md documents v6.0.0');
  });

  it('says something different when there is no entry at all', () => {
    // A near miss, not a typo: the whole-token scan must not read v6.0.01 as v6.0.0.
    const out = runGate('## v6.0.01 (app) · 2026-08-16');
    expect(out).not.toMatch(HELD);
    expect(out).toContain('::error::trip/docs/RELEASES.md has no "## v6.0.0" heading');
  });
});

describe('release heading matching is shared by the gate and notes extractor (#450)', () => {
  it('extracts the same emphasized whole-token heading that the gate classifies', () => {
    const heading = '## **v6.0.0** (app) · NOT DEPLOYED';
    expect(runGate(heading)).toMatch(HELD);
    expect(runNotes(heading)).toBe(`${heading}\n\nWhat shipped.\n`);
  });
});

/**
 * Runs the real gate against a throwaway tree that IS a git repository, so the tag
 * assertions have something to read. `runGate` above deliberately does not, which is why
 * it cannot reach the preamble comparison at all.
 */
function runGateInRepo(opts: { version: string; tags: string[]; preamble?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-gate-repo-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    mkdirSync(join(dir, 'trip', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'trip', 'package.json'), JSON.stringify({ version: opts.version }));
    const live = opts.preamble ? `The newest live app is \`v${opts.preamble}\`, deployed today.` : '';
    writeFileSync(
      join(dir, 'trip', 'docs', 'RELEASES.md'),
      `# Releases\n\n${live}\n\n---\n\n## v${opts.version} (app) · 2026-09-20\n\nWhat shipped.\n`,
    );
    git('init', '-q', '.');
    git('-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
    for (const t of opts.tags) git('tag', t);
    try {
      return execFileSync(process.execPath, [SCRIPT], {
        cwd: dir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The preamble comparison was coupled to the version-ordering verdict: `newestTag` was
// assigned only inside the "version went up" branch, so every other outcome left it null,
// skipped the comparison, and still printed "and preamble is current." on a preamble the
// gate had not looked at. That is the failure mode RELEASES.md's own preamble records
// three times over, on the check written to catch it.
describe('release-gate checks the preamble independently of the version ordering', () => {
  const CURRENT = 'and preamble is current';

  it('reports a stale preamble even when the version is NOT above the newest tag', () => {
    const out = runGateInRepo({ version: '7.3.0', tags: ['v7.3.0'], preamble: '7.2.0' });
    expect(out).toContain('::error::trip/docs/RELEASES.md preamble says the newest live app is v7.2.0');
    expect(out).toContain('the newest deploy tag is v7.3.0');
    expect(out).not.toContain(CURRENT);
  });

  it('still reports a stale preamble when the version IS above the newest tag', () => {
    const out = runGateInRepo({ version: '7.4.0', tags: ['v7.3.0'], preamble: '7.2.0' });
    expect(out).toContain('::error::trip/docs/RELEASES.md preamble says the newest live app is v7.2.0');
    expect(out).not.toContain(CURRENT);
  });

  it('passes a current preamble, and orders tags numerically while it does', () => {
    // v7.9.2 over v7.14.0 is the string-order trap the ordering helper exists for; the
    // preamble comparison reads the same value, so it inherits the trap.
    const out = runGateInRepo({ version: '7.15.0', tags: ['v7.9.2', 'v7.14.0'], preamble: '7.14.0' });
    expect(out).toContain(`ok   trip/docs/RELEASES.md documents v7.15.0 with no hold marker, ${CURRENT}`);
    expect(out).toContain('release-gate: v7.15.0 is clear to ship.');
  });

  it('says the preamble check was SKIPPED when no tag is visible, never that it is current', () => {
    const out = runGateInRepo({ version: '7.4.0', tags: [], preamble: '7.2.0' });
    expect(out).toContain('preamble check skipped');
    expect(out).not.toContain(CURRENT);
    // And the state that makes it unanswerable is itself a failure, so nothing goes green.
    expect(out).toContain('::error::No v*.*.* tags are visible');
  });
});

// Same shape, assertion 1: `git rev-parse` throws both when the tag is absent and when the
// directory is not a repository, and the catch read every throw as "absent" — so the check
// that refuses an already-deployed version announced a pass it had not made.
describe('release-gate does not claim a tag is absent when it could not look', () => {
  it('refuses to answer outside a git checkout', () => {
    const out = runGate('## v6.0.0 (app) · 2026-08-16');
    expect(out).not.toContain('has no deploy tag yet');
    expect(out).toContain('::error::git could not be asked whether tag v6.0.0 exists');
  });

  it('still passes a genuinely absent tag inside a repository', () => {
    const out = runGateInRepo({ version: '7.4.0', tags: ['v7.3.0'], preamble: '7.3.0' });
    expect(out).toContain('ok   7.4.0 has no deploy tag yet (v7.4.0 absent).');
  });
});
