// @vitest-environment jsdom
//
// #530 follow-up — `journal-card.tsx`'s rollover-close effect gained a `mountedRef` guard so an
// `initialDraft`-seeded open (the undo-reopen path) doesn't get closed the instant it mounts. That
// guard must not swallow the effect's actual job: when the trip day rolls over (midnight
// self-correct in the panel) while the editor is genuinely open, it still has to close and offer
// the stale draft back via undo.

import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const DATE_A = '2026-12-11';
const DATE_B = '2026-12-12';

const h = vi.hoisted(() => ({ entries: [] as { date: string; text: string; mood: null; highlight: string; updatedAt: string }[] }));

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

vi.mock('@/components/photo-attach', () => ({ __esModule: true, default: () => null }));

const undo = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/lib/undo-toast', () => ({
  showUndoToast: (message: string) => {
    undo.calls.push(message);
  },
}));

import JournalCard from '@/components/journal-card';
import { formatDateLong } from '@/lib/trip-data';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('JournalCard — midnight rollover still closes a genuinely open editor', () => {
  it('closes the editor and offers the stale draft via undo when `date` changes under it', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => root.render(createElement(JournalCard, { date: DATE_A, isToday: false })));

    // No entry yet for DATE_A → the empty-state prompt opens the editor.
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="journal-write-prompt"]')!.click());
    expect(container.querySelector('[data-testid="journal-editor"]')).not.toBeNull();

    const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="journal-text-input"]')!;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    act(() => {
      nativeSetter.call(textarea, 'Still awake past midnight.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // The trip day rolls over: the SAME instance re-renders with a new `date` prop.
    act(() => root.render(createElement(JournalCard, { date: DATE_B, isToday: false })));

    expect(container.querySelector('[data-testid="journal-editor"]')).toBeNull();
    expect(undo.calls).toEqual([`Draft closed — ${formatDateLong(DATE_A)} rolled over`]);

    act(() => root.unmount());
    container.remove();
  });
});
