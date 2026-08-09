// @vitest-environment jsdom
//
// S282 — coverage for hooks/use-journal.ts (S104), exercised by RENDERING the real hook (the
// same renderHook shim over react-dom/client + act lib/__tests__/use-docs.test.ts uses — no new
// dependency). use-journal is the SIMPLEST `createReactiveStore` consumer (D-148): NO sync port
// (the journal is local-only, D-002/D-152), so this suite proves the hydrate/local-read/CRUD-write/
// reload/cross-instance-sync/corrupt-slot skeleton without any sync/dormant-gate dimension. Proves:
// starts empty + hydrated, saveEntry upserts (create + patch-merge, `null` clears a field), getEntry
// reads the freshest persisted source (not a stale render closure), emptying all content REMOVES the
// entry (D-018 clean empty state), removeEntry deletes outright, RELOAD (unmount+remount) survives
// (the hard guarantee), two instances stay in sync via the same-tab CustomEvent, clearAll wipes
// everything, and a corrupt persisted slot degrades to [] on hydrate (never throws).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { useJournal } from '@/hooks/use-journal';
import type { JournalStore } from '@/hooks/use-journal';

const KEY = 'nepal_japan_journal';

interface HookHandle {
  current: JournalStore;
  run: (fn: (store: JournalStore) => void) => Promise<void>;
  rerenderFresh: () => Promise<void>;
  unmount: () => void;
}

function renderJournal(): HookHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root = createRoot(container);
  const ref: { current: JournalStore } = { current: null as unknown as JournalStore };

  function Probe() {
    ref.current = useJournal();
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

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
    async rerenderFresh() {
      act(() => root.unmount());
      root = createRoot(container);
      act(() => {
        root.render(createElement(Probe));
      });
      await act(async () => {
        await Promise.resolve();
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useJournal (S104)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts empty + hydrated after mount (no journal persisted)', async () => {
    const h = renderJournal();
    await h.run(() => {});
    expect(h.current.hydrated).toBe(true);
    expect(h.current.entries).toEqual([]);
    expect(h.current.getEntry('2026-12-09')).toBeNull();
    h.unmount();
  });

  it('saveEntry creates an entry, persists it, and getEntry reflects it', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-09', { text: 'Arrived in Kathmandu', mood: 'great' }));
    const entry = h.current.getEntry('2026-12-09');
    expect(entry?.text).toBe('Arrived in Kathmandu');
    expect(entry?.mood).toBe('great');
    expect(entry?.createdAt).toBeTruthy();
    expect(entry?.updatedAt).toBe(entry?.createdAt); // set once on create

    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored).toHaveLength(1);
    expect(stored[0].date).toBe('2026-12-09');
    expect(stored[0].text).toBe('Arrived in Kathmandu');
    h.unmount();
  });

  it('saveEntry merges a patch onto the existing entry (undefined fields keep their value)', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-09', { text: 'Day one', mood: 'good', highlight: 'Boudhanath' }));
    const created = h.current.getEntry('2026-12-09');
    await h.run((s) => s.saveEntry('2026-12-09', { text: 'Day one, edited' })); // mood/highlight omitted
    const edited = h.current.getEntry('2026-12-09');
    expect(edited?.text).toBe('Day one, edited');
    expect(edited?.mood).toBe('good'); // preserved
    expect(edited?.highlight).toBe('Boudhanath'); // preserved
    expect(edited?.createdAt).toBe(created?.createdAt); // createdAt never re-timed on edit
    h.unmount();
  });

  it('a patch field set to null EXPLICITLY clears it (distinct from undefined = unchanged)', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-10', { text: 'Everest flight', mood: 'great', highlight: 'sunrise' }));
    await h.run((s) => s.saveEntry('2026-12-10', { mood: null, highlight: null }));
    const entry = h.current.getEntry('2026-12-10');
    expect(entry?.text).toBe('Everest flight'); // untouched
    expect(entry?.mood).toBeUndefined();
    expect(entry?.highlight).toBeUndefined();
    h.unmount();
  });

  it('emptying all content (blank text + no mood + no highlight) REMOVES the entry (D-018)', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-11', { text: 'temporary note' }));
    expect(h.current.getEntry('2026-12-11')).not.toBeNull();
    await h.run((s) => s.saveEntry('2026-12-11', { text: '   ' })); // blanks it out
    expect(h.current.getEntry('2026-12-11')).toBeNull();
    expect(h.current.entries).toEqual([]);
    h.unmount();
  });

  it('removeEntry deletes the entry for a date outright', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-12', { text: 'to be removed' }));
    expect(h.current.entries).toHaveLength(1);
    await h.run((s) => s.removeEntry('2026-12-12'));
    expect(h.current.entries).toEqual([]);
    expect(h.current.getEntry('2026-12-12')).toBeNull();
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored).toEqual([]);
    h.unmount();
  });

  it('getEntry reads the freshest persisted source, not a stale render closure', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-13', { text: 'first' }));
    await h.run((s) => s.saveEntry('2026-12-14', { text: 'second' }));
    expect(h.current.getEntry('2026-12-13')?.text).toBe('first');
    expect(h.current.getEntry('2026-12-14')?.text).toBe('second');
    h.unmount();
  });

  it('RELOAD (unmount + remount) — entries survive (the hard guarantee)', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-15', { text: 'Pokhara lakeside', mood: 'okay', highlight: 'boat ride' }));
    await h.rerenderFresh();
    const entry = h.current.getEntry('2026-12-15');
    expect(entry?.text).toBe('Pokhara lakeside');
    expect(entry?.mood).toBe('okay');
    expect(entry?.highlight).toBe('boat ride');
    expect(h.current.entries).toHaveLength(1);
    h.unmount();
  });

  it('two instances stay in sync via the same-tab CustomEvent', async () => {
    const a = renderJournal();
    const b = renderJournal();
    await a.run(() => {});
    await b.run(() => {});
    await a.run((s) => s.saveEntry('2026-12-16', { text: 'shared note' }));
    expect(b.current.getEntry('2026-12-16')?.text).toBe('shared note');
    a.unmount();
    b.unmount();
  });

  it('clearAll wipes every entry (local-only, D-152)', async () => {
    const h = renderJournal();
    await h.run((s) => s.saveEntry('2026-12-17', { text: 'one' }));
    await h.run((s) => s.saveEntry('2026-12-18', { text: 'two' }));
    expect(h.current.entries).toHaveLength(2);
    await h.run((s) => s.clearAll());
    expect(h.current.entries).toEqual([]);
    const stored = JSON.parse(window.localStorage.getItem(KEY) as string);
    expect(stored).toEqual([]);
    h.unmount();
  });

  it('a corrupt (non-array) persisted slot degrades to [] on hydrate, never throws', async () => {
    window.localStorage.setItem(KEY, '{not json');
    const h = renderJournal();
    await h.run(() => {});
    expect(h.current.entries).toEqual([]);
    expect(h.current.hydrated).toBe(true);
    h.unmount();
  });

  it('a persisted slot with an invalid entry (bad date) is dropped, valid entries survive', async () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify([
        { date: 'not-a-date', text: 'bad' },
        { date: '2026-12-19', text: 'good entry' },
      ]),
    );
    const h = renderJournal();
    await h.run(() => {});
    expect(h.current.entries).toHaveLength(1);
    expect(h.current.getEntry('2026-12-19')?.text).toBe('good entry');
    h.unmount();
  });
});
