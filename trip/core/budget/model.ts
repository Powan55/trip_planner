/**
 * Trip-budget domain model + pure money math (the CORE).
 *
 * FRAMEWORK-FREE: this module is pure TypeScript — no React, no window,
 * no next, no firebase, no fetch, no clock, no storage. Every function is TOTAL (a bad /
 * NaN / negative / missing input degrades to a safe number, never a throw) so the panel
 * can never render `NaN` and the store never crashes on a corrupt slot. The React panel
 * lives in `components/budget-panel.tsx`; the persistence lives behind the typed storage
 * gateway (`core/storage/gateway.ts`, key 10). This file owns only the SHAPE + the math.
 *
 * ── The currency model (the reversible design) ──────────────────────────────────────────
 * The trip has two legs by country: Nepal (local currency NPR) and Japan (local
 * currency JPY). Each leg's budget + per-category budgets are entered and STORED in that
 * leg's LOCAL currency, so no per-amount currency tag is ever needed — a Nepal amount is
 * always NPR, a Japan amount is always JPY. A single `homeCurrency` (default USD) is the
 * unified DISPLAY currency for the roll-up totals.
 *
 * Rates are stored as **units of local currency per 1 USD** (USD is the fixed internal
 * anchor; `rate(USD) === 1`). This makes switching the display currency PRESENTATION-ONLY
 * and non-destructive: the stored amounts + rates never change when you toggle home
 * currency, only how the totals are expressed. Conversion always routes local → USD → home:
 *
 *     localToUsd(amount, cur)      = amount / rate[cur]           // rate[USD] = 1
 *     usdToHome(usd, home)         = usd    * rate[home]
 *     convert(amount, from, home)  = amount / rate[from] * rate[home]
 *
 * The seeded rates are APPROXIMATE mid-2026 defaults, clearly labelled as seeds in the UI —
 * the whole point is the manual override (zero rate APIs, no fetch, ever).
 *
 * ── The rollup shape (the expenses/burn-rate seam) ──────────────────────────────────────
 * `rollUp()` returns a `budget` and a `spent` for every leg + category + the grand total.
 * With no logged expenses yet, `spent` is always 0 and `remaining === budget`.
 * Expense logging feeds a `spentByLeg`/`spentByCategory` map into the SAME shape (see the optional
 * `spent` arg) so it subtracts without a reshape — `remaining` and the figures the burn-rate
 * needs are already computed here.
 */

import type { ItineraryCategory } from '@/lib/trip-data';

// ── Types ───────────────────────────────────────────────────────────────────
export type CurrencyCode = 'NPR' | 'JPY' | 'USD';
export type Leg = 'nepal' | 'japan'; // === DayPlan.country

/** All three display-currency choices, in a stable order for the toggle. */
export const CURRENCIES: readonly CurrencyCode[] = ['USD', 'NPR', 'JPY'] as const;

/** The 10 canonical itinerary categories — reused for per-category budgets. */
export const BUDGET_CATEGORIES: readonly ItineraryCategory[] = [
  'sightseeing',
  'food',
  'photography',
  'shopping',
  'nature',
  'cultural',
  'transportation',
  'hotel',
  'free',
  'nightlife',
] as const;

/**
 * The persisted budget model (typed storage gateway key 10). `version` is a cheap internal
 * forward-compat marker (NOT the Vault envelope version — the budget is its
 * own domain, no migration). All amounts are in each leg's LOCAL currency.
 */
export interface BudgetModel {
  version: 1;
  /** Display/roll-up currency (default USD). Presentation-only — see the header note. */
  homeCurrency: CurrencyCode;
  /** Units of local currency per 1 USD (the fixed anchor). User-overridable; seeded defaults. */
  rates: { NPR: number; JPY: number };
  /** Total budget per leg, in that leg's LOCAL currency (Nepal→NPR, Japan→JPY). */
  legBudgets: Record<Leg, number>;
  /** Optional per-category budgets per leg, in the leg's LOCAL currency. */
  categoryBudgets: Partial<Record<Leg, Partial<Record<ItineraryCategory, number>>>>;
}

// ── Seeds / defaults (build-time constants; NOT authoritative — the point is the override) ──
/** Approximate mid-2026 seed rates (units of local currency per 1 USD). Clearly a default. */
export const SEED_RATES: { NPR: number; JPY: number } = { NPR: 138, JPY: 155 };

