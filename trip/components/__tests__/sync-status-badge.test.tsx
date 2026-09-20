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
  // D-542: every case below is about a trip that IS shared, so give the default pack a share id.
  // Without one the badge is in its `localOnly` state and never reaches the synced/pending/blocked
  // wording these assert. The local-only state has its own describe block at the bottom.
  localStorage.setItem(STORAGE_KEYS.defaultTripShare, 'a-shared-trip-id');
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

/**
 * D-542 — the state that used to be silence. On the default pack with no share id the outbox is
 * gated off, so every field reads neutral and the badge rendered NOTHING: identical to "all
 * synced". That silence is the whole bug report, so these assert the pill is present, says which,
 * and offers the way out.
 */
describe('D-542 — the local-only state is visible and actionable', () => {
  it('says "This device only" when the default pack has no share id', async () => {
    localStorage.removeItem(STORAGE_KEYS.defaultTripShare);
    const c = await mount();
    const badge = c.querySelector('[data-testid="sync-status-badge"]');
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute('data-state')).toBe('local-only');
    expect(c.querySelector('[data-testid="sync-status-text"]')?.textContent).toBe(
      'This device only',
    );
  });

  it('is a real button that opens the share dialog — keyboard reachable, not a clickable div', async () => {
    localStorage.removeItem(STORAGE_KEYS.defaultTripShare);
    const c = await mount();
    const cta = c.querySelector('[data-testid="sync-status-share-cta"]');
    expect(cta).not.toBeNull();
    expect(cta?.tagName).toBe('BUTTON');
    expect(cta?.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('goes quiet again the moment a share id exists — the offer is not permanent nagging', async () => {
    const c = await mount(); // beforeEach already set a share id
    expect(c.querySelector('[data-testid="sync-status-badge"]')).toBeNull();
  });

  it('stays quiet on a DORMANT build — sharing is impossible there, so offering it is a dead end', async () => {
    localStorage.removeItem(STORAGE_KEYS.defaultTripShare);
    gate.remoteOn = false;
    const c = await mount();
    expect(c.querySelector('[data-testid="sync-status-badge"]')).toBeNull();
  });

  it('a real pending count WINS over the offer to share', async () => {
    // Belt-and-braces on the precedence chain: `localOnly` is last, so a live fact about a trip
    // that is already shared can never be masked by the invitation to share one.
    localStorage.removeItem(STORAGE_KEYS.defaultTripShare);
    localStorage.setItem(
      STORAGE_KEYS.syncOutbox,
      JSON.stringify({ version: 1, dirty: { itinerary: ['2026-12-09'] } }),
    );
    const c = await mount();
    expect(c.querySelector('[data-testid="sync-status-badge"]')?.getAttribute('data-state')).toBe(
      'pending',
    );
  });
});
