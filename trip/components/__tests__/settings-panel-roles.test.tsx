// @vitest-environment jsdom
//
// #858 — an owner can make another member an owner, and step down while a second owner exists, so a
// lost owner device no longer has to strand the trip. The rules already allowed the writes; this
// pins the controls: who sees them, and that each is behind a confirm.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/use-online', () => ({ useOnline: () => true }));
vi.mock('@/lib/firebase-config', () => ({ getTripId: () => 'trip-key-1', isRemoteConfigured: () => true }));

let roster: Record<string, string> = {};
const setTripMemberRole = vi.fn(async (..._a: unknown[]) => 'ok');
vi.mock('@/lib/trips-remote', () => ({
  fetchTripMembers: async () => ({ state: 'roster', members: roster }),
  addTripMember: vi.fn(async () => 'ok'),
  removeTripMember: vi.fn(async () => 'ok'),
  setTripMemberRole: (...a: unknown[]) => setTripMemberRole(...a),
}));
vi.mock('@/lib/firebase-remote', () => ({ getRemote: async () => ({ uid: 'me' }) }));
vi.mock('@/hooks/use-budget', () => ({
  useBudget: () => ({ model: { version: 1, homeCurrency: 'USD', rates: {}, legBudgets: {}, categoryBudgets: {} }, commit: vi.fn(), setHomeCurrency: vi.fn() }),
}));

import { TripAccessGroup } from '@/components/settings-panel';

const q = (id: string) => document.body.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
const must = (id: string) => {
  const el = q(id);
  if (!el) throw new Error(`missing [data-testid="${id}"]`);
  return el;
};
const click = (el: HTMLElement) => act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
async function flush(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

let root: Root;
let container: HTMLDivElement;

async function mount(members: Record<string, string>) {
  roster = members;
  root = createRoot(container);
  act(() => root.render(createElement(TripAccessGroup)));
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('TripAccessGroup — owner roles (#858)', () => {
  it('an owner can promote a member, behind a confirm', async () => {
    await mount({ me: 'owner', them: 'member' });
    click(must('settings-access-promote'));
    await flush();
    expect(setTripMemberRole).not.toHaveBeenCalled();
    expect(q('settings-access-promote-dialog')).not.toBeNull();

    click(must('settings-access-promote-confirm'));
    await flush();
    expect(setTripMemberRole).toHaveBeenCalledWith('trip-key-1', 'them', 'owner');
  });

  it('the sole owner cannot step down (the rules refuse a roster with no owner)', async () => {
    await mount({ me: 'owner', them: 'member' });
    expect(q('settings-access-stepdown')).toBeNull();
  });

  it('with a second owner, an owner can step down, behind a confirm', async () => {
    await mount({ me: 'owner', them: 'owner' });
    expect(q('settings-access-promote')).toBeNull(); // nobody left to promote
    click(must('settings-access-stepdown'));
    await flush();
    expect(setTripMemberRole).not.toHaveBeenCalled();

    click(must('settings-access-stepdown-confirm'));
    await flush();
    expect(setTripMemberRole).toHaveBeenCalledWith('trip-key-1', 'me', 'member');
  });

  it('a plain member sees neither control', async () => {
    await mount({ me: 'member', them: 'owner', other: 'member' });
    expect(q('settings-access-promote')).toBeNull();
    expect(q('settings-access-stepdown')).toBeNull();
  });
});
