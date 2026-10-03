// @vitest-environment jsdom
// #753: queued journal days and account prefs count as pending, an ack clears them at once, a
// refusal counts as blocked and is not retried, and the badge flushes them on tab return.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const gate = vi.hoisted(() => ({
  online: false,
  deny: false,
  calls: 0,
  traveler: { name: 'Powan' } as { name: string } | null,
}));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  return { m: { div: ({ initial, animate, transition, ...rest }: any) => React.createElement('div', rest) } };
});
vi.mock('@/hooks/use-presence', () => ({ usePresence: () => [] }));
vi.mock('@/lib/firebase-config', async (orig) => ({
  ...(await orig<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
}));
vi.mock('@/lib/token-auth', async (orig) => ({
  ...(await orig<typeof import('@/lib/token-auth')>()),
  getActiveTraveler: () => gate.traveler,
}));
const fs = {
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  runTransaction: async <T,>(_db: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> => {
    gate.calls += 1;
    if (gate.deny) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
    if (!gate.online) throw new Error('unavailable');
    return fn({ get: async () => ({ exists: () => false, data: () => undefined }), set: () => {}, update: () => {} });
  },
};
vi.mock('@/lib/firebase-remote', () => ({ getRemote: () => Promise.resolve({ db: {}, fs, uid: 'uid' }) }));

import { useSyncStatus, type SyncStatus } from '@/hooks/use-sync-status';
import SyncStatusBadge from '@/components/sync-status-badge';
import { flushPendingJournal, pushJournalEntry } from '@/lib/journal-remote';
import { flushPendingPrefs, setPref } from '@/lib/account-prefs-remote';
import { loadJournal, saveJournal } from '@/core/journal/storage';
import { upsertEntry } from '@/core/journal/model';
import { getActiveTripId, setSyncCode } from '@/core/storage/gateway';
import { journalDirty, personPrefsDirty } from '@/core/trips/registry';

function render(): { current: SyncStatus } {
  const ref = {} as { current: SyncStatus };
  function Probe() {
    ref.current = useSyncStatus();
    return null;
  }
  act(() => createRoot(document.createElement('div')).render(createElement(Probe)));
  return ref;
}

const DAY = '2026-12-11';
const writeDay = () => saveJournal(upsertEntry(loadJournal(), DAY, { text: 'Bhaktapur' }, new Date().toISOString()));

describe('sync badge counts journal and prefs queues (#753)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    Object.assign(gate, { online: false, deny: false, calls: 0, traveler: { name: 'Powan' } });
    setSyncCode('tok-1');
  });

  it('a journal day that failed to push is pending, and the ack clears it with no tick', async () => {
    const h = render();
    writeDay();
    await act(() => pushJournalEntry(DAY));
    expect(h.current.pending).toBe(1);
    expect(h.current.blocked).toBe(0);

    gate.online = true;
    await act(() => flushPendingJournal());
    expect(h.current.pending).toBe(0);
  });

  it('a pref that failed to push is pending until flushed', async () => {
    const h = render();
    await act(() => setPref('homeCurrency', 'NPR'));
    expect(h.current.pending).toBe(1);

    gate.online = true;
    await act(() => flushPendingPrefs());
    expect(h.current.pending).toBe(0);
  });

  it('a guest, or a traveller with no account code, never sees a count', async () => {
    writeDay();
    await pushJournalEntry(DAY);
    await setPref('homeCurrency', 'NPR');
    expect(journalDirty(getActiveTripId()) + personPrefsDirty()).toBe(2);
    gate.traveler = null;
    expect(render().current.pending).toBe(0);
    gate.traveler = { name: 'Powan' };
    setSyncCode('');
    expect(render().current.pending).toBe(0);
  });

  it('a refused day and pref count as blocked and are not retried this page load', async () => {
    setSyncCode('tok-denied');
    gate.deny = true;
    const h = render();
    writeDay();
    await act(() => pushJournalEntry(DAY));
    await act(() => setPref('homeCurrency', 'NPR'));
    expect(h.current.pending).toBe(2);
    expect(h.current.blocked).toBe(2);

    gate.calls = 0;
    await act(async () => {
      await flushPendingJournal();
      await flushPendingPrefs();
    });
    expect(gate.calls).toBe(0);
  });

  it('the badge flushes queued days when the tab comes back', async () => {
    writeDay();
    await pushJournalEntry(DAY);
    gate.online = true;
    gate.calls = 0;
    const vis = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const h = render();
    act(() => createRoot(document.createElement('div')).render(createElement(SyncStatusBadge)));
    await new Promise((r) => setTimeout(r, 20));
    expect(gate.calls).toBe(0);

    vis.mockReturnValue('visible');
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await vi.waitFor(() => expect(h.current.pending).toBe(0));
    expect(gate.calls).toBe(1);
  });
});
