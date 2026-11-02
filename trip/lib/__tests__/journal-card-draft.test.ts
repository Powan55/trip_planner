// @vitest-environment jsdom
//
// #948 — an open journal editor survives unmount (tab switch / evicted page): the draft is written
// to the trip-scoped draft slot, restored on the next mount, and dropped on Save or Cancel.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const DATE = '2026-12-11';
const KEY = 'nepal_japan_journal_draft';

const h = vi.hoisted(() => ({ entry: null as null | { text: string; mood: null; highlight: string } }));

vi.mock('@/hooks/use-journal', () => ({
  useJournal: () => ({
    entries: [],
    hydrated: true,
    getEntry: () => h.entry,
    saveEntry: () => true,
    removeEntry: () => {},
    clearAll: () => {},
  }),
}));
vi.mock('@/components/photo-attach', () => ({ __esModule: true, default: () => null }));
vi.mock('@/lib/undo-toast', () => ({ showUndoToast: () => {} }));

import JournalCard from '@/components/journal-card';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const mount = (props: { onDone?: () => void } = {}) => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(JournalCard, { date: DATE, isToday: false, ...props })));
};
const unmount = () => {
  act(() => root.unmount());
  container.remove();
};
const q = <T extends Element>(id: string) => container.querySelector<T>(`[data-testid="${id}"]`);
const type = (text: string) => {
  const ta = q<HTMLTextAreaElement>('journal-text-input')!;
  const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    set.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('JournalCard draft persistence (#948)', () => {
  beforeEach(() => {
    localStorage.clear();
    h.entry = null;
    vi.useFakeTimers();
  });

  it('restores typed text after unmount + remount', () => {
    mount();
    act(() => q<HTMLButtonElement>('journal-write-prompt')!.click());
    type('Long day at Pashupatinath.');
    unmount(); // unmount flushes without waiting for the debounce

    expect(JSON.parse(localStorage.getItem(KEY)!)[DATE].text).toBe('Long day at Pashupatinath.');

    mount();
    expect(q('journal-editor')).not.toBeNull();
    expect(q<HTMLTextAreaElement>('journal-text-input')!.value).toBe('Long day at Pashupatinath.');
    unmount();
  });

  it('writes after the debounce while still mounted', () => {
    mount();
    act(() => q<HTMLButtonElement>('journal-write-prompt')!.click());
    type('x');
    expect(localStorage.getItem(KEY)).toBeNull();
    act(() => void vi.advanceTimersByTime(500));
    expect(JSON.parse(localStorage.getItem(KEY)!)[DATE].text).toBe('x');
    unmount();
  });

  it('Save clears the draft and does not rewrite it on unmount', () => {
    mount();
    act(() => q<HTMLButtonElement>('journal-write-prompt')!.click());
    type('keep me');
    act(() => void vi.advanceTimersByTime(500));
    act(() => q<HTMLButtonElement>('journal-save')!.click());
    unmount();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('Cancel clears the draft', () => {
    mount();
    act(() => q<HTMLButtonElement>('journal-write-prompt')!.click());
    type('discard me');
    act(() => void vi.advanceTimersByTime(500));
    act(() => q<HTMLButtonElement>('journal-cancel')!.click());
    unmount();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('Save that unmounts the card in the same act does not resurrect the draft', () => {
    mount({ onDone: () => root.unmount() });
    act(() => q<HTMLButtonElement>('journal-write-prompt')!.click());
    type('keep me');
    act(() => void vi.advanceTimersByTime(500));
    expect(localStorage.getItem(KEY)).not.toBeNull();
    act(() => q<HTMLButtonElement>('journal-save')!.click());
    expect(localStorage.getItem(KEY)).toBeNull();
    container.remove();
  });

  it('a restored draft does not take focus; a manual open does', () => {
    localStorage.setItem(KEY, JSON.stringify({ [DATE]: { text: 'back again', mood: null, highlight: '' } }));
    mount();
    expect(q('journal-editor')).not.toBeNull();
    expect(document.activeElement).not.toBe(q('journal-highlight-input'));
    act(() => q<HTMLButtonElement>('journal-cancel')!.click());
    act(() => q<HTMLButtonElement>('journal-write-prompt')!.click());
    expect(document.activeElement).toBe(q('journal-highlight-input'));
    unmount();
  });

  it('drops a saved draft identical to the stored entry instead of reopening it', () => {
    h.entry = { text: 'same', mood: null, highlight: '' };
    localStorage.setItem(KEY, JSON.stringify({ [DATE]: { text: 'same', mood: null, highlight: '' } }));
    mount();
    expect(q('journal-editor')).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
    unmount();
  });

  it('works when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    act(() => q<HTMLButtonElement>('journal-write-prompt')!.click());
    type('still typing');
    expect(q<HTMLTextAreaElement>('journal-text-input')!.value).toBe('still typing');
    unmount();
    vi.restoreAllMocks();
  });
});
