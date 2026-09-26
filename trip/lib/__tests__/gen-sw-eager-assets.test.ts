// #489: precache floor is per-route, not aggregate.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { eagerStaticAssets } from '../../scripts/gen-sw.mjs';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gen-sw-out-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('eagerStaticAssets', () => {
  it('does not throw when many routes share one chunk ref', async () => {
    const html = '<script src="/_next/static/chunks/shared-abc123.js"></script>';
    await writeFile(join(dir, 'a.html'), html, 'utf8');
    await writeFile(join(dir, 'b.html'), html, 'utf8');
    const set = await eagerStaticAssets(['a.html', 'b.html'], dir);
    expect(set.size).toBe(1);
  });

  it('throws naming the file when a route HTML scrapes zero refs', async () => {
    await writeFile(join(dir, 'a.html'), '<script src="/_next/static/chunks/x.js"></script>', 'utf8');
    await writeFile(join(dir, 'b.html'), '<p>no static refs here</p>', 'utf8');
    await expect(eagerStaticAssets(['a.html', 'b.html'], dir)).rejects.toThrow('b.html');
  });

  // Proves main() runs under a cwd-relative argv[1] (the npm invocation shape).
  it('runs main() when invoked as `node scripts/gen-sw.mjs` (non-zero exit, no out/)', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'gen-sw-root-'));
    await mkdir(join(tempRoot, 'scripts'));
    await copyFile(
      resolve(__dirname, '../../scripts/gen-sw.mjs'),
      join(tempRoot, 'scripts', 'gen-sw.mjs')
    );
    try {
      const result = spawnSync('node', ['scripts/gen-sw.mjs'], {
        cwd: tempRoot,
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.status).not.toBeNull();
      expect(result.stderr).toContain('gen-sw: out/ not found');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
