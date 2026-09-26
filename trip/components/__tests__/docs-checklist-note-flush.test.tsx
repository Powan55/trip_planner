// @vitest-environment jsdom
//
// #548: a note typed into a checklist row was lost if the tab was closed/backgrounded, or the row
// unmounted, before the field blurred (nothing calls onBlur on either exit). Mounts one real
// `DocRow` and drives visibilitychange / pagehide / unmount, faking only `onNote`.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import DocsChecklist from '@/components/docs-checklist';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { onNote, retiring } = vi.hoisted(() => ({ onNote: vi.fn(), retiring: { value: false } }));

vi.mock('@/hooks/use-cross-tab-reload', () => ({ isTabRetiring: () => retiring.value }));

vi.mock('@/hooks/use-docs', () => ({
  useDocs: () => ({
    items: [
      { id: 'passport', section: 'critical', label: 'Passport', checked: false, note: '' },
    ],
    hydrated: true,
    completion: { total: 1, done: 0, perSection: { critical: { total: 1, done: 0 }, dayzero: { total: 0, done: 0 } } },
    toggleItem: vi.fn(),
    setNote: onNote,
  }),
}));

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<DocsChecklist />);
  });
}

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('[data-testid="docs-note-passport"]')!;
}

function type(value: string) {
  const el = input();
  el.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(() => {
  onNote.mockClear();
  retiring.value = false;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('docs checklist note — flush on hide/unmount, not just blur', () => {
  it('commits the pending draft when the tab is hidden without blurring', async () => {
    await mount();
    type('AB123456');

    await act(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(onNote).toHaveBeenCalledTimes(1);
    expect(onNote).toHaveBeenCalledWith('passport', 'AB123456');
  });

  it('commits the pending draft on pagehide', async () => {
    await mount();
    type('exp 2030');

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(onNote).toHaveBeenCalledTimes(1);
    expect(onNote).toHaveBeenCalledWith('passport', 'exp 2030');
  });

  it('commits the pending draft on unmount', async () => {
    await mount();
    type('visa ref 42');

    await act(async () => root.unmount());
    container.remove();

    expect(onNote).toHaveBeenCalledTimes(1);
    expect(onNote).toHaveBeenCalledWith('passport', 'visa ref 42');
  });

  it('a retiring tab skips the pagehide and unmount flush (#581)', async () => {
    await mount();
    type('old trip note');
    retiring.value = true;

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await act(async () => root.unmount());

    expect(onNote).not.toHaveBeenCalled();
  });

  it('does not commit when the draft is unchanged', async () => {
    await mount();
    // Focus without changing anything, then hide the tab.
    input().focus();

    await act(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(onNote).not.toHaveBeenCalled();
  });
});
