// Frankfurter currency-rate client for the Travel Mode Essentials card.
//
// FREE-TOOLS-ONLY: api.frankfurter.dev is a free, keyless, no-signup ECB-reference-rate
// mirror — no API key, no card, no account (the v5-plan-approved choice). A plain browser
// `fetch` DIRECTLY to the host — NO route handler, NO server.
//
// This is a DISPLAY-ONLY live rate for the Essentials card, deliberately separate from
// `core/budget/model.ts`'s manual, user-overridable rates — "zero rate APIs" line in
// that module governs the BUDGET specifically and is unchanged/untouched here.
//
// NO new gateway key — the cache lives
// under its OWN localStorage key, read/written directly here (mirrors `weatherCache`'s SHAPE —
// module-owned JSON map, SSR-safe, try/catch, never throws — without adding a STORAGE_KEYS
// registry entry). See the for why this is a deliberate, flagged exception to
// "one registry" convention rather than a silent one.
//
// Offline / failure = graceful: on fetch failure OR when Frankfurter
// doesn't carry the requested symbol (its ECB-sourced list is ~30 currencies; NPR is NOT
// confirmed among them, JPY is — see) this returns the cached last-good value
// (stale:true) or an honest `unavailable` state — never a spinner that hangs, never a thrown
// error. `fetchCurrencyRate` is TOTAL: it resolves, it never rejects.

const CACHE_KEY = 'nepal_japan_currency_rate_cache';
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest';

/**
 * Ceiling on the Frankfurter request. Without it a stalled connection (one that neither routes
 * nor rejects) never settles, and the total contract above degrades into a permanent loading
 * state rather than the honest stale/unavailable it promises. 8s matches the background-fetch
 * precedent already in this repo: `lib/place-resolve.ts:47` (`timeoutMs = 8000`, applied at
 * `:60`) and `lib/trips-remote.ts:180`. Deliberately NOT the 45s chat ceiling — a human
 * waiting on an LLM is a different class, as that constant's own comment says.
 */
const RATE_TIMEOUT_MS = 8_000;

/** A live (or cached) USD-anchored rate for one currency, as the Essentials card renders it. */
export interface CurrencyRateNow {
  currency: string; // e.g. 'NPR' | 'JPY'
  /** Units of `currency` per 1 USD. */
  rate: number;
  /** ISO date the rate is as-of (Frankfurter's `date` field, rendered verbatim). */
  asOf: string;
  /** True when this value came from the offline cache, not a fresh fetch. */
  stale: boolean;
  /** ISO timestamp the value was fetched (for the "as of" indicator). */
  fetchedAt: string;
  /**
   * `'reference'` for a currency Frankfurter doesn't carry (a hand-set static
   * figure, never a live quote — see `STATIC_REFERENCE_RATES`); `'live'` for an actual
   * Frankfurter fetch. Optional/absent on values written before this field existed (older
   * cached entries) — the renderer treats a missing `source` as `'live'`, matching prior
   * behavior exactly.
   */
  source?: 'live' | 'reference';
}

export type CurrencyRateResult =
  | { status: 'ok'; data: CurrencyRateNow }
  | { status: 'unavailable'; currency: string };

// ── Cache (module-owned localStorage map, mirrors weatherCache's get/set shape) ──────────────

function readCacheMap(): Record<string, CurrencyRateNow> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CurrencyRateNow>) : {};
  } catch {
    return {};
  }
}

function writeCacheEntry(currency: string, value: CurrencyRateNow): void {
  if (typeof window === 'undefined') return;
  try {
    const map = readCacheMap();
    map[currency] = value;
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled storage — degrade quietly */
  }
}

function readCache(currency: string): CurrencyRateNow | null {
  const entry = readCacheMap()[currency];
  return entry ?? null;
}

// ── Pure parse ────────────────────────────────────────────────────────────────────

/** Parse a Frankfurter `/v1/latest?symbols=<currency>` body (PURE). Null on any malformed
 * shape or a missing/non-positive rate for the requested symbol — total, never throws. */
export function parseFrankfurter(
  json: unknown,
  currency: string,
): { rate: number; asOf: string } | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as { date?: unknown; rates?: unknown };
  if (typeof body.date !== 'string' || !body.date) return null;
  const rates = body.rates;
  if (!rates || typeof rates !== 'object') return null;
  const rate = (rates as Record<string, unknown>)[currency];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return { rate, asOf: body.date };
}

// ── The client (impure: fetch + localStorage I/O, but TOTAL — never throws) ─────────────────

/**
 * Currencies CONFIRMED, live, NOT to exist in Frankfurter's ECB-sourced rate table (checked
 * 2026-07-16 against the real API from this codebase — see the): `NPR` returns a
 * plain HTTP 404 (`{"message":"not found"}`) — Nepalese Rupee isn't one of the ECB reference
 * currencies Frankfurter mirrors. `JPY` IS present and works.
 *
 * A non-2xx `fetch()` response logs a browser-level "Failed to load resource" console entry
 * that NO application code can suppress (it comes from the network stack, not the page) — so a
 * known-always-404 symbol must never be fetched at all, or every Nepal-leg day would print a
 * console error on every load. `fetchCurrencyRate` short-circuits to the SAME honest
 * cached/`unavailable` outcome a failed fetch would have produced, without ever issuing the
 * doomed request.
 */
