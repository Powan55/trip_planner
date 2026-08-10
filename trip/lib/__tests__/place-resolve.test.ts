// @vitest-environment jsdom
//
// S284 — the client place-link resolver (`lib/place-resolve.ts`). The centerpiece guarantee: it
// NEVER throws and degrades to `null` on every failure mode (unconfigured Worker, non-200, thrown
// fetch, bad JSON, `ok:false`), so the import sheet always falls back to manual entry — which is why
// slice S-b ships before the Worker's /resolve route (S-a). Also proves the happy path returns hints.

import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePlaceLink } from '@/lib/place-resolve';

const ORIGIN = 'https://worker.example.dev';
const URL = 'https://maps.app.goo.gl/abc';

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('resolvePlaceLink (S284) — never throws, degrades to null', () => {
  beforeEach(() => localStorage.clear());

  it('returns null (no fetch) when the Worker origin is unconfigured', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return jsonRes({ ok: true });
    }) as unknown as typeof fetch;
    // Default origin = CONCIERGE_URL, which is '' in the test env (dormant build).
    expect(await resolvePlaceLink(URL, { fetchImpl })).toBeNull();
    expect(called).toBe(false);
  });

  it('returns hints on a 200 { ok:true } response', async () => {
    const fetchImpl = (async () =>
      jsonRes({ ok: true, name: 'Fushimi Inari', lat: 34.9671, lng: 135.7727, finalUrl: 'https://www.google.com/maps/place/Fushimi' })) as unknown as typeof fetch;
    const hints = await resolvePlaceLink(URL, { fetchImpl, origin: ORIGIN });
    expect(hints).toEqual({
      name: 'Fushimi Inari',
      lat: 34.9671,
      lng: 135.7727,
      finalUrl: 'https://www.google.com/maps/place/Fushimi',
    });
  });

  it('returns null on a non-200 response (manual fallback)', async () => {
    const fetchImpl = (async () => jsonRes({}, false, 404)) as unknown as typeof fetch;
    expect(await resolvePlaceLink(URL, { fetchImpl, origin: ORIGIN })).toBeNull();
  });

  it('returns null when { ok:false } comes back', async () => {
    const fetchImpl = (async () => jsonRes({ ok: false, reason: 'blocked-host' })) as unknown as typeof fetch;
    expect(await resolvePlaceLink(URL, { fetchImpl, origin: ORIGIN })).toBeNull();
  });

  it('returns null (never throws) when fetch rejects', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(resolvePlaceLink(URL, { fetchImpl, origin: ORIGIN })).resolves.toBeNull();
  });

  it('returns null (never throws) when the body is not JSON', async () => {
    const fetchImpl = (async () =>
      ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })) as unknown as typeof fetch;
    await expect(resolvePlaceLink(URL, { fetchImpl, origin: ORIGIN })).resolves.toBeNull();
  });
});
