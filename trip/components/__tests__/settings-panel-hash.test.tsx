// @vitest-environment jsdom
//
// #1076 — the sync pill links to /settings/#trip-access. The group is a closed <details>, so the
// panel has to open it from the hash on mount and on later hash changes (pill tapped on /settings).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/firebase-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/firebase-config')>()),
  getTripId: () => 'trip-key-1',
  isRemoteConfigured: () => true,
  isTripRemoteConfigured: () => true,
}));

vi.mock('@/components/itinerary-provider', () => ({ useItineraryContext: () => ({ plans: [], clearAll: vi.fn() }) }));
vi.mock('@/hooks/use-expenses', () => ({ useExpenses: () => ({ expenses: [], clearAll: vi.fn(), restoreExpenses: vi.fn() }) }));
vi.mock('@/hooks/use-budget', () => ({
  useBudget: () => ({ model: { version: 1, homeCurrency: 'USD', rates: {}, legBudgets: {}, categoryBudgets: {} }, reset: vi.fn(), commit: vi.fn(), setHomeCurrency: vi.fn() }),
}));
vi.mock('@/hooks/use-journal', () => ({ useJournal: () => ({ clearAll: vi.fn(), entries: [] }) }));
vi.mock('@/hooks/use-photos', () => ({ usePhotos: () => ({ photos: [], removePhoto: vi.fn() }) }));

import SettingsPanel from '@/components/settings-panel';

const group = () => document.querySelector<HTMLDetailsElement>('[data-testid="settings-group-access"]')!;

let root: Root;
let container: HTMLDivElement;

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(SettingsPanel));
  });
}

beforeEach(() => {
  window.location.hash = '';
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.location.hash = '';
});

describe('Settings Trip access group opens from #trip-access', () => {
  it('opens and scrolls on mount when the hash matches', async () => {
    window.location.hash = '#trip-access';
    await mount();
    expect(group().id).toBe('trip-access');
    expect(group().open).toBe(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('stays closed on any other hash', async () => {
    window.location.hash = '#elsewhere';
    await mount();
    expect(group().open).toBe(false);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('opens when the hash changes after mount (pill tapped on /settings)', async () => {
    await mount();
    expect(group().open).toBe(false);
    await act(async () => {
      window.location.hash = '#trip-access';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(group().open).toBe(true);
  });

  it('opens on popstate too (history pushState fires no hashchange)', async () => {
    await mount();
    await act(async () => {
      history.pushState(null, '', '#trip-access');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(group().open).toBe(true);
  });
});
