import { describe, it, expect } from 'vitest';

/**
 * S101 — pure money math (D-016/D-099). `core/budget/model.ts` is framework-free; these tests
 * pin the leg→currency map, local↔home conversion, the per-leg + per-category rollup, the grand
 * total in the home currency, and TOTALITY (bad / NaN / negative / corrupt input → safe number,
 * never a throw). The rollup's S102 seam (an optional `spent` input in the SAME shape) is also
 * proven so expense logging can subtract without a reshape.
 */

import {
  legCurrency,
  convert,
  legLocalToHome,
  ratePerUsd,
  safeAmount,
  safeRate,
  rollUp,
  normalizeModel,
  normalizeCurrency,
  normalizeRates,
  formatMoney,
  currencySymbol,
  DEFAULT_BUDGET,
  SEED_RATES,
  CURRENCIES,
  type BudgetModel,
} from '@/core/budget/model';

const RATES = { NPR: 138, JPY: 155 };

function model(over: Partial<BudgetModel> = {}): BudgetModel {
  return {
    version: 1,
    homeCurrency: 'USD',
    rates: { ...RATES },
    legBudgets: { nepal: 0, japan: 0 },
    categoryBudgets: {},
    ...over,
  };
}

describe('legCurrency — leg → fixed local currency (D-012)', () => {
  it('nepal → NPR, japan → JPY', () => {
    expect(legCurrency('nepal')).toBe('NPR');
    expect(legCurrency('japan')).toBe('JPY');
  });

  // D-307. `Leg` is a bare `string` and a leg id arrives from stored/imported data, so these key
  // names reach the lookup. `LEG_CURRENCY[leg] ?? 'USD'` returned Object.prototype's FUNCTION for
  // them — never undefined, so the fallback never fired — and a function is not any of 'USD' /
  // 'NPR' / 'JPY', so `ratePerUsd`'s chain fell through to the JPY rate. Silent wrong money.
  it('a prototype key name is NOT a leg: it falls back to USD instead of returning a function', () => {
    for (const key of ['toString', 'valueOf', 'constructor', 'hasOwnProperty']) {
      expect(legCurrency(key)).toBe('USD');
      expect(typeof legCurrency(key)).toBe('string');
    }
  });
});

describe('safeAmount / safeRate — TOTAL input guards', () => {
  it('safeAmount coerces bad/NaN/negative/Infinity to 0, keeps valid numbers', () => {
    expect(safeAmount(1200)).toBe(1200);
    expect(safeAmount('1200')).toBe(1200);
    expect(safeAmount('')).toBe(0);
    expect(safeAmount('abc')).toBe(0);
    expect(safeAmount(NaN)).toBe(0);
    expect(safeAmount(-50)).toBe(0);
    expect(safeAmount(Infinity)).toBe(0);
    expect(safeAmount(null)).toBe(0);
    expect(safeAmount(undefined)).toBe(0);
  });

  it('safeRate requires finite positive, else falls back to the seed', () => {
    expect(safeRate(150, 138)).toBe(150);
    expect(safeRate('150', 138)).toBe(150);
    expect(safeRate(0, 138)).toBe(138); // 0 rate would divide-by-zero
    expect(safeRate(-1, 138)).toBe(138);
    expect(safeRate(NaN, 138)).toBe(138);
    expect(safeRate('', 138)).toBe(138);
    expect(safeRate(Infinity, 138)).toBe(138);
  });
});

describe('ratePerUsd — USD is the anchor (1)', () => {
  it('USD is 1; NPR/JPY come from the model; a bad rate falls back to seed', () => {
    expect(ratePerUsd(RATES, 'USD')).toBe(1);
    expect(ratePerUsd(RATES, 'NPR')).toBe(138);
    expect(ratePerUsd(RATES, 'JPY')).toBe(155);
    expect(ratePerUsd({ NPR: 0, JPY: -1 }, 'NPR')).toBe(SEED_RATES.NPR);
    expect(ratePerUsd({ NPR: 0, JPY: -1 }, 'JPY')).toBe(SEED_RATES.JPY);
  });
});

