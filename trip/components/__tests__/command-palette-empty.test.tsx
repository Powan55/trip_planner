// @vitest-environment jsdom
//
// #663: the palette's "no results" state was silent to screen readers — the empty-state
// copy sits inside the listbox and only a sighted user watching the row count could tell
// a query had zero hits. Asserted on the REAL rendered palette (⌘K, type, read the DOM),
// not on the component's internal state.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/',
}));

vi.mock('@/lib/itinerary-storage', () => ({
  loadPlans: () => [],
}));

// jsdom has no ResizeObserver or scrollIntoView; cmdk's CommandList/Command use both
// to size the list and to keep the selected row in view.
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.HTMLElement.prototype.scrollIntoView = vi.fn();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import CommandPalette from '@/components/command-palette';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function openPalette(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(CommandPalette)));
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
  });
}

function type(text: string): void {
  const input = document.querySelector<HTMLInputElement>('input[cmdk-input]');
  if (!input) throw new Error('missing cmdk input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function status(): string {
  const el = document.querySelector('[role="status"]');
  if (!el) throw new Error('missing status region');
  return el.textContent ?? '';
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('command palette result count is announced', () => {
  it('announces nothing on open, before any query', () => {
    openPalette();
    expect(status()).toBe('');
  });

  it('announces the no-results copy and hides (not unmounts) the listbox', () => {
    openPalette();
    type('zzzzqqq');

    expect(status()).toBe('Nothing here matches what you typed.');
    expect(document.querySelectorAll('[cmdk-item]').length).toBe(0);

    const list = document.querySelector('[cmdk-list]');
    expect(list).not.toBeNull();
    expect((list as HTMLElement).hidden).toBe(true);
  });

  it('announces a result count for a matching query', () => {
    openPalette();
    type('settings');

    const count = document.querySelectorAll('[cmdk-item]').length;
    expect(count).toBeGreaterThan(0);
    expect(status()).toBe(`${count} result${count === 1 ? '' : 's'}`);

    const list = document.querySelector('[cmdk-list]');
    expect((list as HTMLElement).hidden).toBe(false);
  });
});
