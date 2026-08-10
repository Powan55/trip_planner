// @vitest-environment jsdom
//
// S237 — the full ConciergeChat gating matrix, with `@/lib/concierge-config` mocked so both the
// "configured" and "unconfigured" branches can be driven explicitly in one file (the real-env
// "unconfigured by default" case has its OWN unmocked proof in
// `concierge-chat-dormant.test.ts`). Proves: no resolved traveler -> null even when configured;
// configured + resolved traveler -> the trigger renders.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const state = vi.hoisted(() => ({
  traveler: null as { name: string; token: string; accent: string } | null,
  configured: false,
}));

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: state.traveler }),
}));

vi.mock('@/lib/concierge-config', () => ({
  CONCIERGE_URL: 'https://mock.example.workers.dev',
  isConciergeConfigured: () => state.configured,
}));

import { ConciergeChat } from '@/components/concierge-chat';

function render(el: ReturnType<typeof createElement>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  state.traveler = null;
  state.configured = false;
});

describe('ConciergeChat gating (S237)', () => {
  it('renders nothing with no resolved traveler, even when configured', () => {
    state.configured = true;
    state.traveler = null;
    const r = render(createElement(ConciergeChat));
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });

  it('renders nothing when unconfigured, even with a resolved traveler', () => {
    state.configured = false;
    state.traveler = { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' };
    const r = render(createElement(ConciergeChat));
    expect(r.container.innerHTML).toBe('');
    r.unmount();
  });

  it('renders the trigger once BOTH configured and a resolved traveler are present', () => {
    state.configured = true;
    state.traveler = { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' };
    const r = render(createElement(ConciergeChat));
    const trigger = r.container.querySelector('[data-testid="concierge-trigger"]');
    expect(trigger).not.toBeNull();
    expect(trigger!.getAttribute('aria-label')).toBe('Open trip concierge chat');
    r.unmount();
  });
});
