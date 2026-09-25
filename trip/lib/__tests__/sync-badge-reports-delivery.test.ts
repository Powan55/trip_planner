// @vitest-environment jsdom
//
// D-546 — the sync badge used to report TRANSPORT and be read as DELIVERY.
//
// Everything `useSyncStatus` knows comes out of this device's own outbox: `lastAckAt` is stamped
// when Firestore accepted the bytes, which is equally true whether one peer or zero will ever
// read them. So "Synced 2m ago" held just as firmly while the share link was routing every joiner
// onto a different trip — the badge was the one surface that could have said the data was going
// nowhere, and it said the opposite.
//
// What is pinned here is the SPLIT and its TONE. Being alone on a trip is the normal state of a
// solo trip, so the alone case must stay neutral — no amber, no alert role, no warning icon — and
// the honest weaker word ("Saved": uploaded, read by nobody yet) instead of a claim about
// delivery. Crying wolf at the normal case is the failure mode that would get the whole signal
// ignored, so it is asserted as hard as the signal itself.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

import type { ActivePresence } from '@/hooks/use-presence';
import type { SyncStatus } from '@/hooks/use-sync-status';

const h = vi.hoisted(() => ({
  presence: [] as ActivePresence[],
  sync: {
    pending: 0,
    blocked: 0,
    readBlocked: false,
    lastAckAt: null,
    localOnly: false,
  } as SyncStatus,
}));

vi.mock('@/hooks/use-presence', () => ({ usePresence: () => h.presence }));
vi.mock('@/hooks/use-sync-status', () => ({ useSyncStatus: () => h.sync }));

import { SyncStatusBadge } from '@/components/sync-status-badge';

const ACKED = '2026-12-12T06:00:00.000Z';
const peer = (name: string): ActivePresence => ({
  uid: `uid-${name}`,
  name,
  accent: '#FFC43D',
  lastSeen: Date.now(),
});

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    q: (sel: string) => container.querySelector(sel),
    text: () => container.querySelector('[data-testid="sync-status-text"]')?.textContent ?? '',
    state: () =>
      container.querySelector('[data-testid="sync-status-badge"]')?.getAttribute('data-state'),
    summary: () => container.querySelector('.sr-only')?.textContent ?? '',
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('D-546 — the sync badge reports delivery, not just transport', () => {
  beforeEach(() => {
    h.presence = [];
    h.sync = { pending: 0, blocked: 0, readBlocked: false, lastAckAt: ACKED, localOnly: false, paused: false };
  });

  it('with no one else on the trip it says "Saved", never "Synced"', () => {
    const r = render(createElement(SyncStatusBadge));

    expect(r.text()).toMatch(/^Saved /);
    expect(r.text()).not.toContain('Synced');
    expect(r.state()).toBe('synced-alone');
    r.unmount();
  });

  it('…and says so in full, without claiming anyone received it', () => {
    const r = render(createElement(SyncStatusBadge));

    expect(r.summary()).toContain('uploaded to the shared trip');
    expect(r.summary()).toContain('No one else is on the trip right now');
    r.unmount();
  });

  it('BEING ALONE IS NOT AN ERROR: no alert, no amber, no warning icon', () => {
    const r = render(createElement(SyncStatusBadge));

    expect(r.q('[role="alert"]')).toBeNull();
    expect(r.q('.text-amber-300')).toBeNull();
    // The check mark is the synced-family icon; the warning triangle belongs to `blocked`.
    expect(r.q('svg.lucide-alert-triangle')).toBeNull();
    // aria-live stays polite — an ambient fact is never interrupting.
    expect(r.q('[role="status"]')?.getAttribute('aria-live')).toBe('polite');
    r.unmount();
  });

  it('names the audience once someone else is actually on the trip', () => {
    h.presence = [peer('Uttam')];
    const r = render(createElement(SyncStatusBadge));

    expect(r.text()).toBe('Synced · 1 here');
    expect(r.state()).toBe('synced');
    expect(r.summary()).toContain('Uttam is on it right now');
    r.unmount();
  });

  it('counts more than one, and the region is LABELLED with what it says', () => {
    h.presence = [peer('Uttam'), peer('Sabin')];
    const r = render(createElement(SyncStatusBadge));

    expect(r.text()).toBe('Synced · 2 here');
    expect(r.q('[role="status"]')?.getAttribute('aria-label')).toBe('Synced · 2 here');
    expect(r.summary()).toContain('2 other travellers are on it right now');
    r.unmount();
  });

  it('the audience arriving is a MUTATION of the standing region, so it is announced', () => {
    const r = render(createElement(SyncStatusBadge));
    const region = r.q('[role="status"]');
    expect(r.text()).toMatch(/^Saved /);

    h.presence = [peer('Uttam')];
    r.rerender(createElement(SyncStatusBadge));

    expect(r.text()).toBe('Synced · 1 here');
    expect(r.q('[role="status"]')).toBe(region);
    r.unmount();
  });

  it('a live outbox fact still outranks the audience — pending and blocked are unchanged', () => {
    h.presence = [peer('Uttam')];
    h.sync = { pending: 3, blocked: 0, readBlocked: false, lastAckAt: ACKED, localOnly: false, paused: false };
    const pendingRender = render(createElement(SyncStatusBadge));
    expect(pendingRender.text()).toBe('3 pending');
    expect(pendingRender.state()).toBe('pending');
    pendingRender.unmount();

    h.sync = { pending: 3, blocked: 3, readBlocked: false, lastAckAt: ACKED, localOnly: false, paused: false };
    const blockedRender = render(createElement(SyncStatusBadge));
    expect(blockedRender.text()).toBe('3 not syncing');
    expect(blockedRender.state()).toBe('blocked');
    blockedRender.unmount();
  });

  it('the local-only offer is untouched — an unshared pack has no audience to report', () => {
    h.sync = { pending: 0, blocked: 0, readBlocked: false, lastAckAt: null, localOnly: true, paused: false };
    const r = render(createElement(SyncStatusBadge));

    expect(r.text()).toBe('This device only');
    expect(r.state()).toBe('local-only');
    // Still the one interactive state: a real button, not a pill with a click handler.
    expect(r.q('[data-testid="sync-status-share-cta"]')?.tagName).toBe('BUTTON');
    r.unmount();
  });

  it('nothing to report is still nothing to render (dormant / guest)', () => {
    h.sync = { pending: 0, blocked: 0, readBlocked: false, lastAckAt: null, localOnly: false, paused: false };
    h.presence = [peer('Uttam')];
    const r = render(createElement(SyncStatusBadge));

    expect(r.q('[data-testid="sync-status-badge"]')).toBeNull();
    expect(r.q('[role="status"]')?.getAttribute('aria-label')).toBeNull();
    r.unmount();
  });
});
