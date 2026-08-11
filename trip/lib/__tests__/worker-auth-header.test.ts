// @vitest-environment jsdom
//
// #10 — the Worker `Authorization` header, both halves:
//
//   A. `workerAuthHeader()` itself (`lib/worker-auth.ts`) — the ONE copy of "only when a token
//      exists". Unconfigured must produce `{}` WITHOUT even importing the firebase seam, because
//      that gate is what keeps the dormant bundle (and every browser test) firebase-free.
//   B. `resolvePlaceLink` actually spreads it onto the request. Proven twice, deliberately: once
//      UNMOCKED against the real vitest environment (no firebase env ⇒ no header, which is the
//      state every other spec in this repo runs in), and once with a session mocked in.
//
// The concierge POST's half of B lives in `use-concierge-chat.test.ts`, next to the rest of that
// hook's request assertions.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const gate = vi.hoisted(() => ({ on: false }));
const seam = vi.hoisted(() => ({ token: null as string | null, calls: 0, throws: false }));

vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: {},
  isRemoteConfigured: () => gate.on,
  isTripRemoteConfigured: () => gate.on,
  getTripId: () => 'trip-abc',
}));

vi.mock('@/lib/itinerary-remote', () => ({
  getAuthIdToken: async () => {
    seam.calls += 1;
    if (seam.throws) throw new Error('seam exploded');
    return seam.token;
  },
}));

import { workerAuthHeader } from '@/lib/worker-auth';
import { resolvePlaceLink } from '@/lib/place-resolve';

const ORIGIN = 'https://worker.example.dev';
const PLACE_URL = 'https://maps.app.goo.gl/abc';

/** A fetch double that records the init it was handed. */
function recordingFetch(): { calls: RequestInit[]; impl: typeof fetch } {
  const calls: RequestInit[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return { ok: true, status: 200, json: async () => ({ ok: true, name: 'Somewhere' }) };
  }) as unknown as typeof fetch;
  return { calls, impl };
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  gate.on = false;
  seam.token = null;
  seam.calls = 0;
  seam.throws = false;
  localStorage.clear();
});

describe('workerAuthHeader — only when a token exists (#10)', () => {
  it('is empty on an unconfigured build, WITHOUT reaching the firebase seam at all', async () => {
    expect(await workerAuthHeader()).toEqual({});
    // The zero is the point: reaching the seam would mean the dormant build pulls firebase.
    expect(seam.calls).toBe(0);
  });

  it('carries the bearer token when there is a session', async () => {
    gate.on = true;
    seam.token = 'id-token-xyz';
    expect(await workerAuthHeader()).toEqual({ authorization: 'Bearer id-token-xyz' });
    expect(seam.calls).toBe(1);
  });

  it('is empty when configured but no token comes back (never a "Bearer null")', async () => {
    gate.on = true;
    seam.token = null;
    expect(await workerAuthHeader()).toEqual({});
    expect(seam.calls).toBe(1);
  });

  it('is empty — never a rejection — when the seam itself throws', async () => {
    gate.on = true;
    seam.throws = true;
    await expect(workerAuthHeader()).resolves.toEqual({});
  });
});

describe('resolvePlaceLink attaches it beside X-Trip-Token (#10)', () => {
  it('sends NO authorization header with no session, and still sends the trip token', async () => {
    const { calls, impl } = recordingFetch();
    await resolvePlaceLink(PLACE_URL, { fetchImpl: impl, origin: ORIGIN });
    expect(calls).toHaveLength(1);
    const headers = headersOf(calls[0]);
    expect('authorization' in headers).toBe(false);
    expect(headers['X-Trip-Token']).toEqual(expect.any(String));
  });

  it('sends the bearer token beside the trip token once there is a session', async () => {
    gate.on = true;
    seam.token = 'id-token-xyz';
    const { calls, impl } = recordingFetch();
    await resolvePlaceLink(PLACE_URL, { fetchImpl: impl, origin: ORIGIN });
    const headers = headersOf(calls[0]);
    expect(headers.authorization).toBe('Bearer id-token-xyz');
    expect(headers['X-Trip-Token']).toEqual(expect.any(String));
  });
});
