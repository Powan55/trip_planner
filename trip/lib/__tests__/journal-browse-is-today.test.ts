// @vitest-environment jsdom
//
// REACT-4 — `/journal`'s browse view mounts the REAL `JournalCard` to edit an arbitrary past day,
// but mounted it as `<JournalCard date={date} />`. `isToday` defaults to `true`, which selects the
// heading "Today's journal" and the aria-label "Edit today's journal entry" — so editing a past
// day claimed to be today's, and since that heading is the section's accessible name
// (`aria-labelledby="journal-heading"`) it reached the accessibility tree, not just the pixels.
// That is the exact defect `isToday` was added for; the prop was documented in journal-browse's
// own docblock and never wired into its JSX.
//
// The hooks are stubbed rather than driven through storage: this is a prop-wiring check, and a
// real `useJournal`/`usePhotos` would mean hydration plumbing for a heading string. `PhotoAttach`
// is stubbed for the same reason JournalPhotoStrip's suite mocks the blob store — jsdom has no
// IndexedDB.

import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const PAST_DAY = '2026-12-11';

const h = vi.hoisted(() => ({
  entries: [
    {
      date: '2026-12-11',
      text: 'Boudhanath at dusk.',
      mood: 'great' as const,
      highlight: 'Prayer flags',
      updatedAt: '2026-12-11T18:00:00.000Z',
    },
  ],
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

import JournalBrowse from '@/components/journal-browse';
import { formatDateLong } from '@/lib/trip-data';

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

describe('JournalBrowse — editing a past day is not labelled "Today\'s journal" (REACT-4)', () => {
  it('names the day being edited in the heading, which is the section accessible name', () => {
    const r = render(createElement(JournalBrowse));

    const edit = r.container.querySelector<HTMLButtonElement>(
      `[data-testid="journal-browse-edit-${PAST_DAY}"]`,
    );
    expect(edit).not.toBeNull();
    act(() => edit!.click());

    const card = r.container.querySelector('[data-testid="journal-card"]');
    expect(card).not.toBeNull();
    // `aria-labelledby` points at this heading, so its text IS the accessible name.
    expect(card!.getAttribute('aria-labelledby')).toBe('journal-heading');
    const heading = r.container.querySelector('#journal-heading');
    expect(heading!.textContent).toContain(formatDateLong(PAST_DAY));
    expect(heading!.textContent).not.toContain("Today's journal");

    r.unmount();
  });
});
