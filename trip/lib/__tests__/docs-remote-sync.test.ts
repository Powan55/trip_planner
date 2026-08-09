// @vitest-environment jsdom
//
// S217 — WIRED-behavior unit suite for the docs-checklist Sync-v2 seam (lib/docs-remote.ts +
// lib/docs-ports.ts), against a FAKE Firestore (the firebase SDK modules are vi.mock'd) + the real
// merge core. The "the wiring is correct off a live server" proof the two-client E2E cannot run in
// the dormant sandbox (no firebase env). Proves, on a real run:
//
//   1. pushChecklistMerged composes the transactional read→merge→set: a concurrent peer row on a
//      DIFFERENT item is NOT clobbered — both survive (the DoD's two-clients convergence).
//   2. A same-item concurrent edit converges by HLC (higher hlc wins, argument-order-independent).
//   3. The outbox-decorated SyncPort.push issues ONE merged write on the single 'checklist' doc when
//      the row-set changed, and NO write when it did not (D-088/D-151).
//   4. The new 'docs' domain shows up in the sync-status badge's pending sum with ZERO badge edits
//      (D-193/S229 N-domain tolerance) — one enqueue via the decorated push, read back through the
//      same outboxSnapshot the badge hook uses.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DocItem } from '@/core/docs/model';
import { mergeItems } from '@/core/sync/merge-items';

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => true,
  getTripId: () => 'nepal-japan-2026',
}));
// The outbox-decorated push gates on an active traveler (D-055); mock one in.
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

const TRIP_ID = 'nepal-japan-2026';
const DOC_PATH = `trips/${TRIP_ID}/docs/checklist`;
type DocData = Record<string, unknown>;

class FakeFirestore {
  docs = new Map<string, DocData>();
  failWrites = false; // when true, tx.set throws → push rejects → outbox keeps the chunk dirty
  setDocData(path: string, data: DocData) {
    this.docs.set(path, JSON.parse(JSON.stringify(data)));
  }
}
const fake = new FakeFirestore();
const writeLog: string[] = [];

function pathOf(segments: string[]): string {
  return segments.join('/');
}

vi.mock('firebase/app', () => ({
  initializeApp: () => ({ name: 'fake' }),
  getApps: () => [],
  getApp: () => ({ name: 'fake' }),
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => fake,
  collection: (_db: unknown, ...segs: string[]) => ({ __type: 'collection', path: pathOf(segs) }),
  doc: (_db: unknown, ...segs: string[]) => ({ __type: 'doc', path: pathOf(segs) }),
  runTransaction: async (
    _db: unknown,
    update: (tx: {
      get: (ref: { path: string }) => Promise<{ exists: () => boolean; data: () => DocData | undefined }>;
      set: (ref: { path: string }, data: DocData) => void;
    }) => Promise<void>,
  ) => {
    const tx = {
      get: async (ref: { path: string }) => {
        const data = fake.docs.get(ref.path);
        return { exists: () => data !== undefined, data: () => data };
      },
      set: (ref: { path: string }, data: DocData) => {
        if (fake.failWrites) throw new Error('transport down');
        writeLog.push(`tx-set:${ref.path}`);
        fake.setDocData(ref.path, data);
      },
    };
    await update(tx);
  },
}));

import { pushChecklistMerged } from '@/lib/docs-remote';
import { docsSyncPort } from '@/lib/docs-ports';
import { outboxSnapshot } from '@/core/sync/outbox';
import type { Firestore } from 'firebase/firestore';
import * as fs from 'firebase/firestore';

function item(id: string, over: Partial<DocItem> = {}): DocItem {
  return { id, section: 'critical', label: id, checked: false, rev: 1, hlc: `000000000001000:000000:${id}`, ...over };
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  localStorage.clear();
  fake.docs.clear();
  writeLog.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('pushChecklistMerged — transactional read→merge→set converges two clients (DoD)', () => {
  it('a concurrent peer toggle on a DIFFERENT item is not clobbered (both survive)', async () => {
    // Remote already holds friend-B's checked "visa".
    fake.setDocData(DOC_PATH, {
      version: 1,
      items: [item('visa', { checked: true, hlc: '000000000002000:000000:friendB' })],
    });
    // We push OUR local rows, which only know a checked "passport".
    await pushChecklistMerged(fake as unknown as Firestore, fs, [
      item('passport', { checked: true, hlc: '000000000003000:000000:me' }),
    ]);

    const written = fake.docs.get(DOC_PATH) as { items: DocItem[] };
    expect(written.items.map((e) => e.id).sort()).toEqual(['passport', 'visa']);
    expect(written.items.every((e) => e.checked)).toBe(true);
    expect(writeLog).toContain(`tx-set:${DOC_PATH}`);
  });

  it('a same-item concurrent edit converges by HLC (higher wins, order-independent)', async () => {
    // Remote: passport UNchecked at a LATER hlc. Local: passport checked at an EARLIER hlc.
    fake.setDocData(DOC_PATH, {
      version: 1,
      items: [item('passport', { checked: false, hlc: '000000000009000:000000:friendB' })],
    });
    await pushChecklistMerged(fake as unknown as Firestore, fs, [
      item('passport', { checked: true, hlc: '000000000004000:000000:me' }),
    ]);
    const written = fake.docs.get(DOC_PATH) as { items: DocItem[] };
    // The higher-hlc remote (unchecked) wins — and the same result the pure merge predicts.
    expect(written.items).toHaveLength(1);
    expect(written.items[0].checked).toBe(false);
    const pure = mergeItems(
      [item('passport', { checked: false, hlc: '000000000009000:000000:friendB' })],
      [item('passport', { checked: true, hlc: '000000000004000:000000:me' })],
    );
    expect(written.items[0].checked).toBe(pure[0].checked);
  });
});

describe('SyncPort.push (outbox-decorated) — ONE merged write on the single doc (D-088/D-151)', () => {
  it('a changed row-set issues exactly one tx-set on docs/checklist', async () => {
    const prev: DocItem[] = [item('passport', { checked: false })];
    const next: DocItem[] = [item('passport', { checked: true, hlc: '000000000005000:000000:me', rev: 2 })];
    await docsSyncPort.push(prev, next);
    await flush();
    expect(writeLog).toEqual([`tx-set:${DOC_PATH}`]);
  });

  it('an unchanged commit issues NO write (chunkDiff empty → no network)', async () => {
    const same: DocItem[] = [item('passport', { checked: true })];
    await docsSyncPort.push(same, same);
    await flush();
    expect(writeLog).toEqual([]);
  });
});

describe('sync-status badge — the new "docs" domain is counted with ZERO badge edits (D-193/S229)', () => {
  it('a failed docs push keeps the checklist chunk dirty under the "docs" key, counted in pending', async () => {
    expect(outboxSnapshot().dirty).toEqual({});
    fake.failWrites = true; // remote unreachable → the write-ahead enqueue persists, no ack
    const prev: DocItem[] = [item('passport', { checked: false })];
    const next: DocItem[] = [item('passport', { checked: true, rev: 2, hlc: '000000000006000:000000:me' })];
    await docsSyncPort.push(prev, next);
    await flush();
    const snap = outboxSnapshot();
    // The domain key is literally 'docs' and the badge hook's sum picks it up with no badge change.
    expect(snap.dirty).toEqual({ docs: ['checklist'] });
    expect(Object.values(snap.dirty).flat().length).toBe(1);
    fake.failWrites = false;
  });
});
