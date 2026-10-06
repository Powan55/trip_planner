import { afterEach, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ChatTurn } from '@/hooks/use-concierge-chat';

const chat = vi.hoisted(() => ({ messages: [] as ChatTurn[], status: 'idle' }));
vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'token', accent: '#f0c760' } }),
}));
vi.mock('@/lib/concierge-config', () => ({ isConciergeConfigured: () => true }));
vi.mock('@/hooks/use-concierge-chat', () => ({
  useConciergeChat: () => ({ ...chat, provider: 'groq', send: vi.fn(), retry: vi.fn(), reset: vi.fn(), setProvider: vi.fn() }),
}));
import { ConciergeChat } from '@/components/concierge-chat';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  localStorage.clear();
});

it('follows streamed text and proposal controls, preserves scroll-up, and resumes near bottom', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(ConciergeChat)));
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="concierge-trigger"]')!.click());
  const log = document.querySelector<HTMLDivElement>('[data-testid="concierge-messages"]')!;
  let height = 1000;
  Object.defineProperties(log, {
    scrollHeight: { get: () => height },
    clientHeight: { value: 300 },
  });
  const update = async () => { await act(async () => root.render(createElement(ConciergeChat))); };
  const scroll = async (top: number) => {
    await act(async () => {
      log.scrollTop = top;
      log.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
  };
  chat.messages = [{ role: 'assistant', content: 'First chunk' }];
  chat.status = 'streaming';
  await update();
  expect(log.scrollTop).toBe(1000);
  height = 1200;
  chat.messages = [{ role: 'assistant', content: 'First chunk and more text' }];
  await update();
  expect(log.scrollTop).toBe(1200);
  await scroll(200);
  height = 1400;
  chat.messages = [{ role: 'assistant', content: 'Completed reply', ops: [
    { type: 'addItem', date: '2026-12-20', title: 'Ramen', category: 'food' },
  ] }];
  chat.status = 'idle';
  await update();
  expect(log.scrollTop).toBe(200);
  expect(log.querySelector('[data-testid="concierge-op-confirm"]')).not.toBeNull();
  await scroll(1050);
  height = 1600;
  await update();
  expect(log.scrollTop).toBe(1600);
  height = 1800;
  chat.messages = [...chat.messages, { role: 'user', content: 'Next question' }];
  await update();
  expect(log.scrollTop).toBe(1800);
});
