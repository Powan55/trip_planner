// @vitest-environment jsdom
//
// #530 — journal-browse.tsx set `editingDate` on Edit but never reset it, so the row stayed
// rendered as a full JournalCard after Save/Cancel instead of returning to the read-only
// JournalRow summary. Fixed by passing JournalCard an `onDone` callback it fires after a
// user-initiated close, which the browse view uses to clear `editingDate` and return focus to
// the row's own Edit button.

import { describe, it, expect, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const DATE = '2026-12-11';

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
    saveEntry: (date: string, patch: { text: string; mood: string | null; highlight: string }) => {
      const i = h.entries.findIndex((e) => e.date === date);
      if (i >= 0) h.entries[i] = { ...h.entries[i], ...patch, mood: patch.mood as never };
    },
    removeEntry: () => {},
    clearAll: () => {},
  }),
}));

vi.mock('@/hooks/use-photos', () => ({
  usePhotos: () => ({ photos: [], hydrated: true, photosFor: () => [] }),
}));

vi.mock('@/components/photo-attach', () => ({ __esModule: true, default: () => null }));

// Captures the undo action rather than rendering a real sonner toast — the test drives it
// directly, the same way clicking the toast's "Undo" button would.
const undo = vi.hoisted(() => ({ onUndo: null as (() => void) | null }));
vi.mock('@/lib/undo-toast', () => ({
  showUndoToast: (_message: string, onUndo: () => void) => {
    undo.onUndo = onUndo;
  },
}));

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

function editButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>(`[data-testid="journal-browse-edit-${DATE}"]`);
}

describe('JournalBrowse — Save/Cancel return the row to its summary (#530)', () => {
  it('Cancel closes the editor, restores the row, and returns focus to Edit', () => {
    const r = render(createElement(JournalBrowse));

    act(() => editButton(r.container)!.click());
    act(() => r.container.querySelector<HTMLButtonElement>('[data-testid="journal-edit"]')!.click());
    expect(r.container.querySelector('[data-testid="journal-editor"]')).not.toBeNull();

    const cancel = r.container.querySelector<HTMLButtonElement>('[data-testid="journal-cancel"]');
    act(() => cancel!.click());

    expect(r.container.querySelector('[data-testid="journal-card"]')).toBeNull();
    expect(r.container.querySelector(`[data-testid="journal-browse-row-${DATE}"]`)).not.toBeNull();
    expect(document.activeElement).toBe(editButton(r.container));

    r.unmount();
  });

  it('Save closes the editor and restores the row', () => {
    const r = render(createElement(JournalBrowse));

    act(() => editButton(r.container)!.click());
    act(() => r.container.querySelector<HTMLButtonElement>('[data-testid="journal-edit"]')!.click());
    expect(r.container.querySelector('[data-testid="journal-editor"]')).not.toBeNull();

    const save = r.container.querySelector<HTMLButtonElement>('[data-testid="journal-save"]');
    act(() => save!.click());

    expect(r.container.querySelector('[data-testid="journal-card"]')).toBeNull();
    expect(r.container.querySelector(`[data-testid="journal-browse-row-${DATE}"]`)).not.toBeNull();
    expect(document.activeElement).toBe(editButton(r.container));

    r.unmount();
  });

  it('undoing a Cancel reopens the editor with the discarded draft text', () => {
    const r = render(createElement(JournalBrowse));

    act(() => editButton(r.container)!.click());
    act(() => r.container.querySelector<HTMLButtonElement>('[data-testid="journal-edit"]')!.click());

    const textarea = r.container.querySelector<HTMLTextAreaElement>('[data-testid="journal-text-input"]')!;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      nativeSetter.call(textarea, 'A late addition, typed then cancelled.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const cancel = r.container.querySelector<HTMLButtonElement>('[data-testid="journal-cancel"]');
    act(() => cancel!.click());

    // The card unmounted (row back to summary) and the discarded-draft undo was captured.
    expect(r.container.querySelector('[data-testid="journal-card"]')).toBeNull();
    expect(undo.onUndo).not.toBeNull();

    act(() => undo.onUndo!());

    const reopened = r.container.querySelector<HTMLTextAreaElement>('[data-testid="journal-text-input"]');
    expect(reopened).not.toBeNull();
    expect(reopened!.value).toBe('A late addition, typed then cancelled.');

    r.unmount();
  });
});