const UNSUPPORTED_CURRENCIES = new Set(['NPR']);

/**
 * hand-set static reference rates for currencies Frankfurter doesn't carry, so the
 * Essentials currency panel isn't dead for the whole Nepal leg (10/10 days were `unavailable`
 * before this). NOT a live feed — free-tools-only stays intact, no paid FX API added, no
 * fetch issued (see `UNSUPPORTED_CURRENCIES`'s doc comment for why NPR must never be requested).
 * `fetchCurrencyRate` flags every value from here `source: 'reference'` so the UI can render it
 * distinctly ("≈ reference rate") and NEVER present it as a live quote.
 *
 * `rate`/`asOf` are a hand-set calibration knob, not derived from anything live. The peg to INR
 * holds the NPR/INR cross steady; it does NOT hold NPR/USD steady, and the previous note here
 * claiming a 133-136/USD band was wrong on its own terms — over the six months to 2026-08-15 the
 * real rate ran 145.03 (2026-02-15) to 154.94 (2026-05-21). Set 152.7 as-of 2026-08-15, checked
 * that day against three independent sources that agreed: NRB's own open-market table (buy
 * 152.39 / sell 152.99), Wise's mid-market rate (152.7) and open.er-api.com (152.85). Mid-market
 * is the right figure here because the panel labels it "≈ reference rate" rather than a quote.
 *
 * Refresh both fields when the real rate visibly drifts; there is no automated way to know it
 * has (that's the whole reason NPR needs a reference value instead of a feed), so re-check by
 * hand before a release rather than trusting the band this comment happens to record.
 */
const STATIC_REFERENCE_RATES: Record<string, { rate: number; asOf: string }> = {
  NPR: { rate: 152.7, asOf: '2026-08-15' },
};

/**
 * Load the live USD→`currency` rate. Total + never-throws:
 * 0. A currency Frankfurter is confirmed not to carry (`UNSUPPORTED_CURRENCIES`) → skip the
 * fetch entirely. A cached live-ish value still wins if present (stale:true); else fall
 * back to a hand-set `STATIC_REFERENCE_RATES` entry (`source:'reference'`) if one exists;
 * else `unavailable`.
 * 1. Fetch OK + parses + carries the symbol → write-through the fresh value, return `ok`.
 * 2. Fetch fails / non-200 / unparsable / symbol unexpectedly absent → return the cached
 * last-good value if any (stale:true), else `unavailable`.
 *
 * `fetchImpl` is injectable so unit tests drive the fetch deterministically; production passes
 * the global `fetch`.
 */
export async function fetchCurrencyRate(
  currency: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CurrencyRateResult> {
  // Frankfurter's base is always USD, so USD→USD is an identity — never worth a network call
  // (and never worth a cache read/write either). Checked BEFORE `UNSUPPORTED_CURRENCIES` since
  // that branch still does a cache lookup.
  if (currency === 'USD') {
    return {
      status: 'ok',
      data: {
        currency: 'USD',
        rate: 1,
        asOf: new Date().toISOString().slice(0, 10),
        stale: false,
        fetchedAt: new Date().toISOString(),
        source: 'live',
      },
    };
  }
  if (UNSUPPORTED_CURRENCIES.has(currency)) {
    const cached = readCache(currency);
    if (cached) return { status: 'ok', data: { ...cached, stale: true } };
    const reference = STATIC_REFERENCE_RATES[currency];
    if (reference) {
      return {
        status: 'ok',
        data: {
          currency,
          rate: reference.rate,
          asOf: reference.asOf,
          stale: false,
          fetchedAt: new Date().toISOString(),
          source: 'reference',
        },
      };
    }
    return { status: 'unavailable', currency };
  }
  try {
    const url = `${FRANKFURTER_URL}?base=USD&symbols=${encodeURIComponent(currency)}`;
    // Signal built PER CALL — an AbortSignal.timeout is single-use, so a module-scope one would
    // already be expired by the second load. It also cancels the socket and stays attached to the
    // response body, so the `await res.json()` below is bounded by the same ceiling.
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(RATE_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Frankfurter HTTP ${res.status}`);
    const json = await res.json();
    const parsed = parseFrankfurter(json, currency);
    if (!parsed) throw new Error('Frankfurter body missing the requested symbol');
    const value: CurrencyRateNow = {
      currency,
      rate: parsed.rate,
      asOf: parsed.asOf,
      stale: false,
      fetchedAt: new Date().toISOString(),
      source: 'live',
    };
    writeCacheEntry(currency, value);
    return { status: 'ok', data: value };
  } catch {
    const cached = readCache(currency);
    if (cached) return { status: 'ok', data: { ...cached, stale: true } };
    return { status: 'unavailable', currency };
  }
}
