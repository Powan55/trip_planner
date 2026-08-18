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