/** The seeded default model a fresh visitor sees (no budgets set yet, USD display). */
export const DEFAULT_BUDGET: BudgetModel = {
  version: 1,
  homeCurrency: 'USD',
  rates: { ...SEED_RATES },
  legBudgets: { nepal: 0, japan: 0 },
  categoryBudgets: {},
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** The fixed LOCAL currency of a leg (Nepal→NPR, Japan→JPY). Total. */
export function legCurrency(leg: Leg): CurrencyCode {
  return leg === 'nepal' ? 'NPR' : 'JPY';
}

/**
 * Coerce any input to a safe, finite, non-negative number. `''`/`NaN`/`null`/`Infinity`/a
 * negative value all become 0 — the TOTAL guard that keeps every downstream number clean and
 * off-screen `NaN` impossible. Exported so the panel can sanitize a controlled input the same way.
 */
export function safeAmount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * A rate must be a FINITE POSITIVE number (a 0 or negative rate would divide-by-zero / flip
 * signs). A bad rate falls back to its seed so conversion is always well-defined.
 */
export function safeRate(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/** Units of local currency per 1 USD for a given currency. USD is the anchor (1). Total. */
export function ratePerUsd(rates: BudgetModel['rates'], cur: CurrencyCode): number {
  if (cur === 'USD') return 1;
  if (cur === 'NPR') return safeRate(rates?.NPR, SEED_RATES.NPR);
  return safeRate(rates?.JPY, SEED_RATES.JPY);
}

/**
 * Convert an amount from one currency to another via the USD anchor. Total: a bad amount → 0,
 * a bad source/target rate falls back to seed, so this never returns NaN/Infinity.
 *   convert(amount, from, to) = amount / rate[from] * rate[to]
 */
export function convert(
  amount: unknown,
  from: CurrencyCode,
  to: CurrencyCode,
  rates: BudgetModel['rates'],
): number {
  const a = safeAmount(amount);
  if (from === to) return a;
  const usd = a / ratePerUsd(rates, from); // → USD
  return usd * ratePerUsd(rates, to); // → target
}

/** Convert a leg-local amount into the home/display currency. Total. */
export function legLocalToHome(
  amount: unknown,
  leg: Leg,
  home: CurrencyCode,
  rates: BudgetModel['rates'],
): number {
  return convert(amount, legCurrency(leg), home, rates);
}

// ── Rollup (the expenses/burn-rate seam) ─────────────────────────────────────

/** A single budget/spent/remaining line, carried in the home currency for the grand total. */
export interface RollupLine {
  /** Budget in this leg's LOCAL currency (raw, as entered). */
  budgetLocal: number;
  /** Budget converted to the home/display currency. */
  budgetHome: number;
  /** Spent in the leg's LOCAL currency (0 until expenses are logged). */
  spentLocal: number;
  /** Spent in the home/display currency. */
  spentHome: number;
  /** budgetLocal − spentLocal (never below 0 clamp is NOT applied — a negative = over budget). */
  remainingLocal: number;
  /** budgetHome − spentHome. */
  remainingHome: number;
}

export interface CategoryRollup extends RollupLine {
  category: ItineraryCategory;
}

export interface LegRollup extends RollupLine {
  leg: Leg;
  currency: CurrencyCode; // the leg's local currency (NPR / JPY)
  categories: CategoryRollup[]; // only categories with a set budget or logged spend
}

export interface BudgetRollup {
  home: CurrencyCode;
  legs: LegRollup[];
  /** Grand total across both legs, expressed in the home/display currency. */
  totalBudgetHome: number;
  totalSpentHome: number;
  totalRemainingHome: number;
}

/**
 * Optional logged-expense input (the expenses seam). Amounts are in each leg's LOCAL currency,
 * mirroring the budget entry. Absent ⇒ nothing spent. The rollup shape is
 * IDENTICAL whether or not this is supplied, so expenses wire in with no reshape.
 */
export interface SpentInput {
  byLeg?: Partial<Record<Leg, number>>;
  byCategory?: Partial<Record<Leg, Partial<Record<ItineraryCategory, number>>>>;
}

const LEGS: readonly Leg[] = ['nepal', 'japan'] as const;

/**
 * The single rollup: per-leg + per-category budgets and (optionally) logged spend, plus a
 * grand total in the home currency. PURE + TOTAL — a malformed model degrades every field to
 * a safe 0. `spent` defaults to empty, so with no expenses `spent* === 0` and `remaining === budget`.
 */
export function rollUp(model: BudgetModel, spent: SpentInput = {}): BudgetRollup {
  const home = normalizeCurrency(model?.homeCurrency);
  const rates = normalizeRates(model?.rates);

  const legs: LegRollup[] = LEGS.map((leg) => {
    const cur = legCurrency(leg);
    const budgetLocal = safeAmount(model?.legBudgets?.[leg]);
    const spentLocal = safeAmount(spent.byLeg?.[leg]);

    const catBudgets = model?.categoryBudgets?.[leg] ?? {};
    const catSpent = spent.byCategory?.[leg] ?? {};
    // Union of categories that carry a set budget OR a logged spend — the panel only shows rows
    // the user has touched (keeps the category list clean; the other 10−k stay implicit 0).
    const touched = new Set<ItineraryCategory>();
    for (const c of BUDGET_CATEGORIES) {
      if (safeAmount(catBudgets[c]) > 0 || safeAmount(catSpent[c]) > 0) touched.add(c);
    }
    const categories: CategoryRollup[] = BUDGET_CATEGORIES.filter((c) => touched.has(c)).map(
      (category) => {
        const bl = safeAmount(catBudgets[category]);
        const sl = safeAmount(catSpent[category]);
        return {
          category,
          ...line(bl, sl, cur, home, rates),
        };
      },
    );

    return {
      leg,
      currency: cur,
      categories,
      ...line(budgetLocal, spentLocal, cur, home, rates),
    };
  });

  const totalBudgetHome = legs.reduce((s, l) => s + l.budgetHome, 0);
  const totalSpentHome = legs.reduce((s, l) => s + l.spentHome, 0);

  return {
    home,
    legs,
    totalBudgetHome,
    totalSpentHome,
    totalRemainingHome: totalBudgetHome - totalSpentHome,
  };
}

/** Build one budget/spent/remaining line in both local + home currency. */
function line(
  budgetLocal: number,
  spentLocal: number,
  cur: CurrencyCode,
  home: CurrencyCode,
  rates: BudgetModel['rates'],
): RollupLine {
  const budgetHome = convert(budgetLocal, cur, home, rates);
  const spentHome = convert(spentLocal, cur, home, rates);
  return {
    budgetLocal,
    budgetHome,
    spentLocal,
    spentHome,
    remainingLocal: budgetLocal - spentLocal,
    remainingHome: budgetHome - spentHome,
  };
}

// ── Model sanitizers (TOTAL — turn any corrupt slot into a valid model) ───────

/** Coerce an unknown into a valid CurrencyCode, defaulting to USD. */
export function normalizeCurrency(value: unknown): CurrencyCode {
  return value === 'NPR' || value === 'JPY' || value === 'USD' ? value : 'USD';
}

/** Coerce an unknown into a valid rates pair, seed-defaulting each side. */
export function normalizeRates(value: unknown): { NPR: number; JPY: number } {
  const v = (value ?? {}) as Partial<{ NPR: unknown; JPY: unknown }>;
  return {
    NPR: safeRate(v.NPR, SEED_RATES.NPR),
    JPY: safeRate(v.JPY, SEED_RATES.JPY),
  };
}

/**
 * Turn ANY parsed-from-storage value into a valid `BudgetModel` (the gateway is byte-transport
 * only; this module owns the shape, so it also owns the "make a corrupt slot safe" step). A
 * missing/garbage slot → `DEFAULT_BUDGET`; a partially-valid slot keeps its good fields and
 * seed-defaults the rest. TOTAL — never throws.
 */
export function normalizeModel(value: unknown): BudgetModel {
  if (value === null || typeof value !== 'object') return { ...DEFAULT_BUDGET, rates: { ...SEED_RATES } };
  const v = value as Partial<BudgetModel>;

  const legBudgetsRaw = (v.legBudgets ?? {}) as Partial<Record<Leg, unknown>>;
  const legBudgets: Record<Leg, number> = {
    nepal: safeAmount(legBudgetsRaw.nepal),
    japan: safeAmount(legBudgetsRaw.japan),
  };

  const catRaw = (v.categoryBudgets ?? {}) as Partial<
    Record<Leg, Partial<Record<ItineraryCategory, unknown>>>
  >;
  const categoryBudgets: BudgetModel['categoryBudgets'] = {};
  for (const leg of LEGS) {
    const legCats = catRaw[leg];
    if (!legCats || typeof legCats !== 'object') continue;
    const cleaned: Partial<Record<ItineraryCategory, number>> = {};
    for (const c of BUDGET_CATEGORIES) {
      const amt = safeAmount(legCats[c]);
      if (amt > 0) cleaned[c] = amt; // only persist non-zero category budgets
    }
    if (Object.keys(cleaned).length > 0) categoryBudgets[leg] = cleaned;
  }

  return {
    version: 1,
    homeCurrency: normalizeCurrency(v.homeCurrency),
    rates: normalizeRates(v.rates),
    legBudgets,
    categoryBudgets,
  };
}

// ── Formatting (pure; the panel's single source for currency display) ─────────
const CURRENCY_SYMBOL: Record<CurrencyCode, string> = { USD: '$', NPR: 'Rs', JPY: '¥' };

/** Currency symbol/prefix for a code (`$`, `Rs`, `¥`). */
export function currencySymbol(cur: CurrencyCode): string {
  return CURRENCY_SYMBOL[cur] ?? '';
}

/**
 * Format an amount for display: grouped, no decimals (whole units read cleaner for these
 * currencies at trip scale — ¥ and NPR are never sub-unit here, and USD rounds fine for a
 * budget overview). TOTAL — a bad amount shows as the symbol + 0, never `NaN`.
 */
export function formatMoney(amount: unknown, cur: CurrencyCode): string {
  const n = Math.round(safeAmount(amount));
  const grouped = n.toLocaleString('en-US');
  const sym = currencySymbol(cur);
  // "$1,200" / "Rs165,600" / "¥310,000" — space after the alpha "Rs" prefix for legibility.
  return sym === 'Rs' ? `${sym} ${grouped}` : `${sym}${grouped}`;
}
