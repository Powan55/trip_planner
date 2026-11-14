// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const imports = vi.hoisted(() => ({ n: 0 }));

vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
}));
// vitest rejects the import with its own error and keeps this one as `cause`.
vi.mock('@/lib/journal-remote', () => {
  imports.n += 1;
  throw Object.assign(new Error('Loading chunk 42 failed.'), { name: 'ChunkLoadError' });
});

import { useJournal } from '@/hooks/use-journal';

type Journal = ReturnType<typeof useJournal>;
let store: Journal;

function Probe({ onStore }: { onStore: (s: Journal) => void }) {
  const s = useJournal();
  useEffect(() => {
    onStore(s);
  });
  return null;
}

async function unhandledAfterMount(onLine: boolean, save = false): Promise<unknown[]> {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: onLine });
  const seen: unknown[] = [];
  const others = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason) => seen.push(reason));
  try {
    const before = imports.n;
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe, { onStore: (s) => (store = s) })));
    await vi.waitFor(() => expect(imports.n).toBe(before + 1));
    if (save) {
      await vi.waitFor(() => expect(store.hydrated).toBe(true));
      seen.length = 0;
      let saved = false;
      act(() => {
        saved = store.saveEntry('2026-12-09', { text: 'typed offline' });
      });
      expect(saved).toBe(true);
      await vi.waitFor(() => expect(imports.n).toBe(before + 2));
    }
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    act(() => root.unmount());
  } finally {
    process.removeAllListeners('unhandledRejection');
    for (const l of others) process.on('unhandledRejection', l);
  }
  return seen;
}

describe('useJournal: the journal-remote chunk fails to load', () => {
  it('offline, the failure is swallowed', async () => {
    expect(await unhandledAfterMount(false)).toEqual([]);
  });

  it('offline, saving an entry does not surface one either', async () => {
    expect(await unhandledAfterMount(false, true)).toEqual([]);
  });

  it('online, it still surfaces as an unhandled rejection', async () => {
    const seen = await unhandledAfterMount(true);
    expect(seen).toHaveLength(1);
    expect(((seen[0] as Error).cause as Error).name).toBe('ChunkLoadError');
  });
});
