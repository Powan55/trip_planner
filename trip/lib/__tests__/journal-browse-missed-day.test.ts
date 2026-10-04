// @vitest-environment jsdom
//
// #722 — /journal can open a past trip day that has no entry yet. The picker lists elapsed trip
// days without an entry (newest first), hides itself before the trip starts, and choosing a day
// mounts the one JournalCard for it.

import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const h = vi.hoisted(() => ({
  now: '2026-12-11',
  entries: [
    { date: '2026-12-10', text: 'Patan.', mood: null, highlight: '', updatedAt: '2026-12-10T18:00:00.000Z' },
  ] as { date: string; text: string; mood: null; highlight: string; updatedAt: string }[],
}));

vi.mock('@/lib/trip-now', () => ({ getTripDayDate: () => h.now }));

vi.mock('@/hooks/use-journal', () => ({
  useJournal: () => ({
    entries: h.entries,
    hydrated: true,
    getEntry: (date: string) => h.entries.find((e) => e.date === date) ?? null,
    saveEntry: () => {},
    removeEntry: () => {},
    clearAll: () => {},
  }),
}));

vi.mock('@/hooks/use-photos', () => ({
  usePhotos: () => ({ photos: [], hydrated: true, photosFor: () => [] }),
}));

vi.mock('@/components/photo-attach', () => ({ __esModule: true, default: () => null }));

import JournalBrowse from '@/components/journal-browse';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

const picker = (c: HTMLElement) => c.querySelector<HTMLSelectElement>('[data-testid="journal-browse-missed-day"]');

describe('JournalBrowse — write about a day with no entry (#722)', () => {
  it('lists only elapsed days without an entry, newest first, under a visible label', () => {
    h.now = '2026-12-11';
    const r = render(createElement(JournalBrowse));
    const select = picker(r.container)!;

    expect([...select.options].map((o) => o.value)).toEqual(['', '2026-12-11', '2026-12-09']);
    expect(r.container.querySelector(`label[for="${select.id}"]`)?.textContent).toContain('no entry');
    r.unmount();
  });

  it('choosing a day mounts one JournalCard for it and locks the picker meanwhile', () => {
    h.now = '2026-12-11';
    const r = render(createElement(JournalBrowse));
    const select = picker(r.container)!;

    act(() => {
      select.value = '2026-12-09';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(r.container.querySelectorAll('[data-testid="journal-card"]')).toHaveLength(1);
    expect(r.container.textContent).toContain('December 9');
    expect(picker(r.container)!.disabled).toBe(true);
    r.unmount();
  });

  it('picks up a new day on the shared tick without remounting (#791)', () => {
    h.now = '2026-12-10';
    const r = render(createElement(JournalBrowse));
    expect([...picker(r.container)!.options].map((o) => o.value)).toEqual(['', '2026-12-09']);

    h.now = '2026-12-11';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect([...picker(r.container)!.options].map((o) => o.value)).toEqual(['', '2026-12-11', '2026-12-09']);
    r.unmount();
  });

  it('is hidden before the trip starts, and the empty copy no longer points at a missing panel', () => {
    h.now = '2026-09-29';
    const saved = h.entries.splice(0);
    const r = render(createElement(JournalBrowse));

    expect(picker(r.container)).toBeNull();
    expect(r.container.querySelector('[data-testid="journal-browse-empty"]')?.textContent).toContain('Once the trip starts');
    r.unmount();
    h.entries.push(...saved);
  });
});
