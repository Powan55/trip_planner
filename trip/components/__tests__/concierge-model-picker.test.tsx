// @vitest-environment jsdom
//
// D-535/D-536 in the real panel: the labelled model picker, its in-flight lock and Kimi wait copy,
// and a restored thread that shows no proposal chips and goes away on Clear chat.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { STORAGE_KEYS } from '@/core/storage/gateway';

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));
vi.mock('@/lib/concierge-config', () => ({
  CONCIERGE_URL: 'https://mock.example.workers.dev',
  isConciergeConfigured: () => true,
}));

import { ConciergeChat } from '@/components/concierge-chat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const q = <T extends Element>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);

async function openPanel() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(createElement(ConciergeChat)));
  await act(async () => q<HTMLButtonElement>('concierge-trigger')!.click());
}

async function type(text: string) {
  const el = q<HTMLInputElement>('concierge-input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    el.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('concierge model picker', () => {
  it('is a labelled select that persists the pick, locks while a turn is in flight, and warns about Kimi waits', async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (release = r))));
    await openPanel();

    const select = q<HTMLSelectElement>('concierge-model')!;
    expect(document.querySelector(`label[for="${select.id}"]`)!.textContent).toBe('Model');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Groq (fast)',
      'Kimi K3 (slow, up to 3 min)',
    ]);
    expect(select.value).toBe('groq');

    await act(async () => {
      select.value = 'kimi';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(localStorage.getItem(STORAGE_KEYS.conciergeProvider)).toBe('kimi');

    await type('slow question');
    expect(select.disabled).toBe(true);
    expect(q<HTMLButtonElement>('concierge-clear')!.disabled).toBe(true);
    expect(q('concierge-thinking')!.textContent).toContain('2–3 minutes');

    await act(async () => {
      release(new Response(JSON.stringify({ reply: 'done', ops: [] }), { status: 200 }));
    });
    expect(select.disabled).toBe(false);
  });

  it('a restored thread shows no proposal chips, and Clear chat removes it from the panel and the device', async () => {
    localStorage.setItem(
      STORAGE_KEYS.conciergeChat,
      JSON.stringify([
        { role: 'user', content: 'add ramen' },
        {
          role: 'assistant',
          content: 'Here you go.',
          model: 'openai/gpt-oss-120b',
          ops: [{ type: 'addItem', date: '2026-12-20', title: 'Ramen', category: 'food' }],
        },
      ]),
    );
    await openPanel();

    expect(q('concierge-turn-assistant')!.textContent).toBe('Here you go.');
    expect(q('concierge-turn-model')!.textContent).toBe('openai/gpt-oss-120b');
    expect(q('concierge-op-chip')).toBeNull();

    await act(async () => q<HTMLButtonElement>('concierge-clear')!.click());
    expect(q('concierge-turn-assistant')).toBeNull();
    expect(q('concierge-empty')).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.conciergeChat)).toBeNull();
    expect(q<HTMLButtonElement>('concierge-clear')!.disabled).toBe(true);
    expect(document.activeElement).toBe(q('concierge-input'));
  });
});
