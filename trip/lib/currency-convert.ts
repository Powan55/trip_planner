// Currency-converter command logic — a thin layer over
// `fetchCurrencyRate` (lib/currency-rate.ts). NO new fetch path, NO new cache: every
// rate lookup here goes through `fetchCurrencyRate`, which already owns the
// Frankfurter fetch, the localStorage cache, and the NPR short-circuit
// (`UNSUPPORTED_CURRENCIES`) — this file only combines two of its results into a
// converted amount.

import { fetchCurrencyRate, type CurrencyRateResult } from './currency-rate';

/** The trip's three currencies (: NPR is a confirmed Frankfurter gap, handled via
 * fetchCurrencyRate's own cache/unavailable short-circuit — never fetched here directly). */
export const CONVERTER_CURRENCIES = ['USD', 'JPY', 'NPR'] as const;

export interface ParsedConversionQuery {
  amount: number;
  from: string;
  to: string;
}

// "100 usd to jpy" / "50.5 NPR in USD" — amount, a 3-letter code, "to"/"in", a 3-letter code.
const CONVERSION_QUERY_RE = /^(\d+(?:\.\d+)?)\s*([a-z]{3})\s+(?:to|in)\s+([a-z]{3})$/i;

/** Pure. Null when the string isn't that shape, or either code isn't one of the
 * trip's supported currencies — never throws. */
export function parseConversionQuery(raw: string): ParsedConversionQuery | null {
  const m = raw.trim().match(CONVERSION_QUERY_RE);
  if (!m) return null;
  const amount = Number(m[1]);
  if (!Number.isFinite(amount)) return null;
  const from = m[2].toUpperCase();
  const to = m[3].toUpperCase();
  if (!(CONVERTER_CURRENCIES as readonly string[]).includes(from)) return null;
  if (!(CONVERTER_CURRENCIES as readonly string[]).includes(to)) return null;
  return { amount, from, to };
}

export type ConversionResult =
  | { status: 'ok'; converted: number; asOf: string; stale: boolean }
  | { status: 'unavailable'; currency: string };

/** Units of `currency` per 1 USD, sourced from `fetchCurrencyRate`. USD itself is always
 * 1 (Frankfurter's own base) and is never fetched. */
async function usdRateOf(
  currency: string,
  fetchImpl: typeof fetch,
): Promise<{ rate: number; asOf: string; stale: boolean } | 'unavailable'> {
  if (currency === 'USD') {
    return { rate: 1, asOf: new Date().toISOString().slice(0, 10), stale: false };
  }
  const result: CurrencyRateResult = await fetchCurrencyRate(currency, fetchImpl);
  if (result.status === 'unavailable') return 'unavailable';
  return { rate: result.data.rate, asOf: result.data.asOf, stale: result.data.stale };
}

/**
 * Converts `parsed.amount` from `parsed.from` to `parsed.to`, reusing `fetchCurrencyRate`
 * for each side's USD-anchored rate. Total — never throws. `unavailable` names whichever
 * side actually has no rate (fresh or cached) — e.g. NPR with no prior cache.
 */
export async function convertCurrency(
  parsed: ParsedConversionQuery,
  fetchImpl: typeof fetch = fetch,
): Promise<ConversionResult> {
  const [fromRate, toRate] = await Promise.all([
    usdRateOf(parsed.from, fetchImpl),
    usdRateOf(parsed.to, fetchImpl),
  ]);
  if (fromRate === 'unavailable') return { status: 'unavailable', currency: parsed.from };
  if (toRate === 'unavailable') return { status: 'unavailable', currency: parsed.to };
  const converted = (parsed.amount / fromRate.rate) * toRate.rate;
  return { status: 'ok', converted, asOf: toRate.asOf, stale: fromRate.stale || toRate.stale };
}
