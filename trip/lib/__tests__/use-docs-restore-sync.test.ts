// @vitest-environment jsdom
//
// Issue #295 (deliberately-deferred remainder of #239), docsChecklist half — regression suite for
// whole-checklist RESTORE under sync (`restoreDocsChecklist`). Unlike myPlaces/expenses, docsChecklist
// has a FIXED 18-id template with no add/remove path, so the restore-shaped commit here is a SAME-ID
// UPSERT (`mergeItems(current, backup)`) rather than a tombstone-replace + fresh-id re-add. Exercised
// by RENDERING the real hook (the same renderHook shim `use-my-places-restore-sync.test.ts` uses).
//
// Proven on a real run (SYNC ON):
//   - the headline case: a row edited AFTER the backup was taken keeps its edit — the OLDER backup
//     row for that id does not revert it.
//   - the flip side: a backup row that is genuinely NEWER than the current live row for that id DOES
//     win — this is the "upsert", not a one-direction "restore always loses" no-op.
//   - the result is stable under a later echo of a stale peer copy (mergeItems is idempotent/commutative,
//     so the resolved winner cannot be un-resolved by re-merging an already-losing row).
// DORMANT: restoreDocsChecklist is a plain local overwrite (byte-identical, no sync fields stamped).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { DocsStore } from '@/hooks/use-docs';
import type { DocItem } from '@/core/docs/model';

const state = vi.hoisted(() => ({ remoteOn: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => state.remoteOn,
  isTripRemoteConfigured: () => state.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/docs-ports', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/docs-ports')>();
  return {
    ...orig,
    docsSyncPort: {
      push: async () => {},
      subscribe: () => () => {},
      isConfigured: () => state.remoteOn,
    },
  };
});
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => ({ name: 'Powan', token: 'Powan', accent: '#000' }) };
});

import { useDocs } from '@/hooks/use-docs';
import { mergeItems } from '@/core/sync/merge-items';
import { nextSyncStamp } from '@/core/sync/stamp';

const KEY = 'nepal_japan_docs_checklist';

interface HookHandle {
  current: DocsStore;
  run: (fn: (store: DocsStore) => void) => Promise<void>;
  unmount: () => void;
}

function renderDocs(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: DocsStore } = { current: null as unknown as DocsStore };
  function Probe() {
    ref.current = useDocs();
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    get current() {
      return ref.current;
    },
    async run(fn) {
      await act(async () => {
        fn(ref.current);
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function rawOnDisk(): DocItem[] {
  const blob = localStorage.getItem(KEY);
  if (!blob) return [];
  const parsed = JSON.parse(blob);
  return Array.isArray(parsed) ? parsed : [];
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('SYNC ON — restoreDocsChecklist is a same-id upsert by winning stamp (issue #295)', () => {
  beforeEach(() => {
    state.remoteOn = true;
  });

  it('a row edited AFTER the backup was taken keeps its edit — not reverted by the older backup row', async () => {
    const h = renderDocs();
    // Check it, then snapshot "as of backup time" — from the hook's own state, since nothing has
    // been written to disk yet (an untouched template never round-trips through storage.save()).
    await h.run((s) => s.toggleItem('passport-validity'));
    expect(h.current.items.find((i) => i.id === 'passport-validity')?.checked).toBe(true);
    const backup: DocItem[] = JSON.parse(JSON.stringify(h.current.items));

    // A LATER edit to the SAME item, made after the backup was taken.
    await h.run((s) => s.toggleItem('passport-validity'));
    const liveAfterSecondToggle = h.current.items.find((i) => i.id === 'passport-validity');
    expect(liveAfterSecondToggle?.checked).toBe(false);

    await h.run((s) => s.restoreDocsChecklist(backup));

    // The post-backup edit wins verbatim: still unchecked, at the SAME rev/hlc it had going in —
    // not reverted to the backup's checked:true, and not bumped again by the restore itself.
    const row = h.current.items.find((i) => i.id === 'passport-validity');
    expect(row?.checked).toBe(false);
    expect(row?.rev).toBe(liveAfterSecondToggle?.rev);
    expect(row?.hlc).toBe(liveAfterSecondToggle?.hlc);
    h.unmount();
  });

  it('a backup row genuinely NEWER than the current live row DOES win (this is an upsert, not a no-op)', async () => {
    const h = renderDocs();
    // 'nepal-visa' has never been touched on this device since sync came on — an unstamped
    // template row. The backup, though, carries a stamped edit from a device ahead of this one.
    const before: DocItem[] = JSON.parse(JSON.stringify(h.current.items));
    expect(before.find((i) => i.id === 'nepal-visa')?.rev).toBeUndefined();

    const FUTURE = Date.now() + 10_000;
    const backup: DocItem[] = before.map((i) =>
      i.id === 'nepal-visa'
        ? { ...i, checked: true, note: 'Visa on arrival, KTM', ...nextSyncStamp(i, FUTURE, 'OtherDevice') }
        : i,
    );

    await h.run((s) => s.restoreDocsChecklist(backup));

    const row = h.current.items.find((i) => i.id === 'nepal-visa');
    expect(row?.checked).toBe(true);
    expect(row?.note).toBe('Visa on arrival, KTM');

    // Idempotent/commutative: re-merging a peer's STALE (unstamped) copy of the same id cannot
    // un-resolve the winner just proven above.
    const staleEcho = before.find((i) => i.id === 'nepal-visa')!;
    const reMerged = mergeItems(rawOnDisk(), [staleEcho]);
    expect(reMerged.find((i) => i.id === 'nepal-visa')?.checked).toBe(true);
    h.unmount();
  });

  it('every one of the 18 fixed ids survives the restore — no add/remove, only upsert', async () => {
    const h = renderDocs();
    const backup: DocItem[] = JSON.parse(JSON.stringify(h.current.items));
    expect(backup).toHaveLength(18);
    await h.run((s) => s.restoreDocsChecklist(backup));
    expect(h.current.items).toHaveLength(18);
    h.unmount();
  });
});

describe('DORMANT — restoreDocsChecklist is a plain local overwrite (byte-identity)', () => {
  beforeEach(() => {
    state.remoteOn = false;
  });

  it('overwrites the store with the backup verbatim, with NO sync fields stamped', async () => {
    const h = renderDocs();
    await h.run((s) => s.toggleItem('passport-validity'));

    const backup: DocItem[] = rawOnDisk().map((i) =>
      i.id === 'passport-validity' ? { ...i, checked: false } : i,
    );
    await h.run((s) => s.restoreDocsChecklist(backup));

    expect(rawOnDisk()).toEqual(backup);
    for (const i of rawOnDisk()) {
      expect(i).not.toHaveProperty('rev');
      expect(i).not.toHaveProperty('hlc');
    }
    expect(h.current.items.find((i) => i.id === 'passport-validity')?.checked).toBe(false);
    h.unmount();
  });
});
