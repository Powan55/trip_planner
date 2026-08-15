// @vitest-environment jsdom
//
// #20 — `components/preflight-checks.tsx` mounted for real (createRoot + act), asserted on the
// DOM. The verdict logic is unit-tested in `lib/__tests__/preflight.test.ts`; what is asserted
// HERE is the wiring nothing else covers: that a browser missing the Cache API and
// StorageManager (jsdom — and every locked-down/private-mode browser) renders "couldn't check"
// rather than a false pass, that the dormant/no-traveller sync path renders neutrally instead of
// throwing, and that the status-surface a11y contract holds.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import PreflightChecks from '@/components/preflight-checks';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<PreflightChecks />);
  });
  // A second flush so the async environment checks (Cache API / estimate()) have resolved.
  await act(async () => {});
  return container;
}

const row = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-testid="preflight-row-${id}"]`);

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  delete (globalThis as { caches?: unknown }).caches;
});

describe('#20 · the night-before block on /checklist', () => {
  it('a browser with no Cache API and no StorageManager reports "couldn\'t check", never a pass', async () => {
    const c = await mount();
    expect(row(c, 'map-shell')?.dataset.state).toBe('unknown');
    expect(row(c, 'storage')?.dataset.state).toBe('unknown');
    expect(row(c, 'map-shell')?.textContent).toContain("Couldn't check");
    expect(c.querySelector('[data-testid="preflight-tally"]')?.textContent).toContain(
      "2 couldn't be checked"
    );
  });

  it('renders neutrally on a dormant/guest build instead of erroring', async () => {
    const c = await mount();
    const sync = row(c, 'sync');
    expect(sync?.dataset.state).toBe('ok');
    expect(sync?.textContent).toContain('Nothing waiting to upload');
    // The clock row always renders — the device clock needs no API and no network.
    expect(row(c, 'clock')).not.toBeNull();
    expect(row(c, 'simulated-clock')).toBeNull();
  });

  it('a persisted ?today= override adds the simulated-clock row', async () => {
    window.sessionStorage.setItem('tripPlannerTodayOverride', '2026-12-14');
    const c = await mount();
    const sim = row(c, 'simulated-clock');
    expect(sim?.dataset.state).toBe('attention');
    expect(sim?.textContent).toContain('2026-12-14');
  });

  it('finds the map engine in a real-shaped precache and still refuses to promise offline tiles', async () => {
    (globalThis as { caches?: unknown }).caches = {
      keys: async () => ['trip-images-v1', 'trip-precache-93f277c05d06'],
      open: async () => ({
        keys: async () => [{ url: 'https://x/_next/static/chunks/c04c.js' } as Request],
        match: async () => ({
          headers: { get: () => '1032412' },
          text: async () => 'var maplibregl=1',
        }),
      }),
    };
    const c = await mount();
    const map = row(c, 'map-shell');
    expect(map?.dataset.state).toBe('ok');
    expect(map?.textContent).toContain('Saved on this device');
    expect(c.textContent?.toLowerCase()).not.toContain('offline map');
  });

  it('is a live status region with a full-sentence screen-reader summary', async () => {
    const c = await mount();
    const section = c.querySelector<HTMLElement>('[data-testid="preflight-checks"]');
    // The live region is the SUMMARY SPAN, never the card. `role="status"` implies
    // `aria-atomic="true"`, so on the <section> it re-announced the heading, the intro, the tally
    // and all five rows with their detail sentences — on resolve AND on every sync change while
    // the page sat open — and it replaced the section's implicit `region` role, dropping the block
    // out of landmark navigation. Both halves are pinned here so the "simpler" version cannot
    // come back.
    expect(section?.getAttribute('role')).toBeNull();
    expect(section?.getAttribute('aria-live')).toBeNull();
    expect(section?.getAttribute('aria-labelledby')).toBe('preflight-heading');
    const live = section?.querySelector('.sr-only');
    expect(live?.getAttribute('role')).toBe('status');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    const summary = live?.textContent ?? '';
    expect(summary).toContain('Night-before check:');
    expect(summary).toContain('Map shell —');
    expect(summary).toContain('None of these checks used the network.');
    // Not colour alone: every row's state is in its text, not just its class.
    for (const id of ['map-shell', 'storage', 'clock', 'sync']) {
      expect(row(c, id)?.textContent?.trim().length ?? 0).toBeGreaterThan(20);
    }
  });
});
