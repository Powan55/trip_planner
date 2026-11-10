// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ConflictNotice } from '@/components/conflict-notice';
import { serialize } from '@/core/sync/hlc';
import { recordConflicts, dismissConflict, listConflicts } from '@/core/sync/conflict-store';

const stamp = (actor: string) => serialize({ pt: 1000, ct: 0, actor });
const plan = (title: string, actor: string) => [
  { date: '2026-12-01', items: [{ id: 'a', title, hlc: stamp(actor), fieldHlc: { title: stamp(actor) } }] },
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(onRestore = vi.fn(), onDismiss = dismissConflict) {
  act(() => root.render(createElement(ConflictNotice, { itemId: 'a', title: 'Dinner', onRestore, onDismiss })));
  return onRestore;
}
const buttons = () => Array.from(host.querySelectorAll('button'));

describe('ConflictNotice', () => {
  it('renders nothing without an entry', () => {
    mount();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it('shows on record, Dismiss removes it, Restore calls through', () => {
    const onRestore = mount();
    act(() => recordConflicts(plan('Mine', 'me'), plan('Theirs', 'zed'), 'me'));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Changed by');
    expect(host.textContent).toContain('title: Mine');
    expect(buttons().map((b) => b.getAttribute('aria-label'))).toEqual([
      'Put mine back: Dinner',
      'Dismiss change notice: Dinner',
    ]);

    act(() => buttons()[0].click());
    expect(onRestore).toHaveBeenCalledWith('a');

    // the real restore dismisses the entry; the notice follows
    act(() => dismissConflict('a'));
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(listConflicts()).toEqual([]);

    act(() => recordConflicts(plan('Mine', 'me'), plan('Theirs', 'zed'), 'me'));
    act(() => buttons()[1].click());
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
