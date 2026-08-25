// @vitest-environment jsdom
//
// #271 — `components/sync-status-badge.tsx` mounted for real (createRoot + act), proving the
// badge's `isBlocked` reflects a permission-denied READ, not just the write-side outbox. framer
// -motion is mocked to a passthrough div (mirrors `time-picker-tab-trap.test.tsx`'s harness — the
// real `m.div` throws outside the app's `LazyMotion strict` provider, which isn't mounted here).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

vi.mock('framer-motion', async () => {
  const React = await import('react');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const strip = (p: any) => {
    const { initial, animate, exit, transition, ...rest } = p;
    return rest;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    m: { div: (props: any) => React.createElement('div', strip(props)) },
  };
});

const gate = vi.hoisted(() => ({ remoteOn: true, traveler: { name: 'Powan' } as { name: string } | null }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: { apiKey: 'k', projectId: 'p', appId: 'a' },
  isRemoteConfigured: () => gate.remoteOn,
  isTripRemoteConfigured: () => gate.remoteOn,
  getTripId: () => 'nepal-japan-2026',
}));
vi.mock('@/lib/token-auth', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/lib/token-auth')>();
  return { ...orig, getActiveTraveler: () => gate.traveler };
});

import SyncStatusBadge from '@/components/sync-status-badge';
import { setReadDenied } from '@/core/sync/read-denied';

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<SyncStatusBadge />);
  });
  return container;
}

beforeEach(() => {
  localStorage.clear();
  gate.remoteOn = true;
  gate.traveler = { name: 'Powan' };
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  setReadDenied('itinerary', false); // module-singleton flag — reset between tests
  vi.restoreAllMocks();
});

describe('#271 — SyncStatusBadge reflects a permission-denied read, not just a denied write', () => {
  it('renders nothing when there is nothing pending, blocked, or ever synced', async () => {
    const c = await mount();
    expect(c.querySelector('[data-testid="sync-status-badge"]')).toBeNull();
  });

  it('shows "Not syncing" / data-state=blocked on a denied read with NOTHING else pending (first-load denial)', async () => {
    await act(async () => {
      setReadDenied('itinerary', true);
    });
    const c = await mount();
    const badge = c.querySelector('[data-testid="sync-status-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-state')).toBe('blocked');
    expect(c.querySelector('[data-testid="sync-status-text"]')?.textContent).toBe('Not syncing');
  });

  it('clears back to nothing-to-show once the read denial lifts, live, no remount', async () => {
    await act(async () => {
      setReadDenied('itinerary', true);
    });
    const c = await mount();
    expect(c.querySelector('[data-testid="sync-status-badge"]')?.getAttribute('data-state')).toBe('blocked');

    await act(async () => {
      setReadDenied('itinerary', false);
    });
    expect(c.querySelector('[data-testid="sync-status-badge"]')).toBeNull();
  });
});
