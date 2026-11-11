// @vitest-environment jsdom
//
// A signed-out visitor must be able to read /privacy/ (the provider normally withholds every
// page until someone is signed in), and the trip chrome must stay out of the DOM.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pathname = { current: '/privacy/' };
vi.mock('next/navigation', () => ({
  usePathname: () => pathname.current,
  useRouter: () => ({ push: () => {}, replace: () => {}, prefetch: () => {} }),
}));

vi.mock('framer-motion', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const m = new Proxy(
    {},
    { get: (_t, tag: string) => (p: { children?: unknown }) => React.createElement(tag, null, p.children as never) },
  );
  return { m, AnimatePresence: ({ children }: { children: unknown }) => children };
});

import { ItineraryProvider } from '@/components/itinerary-provider';
import TravelerOnly from '@/components/traveler-only';
import PrivacyPage from '@/app/privacy/page';

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.localStorage.clear();
});

function renderSignedOut(path: string) {
  pathname.current = path;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <ItineraryProvider>
        <TravelerOnly>
          <nav data-testid="chrome" />
        </TravelerOnly>
        <PrivacyPage />
      </ItineraryProvider>,
    ),
  );
}

describe('signed-out legal page', () => {
  it('shows the privacy text and no trip chrome on /privacy/', () => {
    renderSignedOut('/privacy/');
    expect(container.querySelector('h1')?.textContent).toBe('Privacy');
    expect(container.textContent).toContain('Firebase');
    expect(container.querySelector('[data-testid="chrome"]')).toBeNull();
  });

  it('still withholds an app route', () => {
    renderSignedOut('/more/');
    expect(container.textContent).not.toContain('What this app stores');
  });
});
