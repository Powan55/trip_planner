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
  const strip = (p: any) => {
    const { initial, animate, exit, transition, ...rest } = p;
    return rest;
  };
  return {
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
import { STORAGE_KEYS } from '@/core/storage/gateway';

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

  // The precedence itself. Blocked and pending are not mutually exclusive — a device with queued
  // edits can also be refused its read — and nothing else in this file sets both, so the order of
  // the `isBlocked ? … : isPending ? …` ternary was unasserted. Reversed, a blocked device reads
  // "pending" forever, which is the exact symptom #267 exists to fix.
  it('blocked WINS over pending when a device is both', async () => {
    // One dirty outbox chunk — "1 pending" on its own.
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-09'] } }),
    );
    const c = await mount();
    const state = () =>
      c.querySelector('[data-testid="sync-status-badge"]')?.getAttribute('data-state');
    const text = () => c.querySelector('[data-testid="sync-status-text"]')?.textContent;
    // Control: the fixture really does produce pending > 0, so the flip below is load-bearing.
    expect(state()).toBe('pending');
    expect(text()).toBe('1 pending');

    // Now deny the read as well, live. Both are true; "pending" would promise the queue drains on
    // its own, and it never will.
    await act(async () => {
      setReadDenied('itinerary', true);
    });
    expect(state()).toBe('blocked');
    expect(text()).toBe('Not syncing');
  });
});
