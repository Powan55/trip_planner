// @vitest-environment jsdom
//
// The four app-wide status surfaces used to create their `aria-live` region in the SAME React
// commit as its text (`if (online) return null` and friends). That is the documented ARIA
// failure mode: a live region announces a MUTATION of a region already in the accessibility
// tree, so a screen reader was never told the device went offline, never told an edit was
// queued unsynced, and never told a photo failed to save.
//
// What these tests pin is therefore NODE IDENTITY, not markup: the region element that exists
// while there is nothing to say must be the SAME DOM node that later holds the pill. React
// preserves it only while the wrapper is unconditional, so re-introducing an early `return
// null` fails here — which is the one thing a rendered assertion can prove that reading the
// file cannot.
//
// `photo-attach.tsx`'s error region gets the same wrapper; it is not rendered here because it
// needs IndexedDB + a photos store, and the idiom is identical.
//
// The second block is source-level, deliberately: three of the five fixes are one-line class /
// prop / argument changes with no rendered behaviour a jsdom test can reach (a MapLibre camera
// call, a hit-area class on a Radix primitive, a sonner Toaster prop). Same shape as
// lib/__tests__/motion-budget.test.ts's route sweep, which also reads source off disk.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ActivePresence } from '@/hooks/use-presence';
import type { SyncStatus } from '@/hooks/use-sync-status';

const h = vi.hoisted(() => ({
  presence: [] as ActivePresence[],
  sync: { pending: 0, lastAckAt: null } as SyncStatus,
}));

vi.mock('@/hooks/use-presence', () => ({ usePresence: () => h.presence }));
vi.mock('@/hooks/use-sync-status', () => ({ useSyncStatus: () => h.sync }));

import { OfflineBanner } from '@/components/offline-banner';
import { SyncStatusBadge } from '@/components/sync-status-badge';
import PresenceBar from '@/components/presence-bar';

const COMPONENTS = resolve(__dirname, '../../components');
const read = (p: string) => readFileSync(resolve(COMPONENTS, p), 'utf8');

function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    region: () => container.querySelector('[role="status"]'),
    rerender(next: ReactElement) {
      act(() => root.render(next));
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });
}

describe('status live regions are mounted before they have anything to announce', () => {
  beforeEach(() => {
    h.presence = [];
    h.sync = { pending: 0, lastAckAt: null };
    setOnLine(true);
  });
  afterEach(() => setOnLine(true));

  it('OfflineBanner keeps ONE region node across the online -> offline flip', () => {
    const r = render(createElement(OfflineBanner));

    const before = r.region();
    expect(before, 'the region must exist while online').not.toBeNull();
    expect(before?.getAttribute('aria-live')).toBe('polite');
    expect(before?.children.length, 'and must be empty — no box, no pill').toBe(0);
    // ...and must not be LABELLED offline while it is empty. The label came with the pill
    // when the pill was the region; now that the region outlives it, a static one is a
    // standing false claim. Same form as SyncStatusBadge below.
    expect(before?.getAttribute('aria-label'), 'an empty region claims nothing').toBeNull();
    expect(r.container.querySelector('[data-testid="offline-banner"]')).toBeNull();

    setOnLine(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });

    expect(r.container.querySelector('[data-testid="offline-banner"]')).not.toBeNull();
    expect(r.region()?.getAttribute('aria-label')).toBe('You are offline');
    // The announcement depends on this being a MUTATION of `before`, not a new region.
    expect(r.region()).toBe(before);

    r.unmount();
  });

  it('SyncStatusBadge keeps ONE region node when the first edit queues', () => {
    const r = render(createElement(SyncStatusBadge));

    const before = r.region();
    expect(before).not.toBeNull();
    expect(before?.children.length).toBe(0);
    expect(r.container.querySelector('[data-testid="sync-status-badge"]')).toBeNull();

    h.sync = { pending: 1, lastAckAt: null };
    r.rerender(createElement(SyncStatusBadge));

    expect(r.container.querySelector('[data-testid="sync-status-text"]')?.textContent).toBe(
      '1 pending',
    );
    expect(r.region()).toBe(before);

    r.unmount();
  });

  it('PresenceBar keeps ONE region node when a traveler joins', () => {
    const r = render(createElement(PresenceBar));

    const before = r.region();
    expect(before).not.toBeNull();
    expect(before?.children.length).toBe(0);

    h.presence = [{ uid: 'u1', name: 'Mei', accent: '#f0c760', lastSeen: Date.now() }];
    r.rerender(createElement(PresenceBar));

    expect(r.container.textContent).toContain('Mei');
    expect(r.region()).toBe(before);

    r.unmount();
  });
});

describe('the one-line a11y contracts, read off disk', () => {
  it('the map popup camera offset is unconditional — reduced motion picks the DURATION', () => {
    const src = read('trip-map.tsx');
    const openPopup = src.slice(src.indexOf('const openPopup ='), src.indexOf('const focusMarker ='));

    expect(openPopup).toContain('offset: POPUP_VIEW_OFFSET');
    // POPUP_VIEW_OFFSET is a LAYOUT correction (it keeps the popup's close button and
    // favourite heart out of the shell clip and out from under the fixed navbar). Gating the
    // call on motion preference took that fix away from reduced-motion users.
    expect(openPopup).not.toMatch(/if \(!prefersReducedMotion\(\)\)/);
    expect(openPopup).toContain('prefersReducedMotion() ? 0 :');
  });

  it("the sheet's only close button carries the same 44px hit area as the dialog's", () => {
    for (const file of ['ui/sheet.tsx', 'ui/dialog.tsx']) {
      const close = read(file).match(/Primitive\.Close\s+className="([^"]+)"/)?.[1] ?? '';
      expect(close, `${file} close button`).toContain('inline-flex');
      expect(close, `${file} close button`).toMatch(/min-h-(tap|\[44px\])/);
      expect(close, `${file} close button`).toMatch(/min-w-(tap|\[44px\])/);
    }
  });

  it('the toaster renders a close button, so a duration:Infinity toast has a keyboard exit', () => {
    // sonner's own Escape binding collapses the stack rather than dismissing, and the swipe is
    // pointer-only (WCAG 2.1.1). The service-worker update prompt is `duration: Infinity`.
    expect(read('ui/sonner.tsx')).toMatch(/^\s*closeButton$/m);
    expect(read('service-worker-registrar.tsx')).toContain('duration: Infinity');
  });
});
