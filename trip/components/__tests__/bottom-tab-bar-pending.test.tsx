// @vitest-environment jsdom
// Pressed-tab highlight: pointerdown lights data-active early, cancel clears it, a route
// change clears it, and aria-current always follows the real pathname.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let path = '/';
vi.mock('next/navigation', () => ({ usePathname: () => path }));
vi.mock('@/hooks/use-view-transition', () => ({ useViewTransition: () => vi.fn() }));

import BottomTabBar from '@/components/bottom-tab-bar';

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(BottomTabBar)));
}
const tab = (name: string) => document.querySelector(`[data-testid="tab-bar-${name}"]`) as HTMLElement;
const fire = (el: HTMLElement, type: string, button = 0) =>
  act(() => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, button }));
  });

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  path = '/';
});

describe('BottomTabBar pending highlight', () => {
  it('pointerdown lights data-active only; cancel and non-primary button do not stick', () => {
    mount();
    const map = tab('map');
    fire(map, 'pointerdown', 2);
    expect(map.dataset.active).toBeUndefined();
    fire(map, 'pointerdown');
    expect(map.dataset.active).toBe('true');
    expect(map.getAttribute('aria-current')).toBeNull();
    fire(map, 'pointercancel');
    expect(map.dataset.active).toBeUndefined();
  });

  it('a pathname change clears pending', () => {
    mount();
    fire(tab('map'), 'pointerdown');
    path = '/guides/';
    act(() => root!.render(createElement(BottomTabBar)));
    expect(tab('map').dataset.active).toBeUndefined();
    expect(tab('guides').getAttribute('aria-current')).toBe('page');
  });
});
