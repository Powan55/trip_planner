// @vitest-environment jsdom
//
// #227 — `PackingChecklist` mounted for real (createRoot + act, the
// `travel-expense-quickadd.test.tsx` harness) and driven through its own add-item form + remove
// buttons, asserted on the DOM AND on the REAL `usePacking` store underneath it (localStorage
// under the gateway's `packing` key — `nepal_japan_packing`).

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import PackingChecklist from '@/components/packing-checklist';
import type { PackingItem } from '@/core/packing/model';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'nepal_japan_packing';

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<PackingChecklist />);
  });
  return container;
}

const at = <T extends HTMLElement>(id: string): T | null => container.querySelector<T>(`[data-testid="${id}"]`);

function setValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function rawOnDisk(): PackingItem[] {
  const blob = window.localStorage.getItem(KEY);
  return blob ? (JSON.parse(blob) as PackingItem[]) : [];
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PackingChecklist (#227) — add a custom item', () => {
  it('typing a label and submitting renders the new item and persists it to disk', async () => {
    await mount();

    await act(async () => setValue(at<HTMLInputElement>('packing-add-input')!, 'Travel pillow'));
    await act(async () => {
      at<HTMLButtonElement>('packing-add-submit')!.click();
    });

    // Renders: a new checkbox row with that label appears in the DOM.
    const stored = rawOnDisk();
    const added = stored.find((i) => i.label === 'Travel pillow');
    expect(added).toBeDefined();
    expect(added).toMatchObject({ category: 'universal', checked: false });
    expect(at(`packing-item-${added!.id}`)).not.toBeNull();
    expect(container.textContent).toContain('Travel pillow');

    // The input clears, ready for the next entry.
    expect(at<HTMLInputElement>('packing-add-input')!.value).toBe('');
  });

  it('a blank/whitespace-only label is a no-op — nothing added, nothing persisted', async () => {
    await mount();
    const before = rawOnDisk().length;

    await act(async () => setValue(at<HTMLInputElement>('packing-add-input')!, '   '));
    await act(async () => {
      at<HTMLButtonElement>('packing-add-submit')!.click();
    });

    expect(rawOnDisk().length).toBe(before);
  });

  it('the added item SURVIVES a remount (the localStorage reload proof)', async () => {
    await mount();
    await act(async () => setValue(at<HTMLInputElement>('packing-add-input')!, 'Neck pillow'));
    await act(async () => {
      at<HTMLButtonElement>('packing-add-submit')!.click();
    });
    const addedId = rawOnDisk().find((i) => i.label === 'Neck pillow')!.id;

    act(() => root.unmount());
    container.remove();
    await mount();

    expect(at(`packing-item-${addedId}`)).not.toBeNull();
    expect(rawOnDisk().find((i) => i.id === addedId)).toBeDefined();
  });
});

describe('PackingChecklist (#227) — remove an item', () => {
  it('removes a FIXED-TEMPLATE item from the DOM and from disk', async () => {
    await mount();
    const fixedId = rawOnDisk()[0]?.id ?? 'universal-passport-copies';
    expect(at(`packing-item-${fixedId}`)).not.toBeNull();

    await act(async () => {
      at<HTMLButtonElement>(`packing-remove-${fixedId}`)!.click();
    });

    expect(at(`packing-item-${fixedId}`)).toBeNull();
    expect(rawOnDisk().find((i) => i.id === fixedId)).toBeUndefined();
  });

  it('removes a CUSTOM item from the DOM and from disk', async () => {
    await mount();
    await act(async () => setValue(at<HTMLInputElement>('packing-add-input')!, 'Ear plugs'));
    await act(async () => {
      at<HTMLButtonElement>('packing-add-submit')!.click();
    });
    const addedId = rawOnDisk().find((i) => i.label === 'Ear plugs')!.id;
    expect(at(`packing-item-${addedId}`)).not.toBeNull();

    await act(async () => {
      at<HTMLButtonElement>(`packing-remove-${addedId}`)!.click();
    });

    expect(at(`packing-item-${addedId}`)).toBeNull();
    expect(rawOnDisk().find((i) => i.id === addedId)).toBeUndefined();
  });
});
