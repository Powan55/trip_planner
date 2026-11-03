// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import IceCard from '@/components/ice-card';
import { loadIce } from '@/core/ice/ice';
import { STORAGE_KEYS } from '@/core/storage/gateway';

let host: HTMLDivElement;
let root: Root;

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
const click = (el: Element | null) => act(async () => void (el as HTMLElement).click());
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  return act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(IceCard)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('IceCard', () => {
  it('shows the empty state, saves through the labelled form, then deletes after a second tap', async () => {
    expect(q('[data-testid="ice-empty"]')).not.toBeNull();

    await click(q('[data-testid="ice-edit"]'));
    const blood = q<HTMLInputElement>('input[name="bloodType"]')!;
    expect(document.querySelector(`label[for="${blood.id}"]`)?.textContent).toBe('Blood type');
    await type(blood, 'O neg');
    await type(q<HTMLTextAreaElement>('textarea[name="allergies"]')!, 'Penicillin');
    await type(q<HTMLInputElement>('input[name="contactPhone"]')!, '555-0199');
    await act(async () => {
      q<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(loadIce()).toEqual({ bloodType: 'O neg', allergies: 'Penicillin', contactPhone: '555-0199' });
    const view = q('[data-testid="ice-view"]')!;
    expect(view.textContent).toContain('Penicillin');
    expect(view.querySelector('a')?.getAttribute('href')).toBe('tel:5550199');

    await click(q('[data-testid="ice-edit"]'));
    await click(q('[data-testid="ice-clear"]'));
    expect(localStorage.getItem(STORAGE_KEYS.ice)).not.toBeNull();
    await click(q('[data-testid="ice-clear"]'));
    expect(localStorage.getItem(STORAGE_KEYS.ice)).toBeNull();
  });
});
