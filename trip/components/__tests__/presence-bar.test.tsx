// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/use-presence', () => ({
  usePresence: () => [
    { uid: '1', name: 'Alice', accent: 'hsl(10, 50%, 50%)' },
    { uid: '2', name: 'Bob', accent: 'hsl(200, 50%, 50%)' },
  ],
}));

import PresenceBar from '@/components/presence-bar';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(PresenceBar)));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('PresenceBar — mobile width constraint', () => {
  it('the presence pill has max-w-[calc(100vw-6rem)] on mobile', () => {
    const pill = document.querySelector('div[class*="max-w-"]');
    expect(pill).not.toBeNull();
    expect(pill?.className).toContain('max-w-[calc(100vw-6rem)]');
  });

  it('shows active travelers and the live region label', () => {
    const liveRegion = document.querySelector('[role="status"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.getAttribute('aria-live')).toBe('polite');
    expect(liveRegion?.getAttribute('aria-label')).toBe('Travelers active now');

    const text = document.body.textContent;
    expect(text).toContain('Alice');
    expect(text).toContain('Bob');
    expect(text).toContain('active now');
  });
});