describe('convert — via the USD anchor, TOTAL', () => {
  it('same currency is identity', () => {
    expect(convert(1200, 'USD', 'USD', RATES)).toBe(1200);
    expect(convert(50000, 'NPR', 'NPR', RATES)).toBe(50000);
  });

  it('local → USD divides by the rate', () => {
    expect(convert(13800, 'NPR', 'USD', RATES)).toBeCloseTo(100, 6); // 13800/138
    expect(convert(15500, 'JPY', 'USD', RATES)).toBeCloseTo(100, 6); // 15500/155
  });

  it('USD → local multiplies by the rate', () => {
    expect(convert(100, 'USD', 'NPR', RATES)).toBeCloseTo(13800, 6);
    expect(convert(100, 'USD', 'JPY', RATES)).toBeCloseTo(15500, 6);
  });

  it('cross local → local routes through USD (NPR → JPY)', () => {
    // 13800 NPR = 100 USD = 15500 JPY.
    expect(convert(13800, 'NPR', 'JPY', RATES)).toBeCloseTo(15500, 6);
  });

  it('is total on garbage input (NaN amount → 0, no throw)', () => {
    expect(() => convert('oops', 'NPR', 'USD', RATES)).not.toThrow();
    expect(convert('oops', 'NPR', 'USD', RATES)).toBe(0);
    expect(convert(-500, 'NPR', 'USD', RATES)).toBe(0);
  });

  it('legLocalToHome maps a leg amount into the display currency', () => {
    expect(legLocalToHome(13800, 'nepal', 'USD', RATES)).toBeCloseTo(100, 6);
    expect(legLocalToHome(15500, 'japan', 'USD', RATES)).toBeCloseTo(100, 6);
  });
});

describe('rollUp — per-leg + per-category + grand total in home currency', () => {
  it('per-leg budgets convert to the home currency and sum into the grand total (USD home)', () => {
    const m = model({ legBudgets: { nepal: 13800, japan: 31000 } });
    const roll = rollUp(m);
    expect(roll.home).toBe('USD');
    // Nepal 13800 NPR = 100 USD; Japan 31000 JPY = 200 USD.
    const nepal = roll.legs.find((l) => l.leg === 'nepal')!;
    const japan = roll.legs.find((l) => l.leg === 'japan')!;
    expect(nepal.currency).toBe('NPR');
    expect(nepal.budgetLocal).toBe(13800);
    expect(nepal.budgetHome).toBeCloseTo(100, 6);
    expect(japan.currency).toBe('JPY');
    expect(japan.budgetHome).toBeCloseTo(200, 6);
    expect(roll.totalBudgetHome).toBeCloseTo(300, 6);
  });

  it('toggling the home currency re-expresses the grand total, non-destructively', () => {
    const base = model({ legBudgets: { nepal: 13800, japan: 31000 } });
    const usd = rollUp(base).totalBudgetHome; // 300 USD
    const npr = rollUp({ ...base, homeCurrency: 'NPR' }).totalBudgetHome;
    const jpy = rollUp({ ...base, homeCurrency: 'JPY' }).totalBudgetHome;
    // 300 USD = 41400 NPR = 46500 JPY. Local amounts on the model are UNCHANGED (presentation-only).
    expect(usd).toBeCloseTo(300, 6);
    expect(npr).toBeCloseTo(41400, 6);
    expect(jpy).toBeCloseTo(46500, 6);
    expect(base.legBudgets).toEqual({ nepal: 13800, japan: 31000 });
  });

  it('only categories with a set budget (or spend) appear in the rollup', () => {
    const m = model({
      legBudgets: { nepal: 13800, japan: 0 },
      categoryBudgets: { nepal: { food: 2760, hotel: 5520 } },
    });
    const roll = rollUp(m);
    const nepal = roll.legs.find((l) => l.leg === 'nepal')!;
    expect(nepal.categories.map((c) => c.category).sort()).toEqual(['food', 'hotel']);
    const food = nepal.categories.find((c) => c.category === 'food')!;
    expect(food.budgetLocal).toBe(2760);
    expect(food.budgetHome).toBeCloseTo(20, 6); // 2760/138
    const japan = roll.legs.find((l) => l.leg === 'japan')!;
    expect(japan.categories).toEqual([]);
  });

  it('S102 SEAM — an optional `spent` input (same shape) yields remaining = budget − spent', () => {
    const m = model({ legBudgets: { nepal: 13800, japan: 31000 } });
    const roll = rollUp(m, { byLeg: { nepal: 6900 } }); // spent 50 USD on Nepal
    const nepal = roll.legs.find((l) => l.leg === 'nepal')!;
    expect(nepal.spentLocal).toBe(6900);
    expect(nepal.spentHome).toBeCloseTo(50, 6);
    expect(nepal.remainingLocal).toBe(6900); // 13800 − 6900
    expect(nepal.remainingHome).toBeCloseTo(50, 6);
    // Grand total spend rolls up too.
    expect(roll.totalSpentHome).toBeCloseTo(50, 6);
    expect(roll.totalRemainingHome).toBeCloseTo(250, 6); // 300 − 50
  });

  it('with no spend (S101 state) remaining === budget', () => {
    const m = model({ legBudgets: { nepal: 13800, japan: 31000 } });
    const roll = rollUp(m);
    expect(roll.totalSpentHome).toBe(0);
    expect(roll.totalRemainingHome).toBeCloseTo(roll.totalBudgetHome, 6);
    for (const leg of roll.legs) {
      expect(leg.spentLocal).toBe(0);
      expect(leg.remainingLocal).toBe(leg.budgetLocal);
    }
  });

  it('is TOTAL on a wholly corrupt model (never throws; every field a safe number)', () => {
    expect(() => rollUp({} as unknown as BudgetModel)).not.toThrow();
    // A garbage model still produces a well-formed rollup with zeros and USD home.
    const roll = rollUp({
      homeCurrency: 'bogus',
      rates: { NPR: 0, JPY: 'x' },
      legBudgets: { nepal: 'x', japan: NaN },
      categoryBudgets: { nepal: { food: -3 } },
    } as unknown as BudgetModel);
    expect(roll.home).toBe('USD');
    expect(Number.isFinite(roll.totalBudgetHome)).toBe(true);
    expect(roll.totalBudgetHome).toBe(0);
    for (const leg of roll.legs) expect(leg.categories).toEqual([]);
  });
});

