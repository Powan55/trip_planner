// @vitest-environment jsdom
// #963 — the FAB must reserve its band in scroll-padding-bottom while mounted, so a right-edge
// control focused mid-list is not left underneath it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

let path = '/checklist/';
vi.mock('next/navigation', () => ({ usePathname: () => path }));

import QuickAddFab from '@/components/quick-add-fab';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(p: string) {
  path = p;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<QuickAddFab />));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('QuickAddFab scroll-padding', () => {
  it('reserves the FAB band on a route that shows it', () => {
    mount('/checklist/');
    expect(container.querySelector('[data-testid="quick-add-fab"]')).not.toBeNull();
    expect(container.querySelector('style')?.textContent).toMatch(/scroll-padding-bottom:calc\(.*5\.5rem\)/);
  });

  it('reserves nothing where the FAB is suppressed', () => {
    mount('/packing/');
    expect(container.querySelector('style')).toBeNull();
  });
});
