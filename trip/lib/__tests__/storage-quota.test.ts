import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { QUOTA_WARN_THRESHOLD } from '../storage-quota';

const ROOT = resolve(__dirname, '../..');
const source = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');

// The constant's value is not worth asserting; where it can be imported from is. This file
// exists so the near-quota toast, which is mounted in the root layout, can read the number
// without dragging `lib/preflight.ts` into the root layout's chunk graph. Preflight carries
// the literal `maplibregl`, which two consumers use as "this chunk IS the map engine", so a
// root-layout chunk that contains it gets evicted under storage pressure and takes every
// route offline with it. `e2e/pwa.spec.ts` proves the whole chain; these three assertions
// are the cheap direct guard on the two files that can undo it.
describe('QUOTA_WARN_THRESHOLD', () => {
  it('is imported by the root-layout toast from here, not from preflight', () => {
    const toast = source('components/storage-persistence.tsx');

    // Unanchored: the import that would do the damage is as likely to be the multi-line
    // form `components/preflight-checks.tsx` uses as a one-liner.
    expect(toast).toContain("from '@/lib/storage-quota'");
    expect(toast).not.toMatch(/from '@\/lib\/preflight'/);
  });

  it('lives in a module that imports nothing itself', () => {
    expect(source('lib/storage-quota.ts')).not.toMatch(/^import\s+(?!type\b)/m);
  });

  it('is re-exported by preflight rather than declared there a second time', async () => {
    const preflight = await import('../preflight');

    expect(preflight.QUOTA_WARN_THRESHOLD).toBe(QUOTA_WARN_THRESHOLD);
    expect(source('lib/preflight.ts')).not.toMatch(/^export const QUOTA_WARN_THRESHOLD/m);
  });
});
