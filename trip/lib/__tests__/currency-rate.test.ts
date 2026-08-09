// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { fetchCurrencyRate, parseFrankfurter, type CurrencyRateNow } from '@/lib/currency-rate';

/**
 * S188 — Frankfurter currency-rate client. DETERMINISTIC: `fetch` is mocked, the pure parser
 * takes fixed inputs, and the cache round-trips through jsdom localStorage. NO live network is
 * ever touched.
 *
 * What this proves:
 *   - `parseFrankfurter` maps a captured Frankfurter body → { rate, asOf }, rejects malformed/
 *     missing-symbol bodies (e.g. NPR absent from the response — the real-world risk this slice
 *     flags as a known risk).
 *   - `fetchCurrencyRate` write-throughs a fresh value to its own localStorage cache.
 *   - the offline path (fetch rejects / non-200 / missing symbol) returns the CACHED last-good
 *     value (stale:true).
 *   - no-cache + failed fetch → the typed `unavailable` state (never throws).
 *   - a corrupted cache entry (malformed JSON) degrades to an empty cache, not a crash.
 */

const FRANKFURTER_JPY_FIXTURE = { amount: 1, base: 'USD', date: '2026-07-15', rates: { JPY: 155.32 } };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('parseFrankfurter (pure)', () => {
  it('maps a captured Frankfurter body into a rate + as-of date', () => {
    const r = parseFrankfurter(FRANKFURTER_JPY_FIXTURE, 'JPY');
    expect(r).toEqual({ rate: 155.32, asOf: '2026-07-15' });
  });

  it('returns null when the requested symbol is absent (e.g. NPR not carried)', () => {
    expect(parseFrankfurter(FRANKFURTER_JPY_FIXTURE, 'NPR')).toBeNull();
  });

  it('returns null on a malformed body', () => {
    expect(parseFrankfurter({}, 'JPY')).toBeNull();
    expect(parseFrankfurter({ date: '2026-07-15' }, 'JPY')).toBeNull();
    expect(parseFrankfurter({ date: '2026-07-15', rates: {} }, 'JPY')).toBeNull();
    expect(parseFrankfurter({ date: '2026-07-15', rates: { JPY: 'not-a-number' } }, 'JPY')).toBeNull();
    expect(parseFrankfurter({ date: '2026-07-15', rates: { JPY: -5 } }, 'JPY')).toBeNull();
    expect(parseFrankfurter(null, 'JPY')).toBeNull();
  });
});

describe('fetchCurrencyRate (total; write-through + offline fallback)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('fresh: successful fetch write-throughs to the cache and returns stale:false', async () => {
    const fetchImpl = async () => jsonResponse(FRANKFURTER_JPY_FIXTURE);
    const result = await fetchCurrencyRate('JPY', fetchImpl);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.rate).toBe(155.32);
      expect(result.data.asOf).toBe('2026-07-15');
      expect(result.data.stale).toBe(false);
      expect(result.data.source).toBe('live');
    }
    const cached = JSON.parse(localStorage.getItem('nepal_japan_currency_rate_cache')!);
    expect(cached.JPY.rate).toBe(155.32);
  });

  it('stale: a failed fetch after a prior success returns the cached value tagged stale:true', async () => {
    await fetchCurrencyRate('JPY', async () => jsonResponse(FRANKFURTER_JPY_FIXTURE));
    const result = await fetchCurrencyRate('JPY', async () => {
      throw new Error('offline');
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.rate).toBe(155.32);
      expect(result.data.stale).toBe(true);
    }
  });

  it('absent: no cache + failed fetch → unavailable, never throws', async () => {
    const result = await fetchCurrencyRate('JPY', async () => {
      throw new Error('offline');
    });
    expect(result).toEqual({ status: 'unavailable', currency: 'JPY' });
  });

  it('absent: no cache + a 200 response missing the requested symbol → unavailable', async () => {
    // A currency NOT in the confirmed-unsupported set (so this still exercises the real
    // fetch → parse → "symbol absent" branch, not the NPR short-circuit below).
    const result = await fetchCurrencyRate('EUR', async () => jsonResponse(FRANKFURTER_JPY_FIXTURE));
    expect(result).toEqual({ status: 'unavailable', currency: 'EUR' });
  });

  it('NPR (confirmed unsupported by Frankfurter, live-checked): short-circuits to a labeled static reference rate WITHOUT ever calling fetch', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return jsonResponse(FRANKFURTER_JPY_FIXTURE);
    };
    const result = await fetchCurrencyRate('NPR', fetchImpl);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.source).toBe('reference');
      expect(result.data.rate).toBeGreaterThan(0);
      expect(result.data.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.data.stale).toBe(false);
    }
    // Never fires the doomed request — avoids the un-suppressible browser-level "Failed to
    // load resource" console entry a real 404 response would log on every Nepal-leg render.
    expect(called).toBe(false);
  });

  it('NPR: no cache and no fetch → still `ok` with the reference rate, never `unavailable` (S276/P6)', async () => {
    const result = await fetchCurrencyRate('NPR');
    expect(result.status).toBe('ok');
  });

  it('NPR: a prior cached value (from before it was known-unsupported) still surfaces, stale', async () => {
    const seeded: Record<string, CurrencyRateNow> = {
      NPR: { currency: 'NPR', rate: 138.1, asOf: '2026-07-01', stale: false, fetchedAt: 'x' },
    };
    localStorage.setItem('nepal_japan_currency_rate_cache', JSON.stringify(seeded));
    const result = await fetchCurrencyRate('NPR');
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.rate).toBe(138.1);
      expect(result.data.stale).toBe(true);
    }
  });

  it('absent: a non-200 response with no cache → unavailable, never throws', async () => {
    const result = await fetchCurrencyRate('JPY', async () => jsonResponse({}, false, 500));
    expect(result).toEqual({ status: 'unavailable', currency: 'JPY' });
  });

  it('malformed: a corrupted cache entry degrades to an empty cache (unavailable), not a crash', async () => {
    localStorage.setItem('nepal_japan_currency_rate_cache', '{not valid json');
    const result = await fetchCurrencyRate('JPY', async () => {
      throw new Error('offline');
    });
    expect(result).toEqual({ status: 'unavailable', currency: 'JPY' });
  });

  it('per-currency: caching JPY does not evict a previously cached NPR entry', async () => {
    // Seed an NPR cache entry directly (as if a prior successful fetch happened).
    const seeded: Record<string, CurrencyRateNow> = {
      NPR: { currency: 'NPR', rate: 138.1, asOf: '2026-07-14', stale: false, fetchedAt: 'x' },
    };
    localStorage.setItem('nepal_japan_currency_rate_cache', JSON.stringify(seeded));

    await fetchCurrencyRate('JPY', async () => jsonResponse(FRANKFURTER_JPY_FIXTURE));

    const map = JSON.parse(localStorage.getItem('nepal_japan_currency_rate_cache')!);
    expect(map.NPR.rate).toBe(138.1);
    expect(map.JPY.rate).toBe(155.32);
  });
});
