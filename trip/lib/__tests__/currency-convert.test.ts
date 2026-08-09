// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { parseConversionQuery, convertCurrency } from '@/lib/currency-convert';

/**
 * S207 — currency-converter command logic. DETERMINISTIC: `fetch` is mocked (the same
 * injectable-fetchImpl pattern `fetchCurrencyRate` itself uses), no live network is
 * touched.
 *
 * What this proves:
 *   - `parseConversionQuery` (pure) recognizes "<amount> <FROM> to|in <TO>", is
 *     case-insensitive, and rejects anything outside the trip's 3 currencies or a
 *     malformed shape.
 *   - `convertCurrency` combines two fetchCurrencyRate results into a converted amount;
 *     USD is never fetched (rate 1, implicit).
 *   - D-189/S276: NPR short-circuits through fetchCurrencyRate's own UNSUPPORTED_CURRENCIES
 *     guard — a fresh NPR side with no cache resolves via the labeled static reference rate
 *     (`source:'reference'`, never `unavailable` anymore), WITHOUT this module issuing (or
 *     fetchCurrencyRate issuing) a doomed fetch for NPR.
 *   - offline/cache-miss on the non-NPR side also degrades to `unavailable`, never throws.
 */

const FRANKFURTER_JPY_FIXTURE = { amount: 1, base: 'USD', date: '2026-07-15', rates: { JPY: 155.32 } };

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe('parseConversionQuery (pure)', () => {
  it('parses "100 usd to jpy"', () => {
    expect(parseConversionQuery('100 usd to jpy')).toEqual({ amount: 100, from: 'USD', to: 'JPY' });
  });

  it('is case-insensitive and accepts "in" as well as "to"', () => {
    expect(parseConversionQuery('50.5 NPR in USD')).toEqual({ amount: 50.5, from: 'NPR', to: 'USD' });
    expect(parseConversionQuery('  20 jpy   TO   npr  ')).toEqual({ amount: 20, from: 'JPY', to: 'NPR' });
  });

  it('rejects a currency outside the trip set', () => {
    expect(parseConversionQuery('100 eur to jpy')).toBeNull();
    expect(parseConversionQuery('100 usd to eur')).toBeNull();
  });

  it('rejects malformed shapes', () => {
    expect(parseConversionQuery('usd to jpy')).toBeNull(); // no amount
    expect(parseConversionQuery('100 usd')).toBeNull(); // no target
    expect(parseConversionQuery('Japan')).toBeNull(); // an ordinary section query
    expect(parseConversionQuery('')).toBeNull();
  });
});

describe('convertCurrency (total; reuses fetchCurrencyRate, D-189-aware)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('USD → JPY: USD is never fetched (implicit rate 1), JPY comes from a live fetch', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return jsonResponse(FRANKFURTER_JPY_FIXTURE);
    };
    const result = await convertCurrency({ amount: 100, from: 'USD', to: 'JPY' }, fetchImpl);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.converted).toBeCloseTo(15532, 5);
      expect(result.stale).toBe(false);
      expect(result.source).toBe('live');
    }
    expect(calls).toBe(1); // only JPY was ever fetched
  });

  it('JPY → USD (inverse direction)', async () => {
    const fetchImpl = async () => jsonResponse(FRANKFURTER_JPY_FIXTURE);
    const result = await convertCurrency({ amount: 15532, from: 'JPY', to: 'USD' }, fetchImpl);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.converted).toBeCloseTo(100, 5);
  });

  it('D-189/S276: NPR with no prior cache resolves via the labeled static reference rate, without a doomed fetch', async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return jsonResponse(FRANKFURTER_JPY_FIXTURE);
    };
    const result = await convertCurrency({ amount: 100, from: 'USD', to: 'NPR' }, fetchImpl);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.source).toBe('reference');
      expect(result.converted).toBeGreaterThan(0);
    }
    expect(called).toBe(false);
  });

  it('NPR with a prior cached rate converts using the cached value, tagged stale + source live (pre-S276 cache shape)', async () => {
    localStorage.setItem(
      'nepal_japan_currency_rate_cache',
      JSON.stringify({ NPR: { currency: 'NPR', rate: 138.1, asOf: '2026-07-01', stale: false, fetchedAt: 'x' } }),
    );
    const result = await convertCurrency({ amount: 10, from: 'USD', to: 'NPR' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.converted).toBeCloseTo(1381, 5);
      expect(result.stale).toBe(true);
      expect(result.source).toBe('live');
    }
  });

  it('offline + no cache on a non-NPR side → unavailable, never throws', async () => {
    const fetchImpl = async () => {
      throw new Error('offline');
    };
    const result = await convertCurrency({ amount: 100, from: 'USD', to: 'JPY' }, fetchImpl);
    expect(result).toEqual({ status: 'unavailable', currency: 'JPY' });
  });
});
