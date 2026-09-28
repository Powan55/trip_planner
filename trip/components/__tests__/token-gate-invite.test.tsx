// @vitest-environment jsdom
//
// #641: a signed-out visitor's invite leaves the URL on mount and is redeemed after log-in, before
// the join. A refused invite joins nothing and says why.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ calls: [] as string[], redeem: 'joined' as string }));

vi.mock('@/lib/firebase-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/firebase-config')>()),
  isRemoteConfigured: () => true,
}));
vi.mock('@/lib/firebase-remote', () => ({ needsAccountUpgrade: async () => null }));
vi.mock('@/lib/account-handoff-remote', () => ({
  signInWithHandoff: async () => ({
    uid: 'uid-a',
    link: { accountId: '11111111-2222-4333-8444-555555555555' },
  }),
}));
vi.mock('@/lib/trips-remote', () => ({
  probeAccountIdentity: async () => ({ verdict: 'exists', name: 'Powan' }),
}));
vi.mock('@/lib/invites-remote', () => ({
  redeemInvite: async (tripId: string, token: string) => {
    h.calls.push(`redeem:${tripId}:${token}`);
    return h.redeem === 'hang' ? new Promise(() => {}) : h.redeem;
  },
}));
vi.mock('@/core/trips/registry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/trips/registry')>()),
  joinTrip: (id: string) => {
    h.calls.push(`join:${id}`);
    return true;
  },
}));
vi.mock('framer-motion', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const DROP = new Set(['initial', 'animate', 'exit', 'transition', 'variants', 'layout', 'layoutId']);
  const m = new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        const Motion = React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
          const clean: Record<string, unknown> = {};
          for (const k of Object.keys(props)) if (!DROP.has(k)) clean[k] = props[k];
          return React.createElement(tag, { ...clean, ref });
        });
        Motion.displayName = `motion.${tag}`;
        return Motion;
      },
    },
  );
  return { m, AnimatePresence: ({ children }: { children: unknown }) => children };
});

import TokenGate from '@/components/token-gate';
import TripJoinHandshake from '@/components/trip-join-handshake';

const TOKEN = '0f8b6c2e-1d3a-4b5c-8d7e-9f0a1b2c3d4e';
const realLocation = window.location;
const replace = vi.fn();
let root: Root;
let host: HTMLDivElement;

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function type(id: string, value: string) {
  const input = q(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function logIn() {
  await act(async () =>
    root.render(
      <>
        <TokenGate />
        <TripJoinHandshake />
      </>,
    ),
  );
  expect(window.location.search).toBe('');
  expect(q('token-gate-invite')?.textContent).toContain('invited you');
  Object.defineProperty(window, 'location', {
    value: { ...realLocation, search: realLocation.search, href: realLocation.href, replace },
    configurable: true,
    writable: true,
  });
  await act(async () => q('landing-cta-login')!.click());
  act(() => {
    type('token-gate-username', 'powan');
    type('token-gate-password', 'correct horse');
  });
  await act(async () => q('token-gate-submit')!.click());
}

beforeEach(() => {
  h.calls.length = 0;
  replace.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', `/?trip=trip-xyz&invite=${TOKEN}`);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  vi.useRealTimers();
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, 'location', { value: realLocation, configurable: true, writable: true });
});

describe('TokenGate with an invite link (#641)', () => {
  it('strips the invite on mount and redeems it before joining', async () => {
    h.redeem = 'joined';
    await logIn();
    expect(h.calls).toEqual([`redeem:trip-xyz:${TOKEN}`, 'join:trip-xyz']);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(q('trip-join-dialog')).toBeNull();
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(TOKEN);
  });

  it('refused invite: says so, joins nothing, offers a way on', async () => {
    h.redeem = 'invalid';
    await logIn();
    expect(h.calls).toEqual([`redeem:trip-xyz:${TOKEN}`]);
    expect(replace).not.toHaveBeenCalled();
    expect(q('token-gate-error')?.textContent).toContain('expired, was already used');
    expect(q('token-gate-invite-retry')).toBeNull();
    expect(document.activeElement).toBe(q('token-gate-invite-continue'));
    expect(q('trip-join-dialog')).toBeNull();
  });

  it('already a member: the join goes ahead', async () => {
    h.redeem = 'already';
    await logIn();
    expect(h.calls).toEqual([`redeem:trip-xyz:${TOKEN}`, 'join:trip-xyz']);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('redeem that never answers: Not reached, Try again focused, no join', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    h.redeem = 'hang';
    await logIn();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.calls).toEqual([`redeem:trip-xyz:${TOKEN}`]);
    expect(replace).not.toHaveBeenCalled();
    expect(q('token-gate-error')?.textContent).toContain('could not reach the trip');
    expect(document.activeElement).toBe(q('token-gate-invite-retry'));
    expect(q('trip-join-dialog')).toBeNull();
  });
});
