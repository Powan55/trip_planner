// @vitest-environment jsdom
//
// #567 — the panel's intro copy and starter prompts hardcoded the Nepal/Japan itinerary even
// though the concierge also runs on custom trips (lib/concierge-config.ts). Proves both branches
// of the `isDefaultTrip()` split: the default pack keeps its old copy, a custom trip gets generic
// copy naming its own label instead of somebody else's.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const state = vi.hoisted(() => ({ isDefault: true, label: 'Iceland Loop' }));

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));
vi.mock('@/lib/concierge-config', () => ({
  CONCIERGE_URL: 'https://mock.example.workers.dev',
  isConciergeConfigured: () => true,
}));
vi.mock('@/core/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/trips')>();
  return {
    ...actual,
    isDefaultTrip: () => state.isDefault,
    getActiveTrip: () => ({ ...actual.getActiveTrip(), label: state.label }),
  };
});
vi.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
vi.mock('@/hooks/use-itinerary', () => ({ useItinerary: () => ({ plans: [] }) }));
vi.mock('@/hooks/use-concierge-chat', () => ({
  useConciergeChat: () => ({
    messages: [],
    status: 'idle',
    error: null,
    send: () => {},
    retry: () => {},
    reset: () => {},
    provider: 'groq',
    setProvider: () => {},
  }),
}));

import { ConciergeChat } from '@/components/concierge-chat';

function render(el: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  const trigger = document.querySelector<HTMLButtonElement>('[data-testid="concierge-trigger"]');
  act(() => trigger!.click());
  return {
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  state.isDefault = true;
  state.label = 'Iceland Loop';
});

describe('ConciergeChat trip-aware copy (#567)', () => {
  it('keeps the Nepal & Japan copy and starters on the default trip', () => {
    const r = render(createElement(ConciergeChat));
    expect(document.body.textContent).toContain('the Nepal & Japan itinerary');
    expect(document.body.textContent).toContain('Best clubs in Shibuya?');
    r.unmount();
  });

  it('uses the trip label and generic starters on a custom trip', () => {
    state.isDefault = false;
    const r = render(createElement(ConciergeChat));
    expect(document.body.textContent).toContain('the Iceland Loop itinerary');
    expect(document.body.textContent).not.toContain('Shibuya');
    expect(document.body.textContent).toContain('Find a good dinner spot near our hotel');
    r.unmount();
  });
});
