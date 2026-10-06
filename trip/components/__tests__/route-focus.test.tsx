// @vitest-environment jsdom
// #871 — focus moves to #main on a pathname change, not on first render.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { RouteFocus } from '@/components/route-focus';

let mockPath = '/';
vi.mock('next/navigation', () => ({ usePathname: () => mockPath }));

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = '<div id="main" tabindex="-1"></div>';
  mockPath = '/';
});

describe('RouteFocus', () => {
  it('skips first load, focuses #main after the path changes', async () => {
    const root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root.render(<RouteFocus />));
    expect(document.activeElement).not.toBe(document.getElementById('main'));

    mockPath = '/plan';
    await act(async () => root.render(<RouteFocus />));
    expect(document.activeElement).toBe(document.getElementById('main'));
  });
});
