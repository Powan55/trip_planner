// @vitest-environment jsdom
//
// #221 — `/journal` had 32 days of entries and no way to find one. Covers both halves of the
// filter: the pure `matchesJournalQuery` rules, and the wiring in `components/journal-browse.tsx`
// (input filters rows, live region reports the count, clear restores, the a11y contract holds).
//
// The hooks are stubbed the same way `journal-browse-is-today.test.ts` stubs them — this is a
// render/filter check, not a storage check, and a real `useJournal`/`usePhotos` would drag in
// hydration plumbing and (for photos) IndexedDB, which jsdom does not have.

import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { JournalEntry } from '@/core/journal/model';

const h = vi.hoisted(() => ({
  entries: [
    {
      date: '2026-12-10',
      text: 'Boudhanath at dawn, then momos in Thamel.',
      mood: 'good' as const,
      highlight: 'Prayer flags at first light',
      createdAt: '2026-12-10T09:00:00.000Z',
      updatedAt: '2026-12-10T09:00:00.000Z',
    },
    {
      date: '2026-12-14',
      text: 'Dinner at Yangling. Best momos of the whole trip.',
      mood: 'great' as const,
      highlight: 'Yangling Tibetan Restaurant',
      createdAt: '2026-12-14T20:00:00.000Z',
      updatedAt: '2026-12-14T20:00:00.000Z',
    },
    {
      date: '2026-12-21',
      text: 'Long train day. Read most of the afternoon.',
      createdAt: '2026-12-21T19:00:00.000Z',
      updatedAt: '2026-12-21T19:00:00.000Z',
    },
  ] as JournalEntry[],
}));

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

