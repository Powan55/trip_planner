// @vitest-environment jsdom
//
// The default pack says it is the shared trip only when sync is configured AND the device has a
// shared id. A build with no sync, or a device holding local edits with no id yet, keeps the
// sample wording.

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const gate = vi.hoisted(() => ({ configured: true, shareId: 'shared-id' }));

vi.mock('@/lib/firebase-config', () => ({
  getTripId: () => gate.shareId,
  isRemoteConfigured: () => gate.configured,
  isTripRemoteConfigured: () => gate.configured && gate.shareId !== '',
}));
vi.mock('@/core/storage/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/storage/gateway')>()),
  getDefaultTripShareId: () => gate.shareId,
}));
vi.mock('@/lib/trips-remote', () => ({
  seedAccountDocs: async () => {},
  pushTripList: async () => {},
  pushTripMeta: async () => {},
  fetchTripMeta: async () => undefined,
  subscribeTripList: () => () => {},
  createTripDoc: async () => {},
  fetchTripMembers: async () => ({ state: 'unknown' }),
}));

import TripsHub from '@/components/trips-hub';
import { TripGroup } from '@/components/settings-panel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const text = (id: string): string =>
  document.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';

async function mount(el: React.ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(el);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem('tripPlannerToken', 'Uttam');
  window.localStorage.setItem('tripPlannerUserName', 'Uttam');
  window.localStorage.setItem('tripPlannerSyncCode', 'already-has-one');
  gate.configured = true;
  gate.shareId = 'shared-id';
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const CASES: [string, boolean, string, RegExp, RegExp][] = [
  ['sync configured and a shared id', true, 'shared-id', /Shared trip — synced/, /shared trip/],
  ['sync configured but no id yet', true, '', /Sample — on this device only/, /sample trip/],
  ['sync not configured', false, 'shared-id', /Sample — on this device only/, /sample trip/],
];

describe('trips hub, default pack row', () => {
  it.each(CASES)('%s', async (_why, configured, shareId, hubCopy) => {
    gate.configured = configured;
    gate.shareId = shareId;
    await mount(<TripsHub />);
    expect(text('trips-hub-row-0')).toMatch(hubCopy);
  });
});

describe('settings Trip group, default pack note', () => {
  it.each(CASES)('%s', async (_why, configured, shareId, _hub, noteCopy) => {
    gate.configured = configured;
    gate.shareId = shareId;
    await mount(<TripGroup />);
    expect(text('settings-trip-key-default').toLowerCase()).toMatch(noteCopy);
    expect(document.querySelector('[data-testid="settings-trip-key"]')).toBeNull();
  });
});
