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
 * Load the live USD→`currency` rate. Total + never-throws:
 * 0. A currency Frankfurter is confirmed not to carry (`UNSUPPORTED_CURRENCIES`) → skip the
 * fetch entirely, return the cached last-good value if any (stale:true) else `unavailable`.
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
  if (UNSUPPORTED_CURRENCIES.has(currency)) {
    const cached = readCache(currency);
    return cached ? { status: 'ok', data: { ...cached, stale: true } } : { status: 'unavailable', currency };
  }
  try {
    const url = `${FRANKFURTER_URL}?base=USD&symbols=${encodeURIComponent(currency)}`;
    const res = await fetchImpl(url);
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
    };
    writeCacheEntry(currency, value);
    return { status: 'ok', data: value };
  } catch {
    const cached = readCache(currency);
    if (cached) return { status: 'ok', data: { ...cached, stale: true } };
    return { status: 'unavailable', currency };
  }
}
