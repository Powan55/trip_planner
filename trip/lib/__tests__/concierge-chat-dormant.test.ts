// @vitest-environment jsdom
//
// S237 — proves the concierge chat is FULLY INVISIBLE in the real default build state: no
// `NEXT_PUBLIC_CONCIERGE_URL` set. This deliberately does NOT mock `@/lib/concierge-config` —
// it exercises the real module reading the real (unset, in this test run) env var, which is the
// exact state of every build today (`worker/README.md`: the Worker isn't deployed yet). Only
// `useActiveTraveler` is mocked, and to the MOST PERMISSIVE case (a resolved traveler) — so this
// isolates the config gate specifically: even a signed-in traveler sees nothing when the env var
// is absent.

import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { vi } from 'vitest';

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({
    traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' },
  }),
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

describe('ConciergeChat — dormant default build (NEXT_PUBLIC_CONCIERGE_URL unset)', () => {
  it('renders nothing at all, even for a resolved, signed-in traveler', () => {
    const r = render(createElement(ConciergeChat));
    expect(r.container.innerHTML).toBe('');
    expect(process.env.NEXT_PUBLIC_CONCIERGE_URL).toBeFalsy(); // sanity: really unset in this run
    r.unmount();
  });
});