import JournalBrowse, { matchesJournalQuery } from '@/components/journal-browse';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    date: '2026-12-10',
    text: 'Boudhanath at dawn, then momos in Thamel.',
    highlight: 'Prayer flags at first light',
    createdAt: '2026-12-10T09:00:00.000Z',
    updatedAt: '2026-12-10T09:00:00.000Z',
    ...over,
  };
}

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    $<T extends Element>(sel: string): T | null {
      return container.querySelector<T>(sel);
    },
    rowDates(): string[] {
      return [...container.querySelectorAll('[data-testid^="journal-browse-row-"]')]
        .map((el) => el.getAttribute('data-testid')!.replace('journal-browse-row-', ''))
        // The per-row <h3> carries `journal-browse-row-<date>-heading`; keep only the articles.
        .filter((id) => !id.endsWith('-heading'));
    },
    type(value: string) {
      const input = container.querySelector<HTMLInputElement>('[data-testid="journal-browse-search"]')!;
      const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
      act(() => {
        desc.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('matchesJournalQuery — the substring rules (#221)', () => {
  it('an empty query matches every entry', () => {
    expect(matchesJournalQuery(entry(), '')).toBe(true);
    expect(matchesJournalQuery(entry({ text: '', highlight: 'x' }), '')).toBe(true);
  });

  it('matches the body', () => {
    expect(matchesJournalQuery(entry(), 'momos')).toBe(true);
    expect(matchesJournalQuery(entry(), 'thamel')).toBe(true);
  });

  it('matches the highlight', () => {
    expect(matchesJournalQuery(entry({ text: 'nothing here' }), 'prayer flags')).toBe(true);
  });

  it('matches the raw ISO date and the rendered long date', () => {
    expect(matchesJournalQuery(entry(), '2026-12-10')).toBe(true);
    // `formatDateLong('2026-12-10')` renders "Thursday, December 10, 2026".
    expect(matchesJournalQuery(entry(), 'december 10')).toBe(true);
    expect(matchesJournalQuery(entry(), 'thursday')).toBe(true);
  });

  it('is case-insensitive on the callers pre-lowercased query', () => {
    expect(matchesJournalQuery(entry({ text: 'Dinner at YANGLING' }), 'yangling')).toBe(true);
  });

  it('does not match an unrelated word', () => {
    expect(matchesJournalQuery(entry(), 'ramen')).toBe(false);
  });

  it('an entry with no highlight does not throw and still matches on body', () => {
    const e = entry({ highlight: undefined, text: 'Long train day.' });
    expect(matchesJournalQuery(e, 'train')).toBe(true);
    expect(matchesJournalQuery(e, 'prayer')).toBe(false);
  });

  it('does not search mood (a chip facet, not a substring)', () => {
    expect(matchesJournalQuery(entry({ mood: 'rough', text: 'x', highlight: undefined }), 'rough')).toBe(false);
  });
});

describe('JournalBrowse — the search input filters the browse list (#221)', () => {
  it('renders every entry with no query, and narrows to the matching day', () => {
    const r = render(createElement(JournalBrowse));
    expect(r.rowDates()).toEqual(['2026-12-21', '2026-12-14', '2026-12-10']);

    r.type('yangling');
    expect(r.rowDates()).toEqual(['2026-12-14']);

    r.unmount();
  });

  it('is case-insensitive and matches across days', () => {
    const r = render(createElement(JournalBrowse));
    r.type('MOMOS');
    expect(r.rowDates()).toEqual(['2026-12-14', '2026-12-10']);
    r.unmount();
  });

  it('finds a day by its rendered date', () => {
    const r = render(createElement(JournalBrowse));
    r.type('December 21');
    expect(r.rowDates()).toEqual(['2026-12-21']);
    r.unmount();
  });

  it('shows the no-match state (not the never-written-anything state) when nothing matches', () => {
    const r = render(createElement(JournalBrowse));
    r.type('helsinki');
    expect(r.rowDates()).toEqual([]);
    expect(r.$('[data-testid="journal-browse-no-match"]')).not.toBeNull();
    expect(r.$('[data-testid="journal-browse-empty"]')).toBeNull();
    expect(r.$('[data-testid="journal-browse-list"]')).toBeNull();
    r.unmount();
  });

  it('the clear button empties the query and restores every row', () => {
    const r = render(createElement(JournalBrowse));
    r.type('yangling');
    const clear = r.$<HTMLButtonElement>('[data-testid="journal-browse-search-clear"]');
    expect(clear).not.toBeNull();
    act(() => clear!.click());

    expect(r.$<HTMLInputElement>('[data-testid="journal-browse-search"]')!.value).toBe('');
    expect(r.rowDates()).toEqual(['2026-12-21', '2026-12-14', '2026-12-10']);
    // The clear control is only present while there is something to clear.
    expect(r.$('[data-testid="journal-browse-search-clear"]')).toBeNull();
    r.unmount();
  });
});

describe('JournalBrowse — search a11y contract (#221)', () => {
  it('the input has a real <label> pointing at it', () => {
    const r = render(createElement(JournalBrowse));
    const input = r.$<HTMLInputElement>('[data-testid="journal-browse-search"]')!;
    expect(input.id).toBe('journal-search-input');
    const label = r.$<HTMLLabelElement>(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('Search journal entries');
    r.unmount();
  });

  it('the result count sits in a live region that is mounted BEFORE the first query', () => {
    const r = render(createElement(JournalBrowse));
    const status = r.$('[data-testid="journal-browse-search-status"]')!;
    // Mounted-but-empty up front: a live region that appears with its first text is not announced.
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');

    r.type('momos');
    expect(r.$('[data-testid="journal-browse-search-status"]')!.textContent).toBe('2 of 3 entries match');

    r.type('helsinki');
    expect(r.$('[data-testid="journal-browse-search-status"]')!.textContent).toBe('0 of 3 entries match');

    r.unmount();
  });

  it('an open editor survives a filter its own day does not match', () => {
    const r = render(createElement(JournalBrowse));
    const edit = r.$<HTMLButtonElement>('[data-testid="journal-browse-edit-2026-12-14"]')!;
    act(() => edit.click());
    expect(r.$('[data-testid="journal-card"]')).not.toBeNull();

    r.type('helsinki');
    expect(r.$('[data-testid="journal-card"]')).not.toBeNull();
    r.unmount();
  });
});

describe('JournalBrowse — no entries at all (#221)', () => {
  it('renders no search input and keeps the original empty state', () => {
    const saved = h.entries;
    h.entries = [];
    const r = render(createElement(JournalBrowse));
    expect(r.$('[data-testid="journal-browse-search"]')).toBeNull();
    expect(r.$('[data-testid="journal-browse-empty"]')).not.toBeNull();
    expect(r.$('[data-testid="journal-browse-no-match"]')).toBeNull();
    r.unmount();
    h.entries = saved;
  });
});