describe('normalizeModel / normalizeCurrency / normalizeRates — corrupt slot → valid model', () => {
  it('a non-object → DEFAULT_BUDGET (fresh-visitor seed)', () => {
    expect(normalizeModel(null)).toEqual(DEFAULT_BUDGET);
    expect(normalizeModel('nope')).toEqual(DEFAULT_BUDGET);
    expect(normalizeModel(undefined)).toEqual(DEFAULT_BUDGET);
  });

  it('keeps good fields, seed-defaults the rest, and drops non-positive category budgets', () => {
    const cleaned = normalizeModel({
      homeCurrency: 'JPY',
      rates: { NPR: 140 }, // JPY missing → seed
      legBudgets: { nepal: 13800, japan: -5 }, // negative → 0
      categoryBudgets: { nepal: { food: 2760, hotel: 0, nightlife: -1 }, bogus: { x: 1 } },
    } as unknown as BudgetModel);
    expect(cleaned.homeCurrency).toBe('JPY');
    expect(cleaned.rates).toEqual({ NPR: 140, JPY: SEED_RATES.JPY });
    expect(cleaned.legBudgets).toEqual({ nepal: 13800, japan: 0 });
    expect(cleaned.categoryBudgets.nepal).toEqual({ food: 2760 }); // 0/negative dropped
    expect(cleaned.categoryBudgets).not.toHaveProperty('bogus'); // unknown leg ignored
  });

  it('normalizeCurrency only accepts the three codes', () => {
    for (const c of CURRENCIES) expect(normalizeCurrency(c)).toBe(c);
    expect(normalizeCurrency('EUR')).toBe('USD');
    expect(normalizeCurrency(42)).toBe('USD');
  });

  it('normalizeRates seed-defaults each side independently', () => {
    expect(normalizeRates({ NPR: 140, JPY: 150 })).toEqual({ NPR: 140, JPY: 150 });
    expect(normalizeRates({ NPR: 0 })).toEqual({ NPR: SEED_RATES.NPR, JPY: SEED_RATES.JPY });
    expect(normalizeRates(null)).toEqual({ ...SEED_RATES });
  });
});

describe('formatMoney / currencySymbol — grouped, no NaN ever', () => {
  it('symbols per currency', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('NPR')).toBe('Rs');
    expect(currencySymbol('JPY')).toBe('¥');
  });

  it('groups thousands and rounds to whole units', () => {
    expect(formatMoney(1200, 'USD')).toBe('$1,200');
    expect(formatMoney(165600, 'NPR')).toBe('Rs 165,600');
    expect(formatMoney(310000, 'JPY')).toBe('¥310,000');
    expect(formatMoney(99.6, 'USD')).toBe('$100');
  });

  it('a bad amount renders the symbol + 0, never NaN', () => {
    expect(formatMoney(NaN, 'USD')).toBe('$0');
    expect(formatMoney('oops', 'JPY')).toBe('¥0');
    expect(formatMoney(-5, 'USD')).toBe('$0');
  });
});

describe('constants — the canonical shape stays in sync', () => {
  // D-266/S363C: this block used to carry a `toEqual` here comparing `BUDGET_CATEGORIES` against a
  // hardcoded literal copy of itself, named "...is exactly the 10 ItineraryCategory values (D-012)".
  // It had NO tie to `ItineraryCategory` at all — types are erased at runtime, so no Vitest
  // assertion ever could check that — and it was observed GREEN while the union carried an 11th
  // member. Its name claimed a guarantee it structurally could not provide (D-265). The real
  // guarantee now lives as a compile-time `Exclude` guard beside `BUDGET_CATEGORIES` itself
  // (core/budget/model.ts) — `npx tsc --noEmit` goes red and names the offending category on
  // divergence in either direction, which this runtime comparison could never do.

  it('DEFAULT_BUDGET is a valid, empty, USD-home model with seeded rates', () => {
    expect(DEFAULT_BUDGET.homeCurrency).toBe('USD');
    expect(DEFAULT_BUDGET.rates).toEqual(SEED_RATES);
    expect(DEFAULT_BUDGET.legBudgets).toEqual({ nepal: 0, japan: 0 });
    expect(DEFAULT_BUDGET.categoryBudgets).toEqual({});
  });
});
