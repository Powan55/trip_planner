// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
vi.mock('@/lib/itinerary-storage', () => ({ loadPlans: () => [] }));
vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token' } }),
}));
vi.mock('framer-motion', async () => {
  const React = await import('react');
  return {
    m: { div: (props: Record<string, unknown>) => {
      const { initial, animate, exit, transition, onExitComplete, ...rest } = props;
      return React.createElement('div', rest);
    } },
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    useReducedMotion: () => false,
    useDragControls: () => ({ start: vi.fn() }),
  };
});

import Sheet from '@/components/ui/sheet-dark';
import CommandPalette from '@/components/command-palette';
import FirstRunTour from '@/components/first-run-tour';
import TimePicker from '@/components/time-picker';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
HTMLElement.prototype.scrollIntoView = vi.fn();

let root: Root;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  localStorage.clear();
});

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 70)); });
}

describe('registered overlays leave the sheet beneath open (#865)', () => {
  it.each(['palette', 'tour', 'picker'] as const)('%s owns the first Escape only', async (kind) => {
    const onClose = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const overlay = kind === 'palette' ? createElement(CommandPalette)
      : kind === 'tour' ? createElement(FirstRunTour)
      : createElement(TimePicker, { value: undefined, onChange: vi.fn() });
    const draw = (show: boolean) => act(() => root.render(createElement(Fragment, null,
      createElement(Sheet, { open: true, onClose, testId: 'underlying-sheet', children: createElement('button', null, 'Sheet') }),
      show ? overlay : null,
    )));
    draw(false);
    await flush();
    draw(true);
    await flush();
    if (kind === 'palette') {
      act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })));
    } else if (kind === 'picker') {
      act(() => (document.querySelector('[data-testid="time-picker-trigger"]') as HTMLElement).click());
    }
    await flush();
    const selector = kind === 'palette' ? '[cmdk-input]' : kind === 'tour' ? '[data-testid="tour-dialog"]' : '[data-testid="time-picker-panel"]';
    const panel = document.querySelector(selector);
    expect(panel).not.toBeNull();
    act(() => panel!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await flush();
    expect(document.querySelector(selector)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.dataset.dialogOpen).toBe('1');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(1);
    draw(false);
  });
});
