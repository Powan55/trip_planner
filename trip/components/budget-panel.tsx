'use client';

import { useEffect, useMemo, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { Wallet, RefreshCw, Info, Plus, Pencil, Trash2, ReceiptText } from 'lucide-react';
import { CATEGORY_COLORS, type ItineraryCategory } from '@/lib/trip-data';
import { loadBudget, saveBudget } from '@/core/budget/storage';
import {
  rollUp,
  legCurrency,
  currencySymbol,
  formatMoney,
  safeAmount,
  SEED_RATES,
  CURRENCIES,
  BUDGET_CATEGORIES,
  type BudgetModel,
  type BudgetRollup,
  type LegRollup,
  type CurrencyCode,
  type Leg,
} from '@/core/budget/model';
import { useExpenses } from '@/hooks/use-expenses';
import { expensesToSpent, type Expense } from '@/core/budget/expenses';
import { EXPENSE_OPEN_EVENT } from '@/components/expense-log-host';
import { getNow } from '@/lib/trip-now';
import BurnRateView from '@/components/burn-rate-view';

/**
 * Budget panel — Yen & Rupee, the CORE. Mounted on `/plan` between the calendar
 * planner and Backup & Restore via `dynamic({ ssr:false })`.
 *
 * Lets the traveller SET budgets and rates and SEE the totals. Specifically:
 *   - a total budget per leg (Nepal in NPR, Japan in JPY);
 *   - optional per-category budgets per leg (the 10 canonical ItineraryCategory values);
 *   - the home/display currency (USD / NPR / JPY);
 *   - a manual override of the two exchange rates (NPR-per-USD, JPY-per-USD) — the seeds are
 *     labelled as approximate defaults; there is NO rate API / fetch.
 * Per-leg totals + a grand total roll up into the home currency. Every edit persists through the
 * typed storage gateway (key 10) via `saveBudget`, so it survives a reload.
 *
 * State/persistence: SSR-safe — the model starts at the seeded default (matching the server render)
 * and hydrates from `loadBudget()` on mount, so a fresh visitor sees the seeded defaults and a
 * returning one sees their saved model. All math is the pure `core/budget/model.ts`;
 * this component holds only controlled inputs + the persistence effect. Inputs are TOTAL: an empty /
 * NaN value is treated as 0/unset and never renders `NaN`.
 *
 * A11y / house style: dark glassmorphism (glass-card), labelled inputs, visible focus rings, ≥44px
 * touch targets on the currency toggle, `aria-live` on the grand total, reduced-motion-gated reveal.
 */
export default function BudgetPanel() {
  const prefersReducedMotion = useReducedMotion();

  // Seeded default first (SSR-safe, matches first paint), then hydrate from storage on mount.
  const [model, setModel] = useState<BudgetModel>(() => ({
    version: 1,
    homeCurrency: 'USD',
    rates: { ...SEED_RATES },
    legBudgets: { nepal: 0, japan: 0 },
    categoryBudgets: {},
  }));
  const [hydrated, setHydrated] = useState(false);
  // The clock instant that drives the burn-rate TIME math. SSR-safe: start at the real
  // `new Date()` (matches first paint, no hydration mismatch), then re-resolve via `getNow()` on
  // mount so the `?today=` override is applied client-side (the same post-mount pattern the
  // calendar's travel-mode default uses). Resolved once per load — the override is a module-cached
  // read — which is exactly right for a "how far into the trip are we" figure.
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    setModel(loadBudget());
    setHydrated(true);
    setNow(getNow());
  }, []);

  // Persist every change AFTER hydration (so the first-render default can't clobber a saved model
  // before load — the "hydrated flag" discipline the calendar uses).
  const persist = (next: BudgetModel) => {
    setModel(next);
    if (hydrated) saveBudget(next);
  };

  const setLegBudget = (leg: Leg, value: string) => {
    persist({ ...model, legBudgets: { ...model.legBudgets, [leg]: safeAmount(value) } });
  };

  const setCategoryBudget = (leg: Leg, category: ItineraryCategory, value: string) => {
    const amount = safeAmount(value);
    const legCats = { ...(model.categoryBudgets[leg] ?? {}) };
    if (amount > 0) legCats[category] = amount;
    else delete legCats[category]; // 0/empty ⇒ unset (keeps the stored map clean)
    persist({
      ...model,
      categoryBudgets: { ...model.categoryBudgets, [leg]: legCats },
    });
  };

  const setHomeCurrency = (home: CurrencyCode) => {
    persist({ ...model, homeCurrency: home });
  };

  const setRate = (cur: 'NPR' | 'JPY', value: string) => {
    // Keep the raw typed number in state; the pure math seed-defaults a 0/blank at read time,
    // so a mid-edit blank never breaks the totals. Store the sanitized-but-not-forced value:
    // an empty string parses to 0, which `ratePerUsd` treats as "fall back to seed".
    const n = value === '' ? 0 : Number(value);
    const rate = Number.isFinite(n) ? n : 0;
    persist({ ...model, rates: { ...model.rates, [cur]: rate } });
  };

  const resetRates = () => {
    persist({ ...model, rates: { ...SEED_RATES } });
  };

  // The reactive expense store. Its aggregate feeds the `rollUp` `spent` seam, so the
  // rollup now returns real spent/remaining. The store's CustomEvent makes this update live the
  // instant an expense is logged/edited/deleted from the global dialog (or the list below).
  const { expenses, removeExpense } = useExpenses();
  const spent = useMemo(() => expensesToSpent(expenses), [expenses]);
  const roll = useMemo(() => rollUp(model, spent), [model, spent]);
  const home = model.homeCurrency;

  // Open the fast-log dialog (add mode) via the global host. The button that had focus is the
  // parent-owned focus-return target (the host captures document.activeElement).
  const openLogDialog = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(EXPENSE_OPEN_EVENT));
  };

  // Open the dialog in edit mode for a specific expense.
  const openEditDialog = (expense: Expense) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(EXPENSE_OPEN_EVENT, { detail: { expense } }));
  };

  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } }
    : {
        hidden: { opacity: 0, y: 16 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
      };

  return (
    <section
      aria-labelledby="budget-panel-heading"
      className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
      data-testid="budget-panel"
    >
      <m.div
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.15 }}
        variants={reveal}
        className="glass-card rounded-2xl p-6 sm:p-8"
      >
        {/* Header */}
        <div className="mb-6 flex items-start gap-3">
          <Wallet className="mt-0.5 h-6 w-6 shrink-0 text-gold-400" aria-hidden="true" />
          <div>
            <h2
              id="budget-panel-heading"
              className="font-display text-xl font-bold text-white sm:text-2xl"
            >
              Trip Budget
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-white/60">
              Set a budget for each leg (Nepal in Rupees, Japan in Yen) and see it all in one
              currency. Everything is saved on this device.
            </p>
          </div>
        </div>

        {/* Home currency + rates row */}
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {/* Home / display currency toggle */}
          <fieldset className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <legend className="px-1 text-sm font-semibold text-white">Show totals in</legend>
            <div
              role="radiogroup"
              aria-label="Home currency for totals"
              data-testid="budget-currency-toggle"
              className="mt-2 flex flex-wrap gap-2"
            >
              {CURRENCIES.map((cur) => {
                const active = home === cur;
                return (
                  <button
                    key={cur}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setHomeCurrency(cur)}
                    data-testid={`budget-currency-${cur.toLowerCase()}`}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 ${
                      active
                        ? 'border-gold-400 bg-gold-400/15 text-gold-300'
                        : 'border-white/15 text-white/70 hover:bg-white/5'
                    }`}
                  >
                    <span aria-hidden="true">{currencySymbol(cur)}</span>
                    {cur}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Exchange rates (manual override; seeded) */}
          <fieldset className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <legend className="px-1 text-sm font-semibold text-white">Exchange rates</legend>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-white/50">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Approximate defaults — edit to match today's rate. Units per 1 US dollar.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <RateField
                id="budget-rate-npr"
                label="Rs per $1"
                seed={SEED_RATES.NPR}
                value={model.rates.NPR}
                onChange={(v) => setRate('NPR', v)}
              />
              <RateField
                id="budget-rate-jpy"
                label="¥ per $1"
                seed={SEED_RATES.JPY}
                value={model.rates.JPY}
                onChange={(v) => setRate('JPY', v)}
              />
            </div>
            <button
              type="button"
              onClick={resetRates}
              data-testid="budget-rate-reset"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Reset to defaults
            </button>
          </fieldset>
        </div>

        {/* Per-leg budgets */}
        <div className="grid gap-4 lg:grid-cols-2">
          <LegBudgetCard
            leg="nepal"
            title="Nepal leg"
            subtitle="Dec 9 – 18 · Kathmandu &amp; around"
            model={model}
            home={home}
            legRoll={roll.legs[0]}
            onLegBudget={(v) => setLegBudget('nepal', v)}
            onCategoryBudget={(c, v) => setCategoryBudget('nepal', c, v)}
          />
          <LegBudgetCard
            leg="japan"
            title="Japan leg"
            subtitle="Dec 19 – Jan 9 · Tokyo, Kyoto &amp; more"
            model={model}
            home={home}
            legRoll={roll.legs[1]}
            onLegBudget={(v) => setLegBudget('japan', v)}
            onCategoryBudget={(c, v) => setCategoryBudget('japan', c, v)}
          />
        </div>

        {/* Grand total (budget + spent + remaining, all in the home currency) */}
        <GrandTotal roll={roll} home={home} />

        {/* Burn-rate vs plan: rendered from the SAME live `roll` — spent-vs-budget bar, days
            elapsed/remaining, daily avg vs budget, projected end-of-trip total, under/on/over pace.
            No duplicate budget/expense load — it's fed the panel's reactive totals + the clock. */}
        <BurnRateView
          budgetHome={roll.totalBudgetHome}
          spentHome={roll.totalSpentHome}
          home={home}
          now={now}
        />

        {/* Expense log — the fast-log trigger + the logged-expense list */}
        <ExpenseLog
          expenses={expenses}
          onLog={openLogDialog}
          onEdit={openEditDialog}
          onDelete={removeExpense}
        />
      </m.div>
    </section>
  );
}

/** A compact "spent · remaining" line under a budget figure, with an over-budget cue. */
function SpentRemaining({
  spentLocal,
  remainingLocal,
  budgetLocal,
  cur,
  testId,
}: {
  spentLocal: number;
  remainingLocal: number;
  budgetLocal: number;
  cur: CurrencyCode;
  testId: string;
}) {
  const over = remainingLocal < 0;
  // Nothing to show until either a budget is set or something has been spent.
  if (budgetLocal <= 0 && spentLocal <= 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid={testId}>
      <span className="text-white/50">
        Spent{' '}
        <span className="font-semibold text-white/80" data-testid={`${testId}-spent`}>
          {formatMoney(spentLocal, cur)}
        </span>
      </span>
      <span aria-hidden="true" className="text-white/20">
        ·
      </span>
      <span className={over ? 'text-red-400' : 'text-emerald-300/90'}>
        {over ? 'Over by ' : 'Left '}
        <span className="font-semibold" data-testid={`${testId}-remaining`}>
          {formatMoney(Math.abs(remainingLocal), cur)}
        </span>
      </span>
    </p>
  );
}

/** The grand-total block: budget + (once anything is spent) spent + remaining in the home currency. */
function GrandTotal({ roll, home }: { roll: BudgetRollup; home: CurrencyCode }) {
  const over = roll.totalRemainingHome < 0;
  const anySpend = roll.totalSpentHome > 0;
  return (
    <div
      data-testid="budget-grand-total"
      aria-live="polite"
      className="mt-6 flex flex-col gap-3 rounded-xl border border-gold-400/25 bg-gold-400/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-xs uppercase tracking-widest text-gold-400/80">Total trip budget</p>
        <p className="mt-1 text-sm text-white/50">Nepal + Japan, converted to {home}</p>
      </div>
      <div className="sm:text-right">
        <p
          data-testid="budget-grand-total-value"
          className="font-display text-3xl font-bold text-gradient-gold"
        >
          {formatMoney(roll.totalBudgetHome, home)}
        </p>
        {anySpend && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs sm:justify-end">
            <span className="text-white/50">
              Spent{' '}
              <span className="font-semibold text-white/80" data-testid="budget-grand-total-spent">
                {formatMoney(roll.totalSpentHome, home)}
              </span>
            </span>
            <span aria-hidden="true" className="text-white/20">
              ·
            </span>
            <span className={over ? 'text-red-400' : 'text-emerald-300/90'}>
              {over ? 'Over by ' : 'Left '}
              <span className="font-semibold" data-testid="budget-grand-total-remaining">
                {formatMoney(Math.abs(roll.totalRemainingHome), home)}
              </span>
            </span>
          </p>
        )}
      </div>
    </div>
  );
}

/** A labelled numeric rate input with its seed shown as the placeholder/hint. */
function RateField({
  id,
  label,
  seed,
  value,
  onChange,
}: {
  id: string;
  label: string;
  seed: number;
  value: number;
  onChange: (value: string) => void;
}) {
  // Show the empty string when the stored rate is the "unset" sentinel 0 (so the placeholder
  // seed shows through); otherwise the typed number. This keeps a mid-edit blank possible.
  const display = value === 0 ? '' : String(value);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-white/70">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={display}
        placeholder={String(seed)}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-white/15 bg-navy-900/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
      />
    </div>
  );
}

/** One leg's budget card — total budget input, per-leg home-currency echo, and category budgets. */
function LegBudgetCard({
  leg,
  title,
  subtitle,
  model,
  home,
  legRoll,
  onLegBudget,
  onCategoryBudget,
}: {
  leg: Leg;
  title: string;
  subtitle: string;
  model: BudgetModel;
  home: CurrencyCode;
  legRoll: LegRollup | undefined;
  onLegBudget: (value: string) => void;
  onCategoryBudget: (category: ItineraryCategory, value: string) => void;
}) {
  const cur = legCurrency(leg);
  const sym = currencySymbol(cur);
  const legTotal = safeAmount(model.legBudgets[leg]);
  const legCats = model.categoryBudgets[leg] ?? {};
  const legInputId = `budget-leg-${leg}-input`;
  const budgetHome = legRoll?.budgetHome ?? 0;
  // Per-category spent/remaining, keyed by category, from the rollup (only touched categories).
  const catRollByCategory = new Map((legRoll?.categories ?? []).map((c) => [c.category, c]));

  return (
    <div
      data-testid={`budget-leg-${leg}`}
      className="flex flex-col gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <p className="mt-0.5 text-xs text-white/50" dangerouslySetInnerHTML={{ __html: subtitle }} />
      </div>

      {/* Leg total budget (in the leg's local currency) */}
      <div className="flex flex-col gap-1">
        <label htmlFor={legInputId} className="text-xs font-medium text-white/70">
          Total budget ({cur})
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-white/40"
          >
            {sym}
          </span>
          <input
            id={legInputId}
            data-testid={legInputId}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={legTotal === 0 ? '' : String(legTotal)}
            placeholder="0"
            onChange={(e) => onLegBudget(e.target.value)}
            className={`w-full rounded-lg border border-white/15 bg-navy-900/60 py-2 pr-3 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40 ${
              sym === 'Rs' ? 'pl-9' : 'pl-7'
            }`}
          />
        </div>
        {/* Home-currency echo of this leg's total (presentation-only). */}
        <p className="text-xs text-white/50" data-testid={`budget-leg-${leg}-home`}>
          {home === cur ? (
            <span className="text-white/30">Shown in {cur}</span>
          ) : (
            <>
              ≈ <span className="font-semibold text-white/70">{formatMoney(budgetHome, home)}</span> in{' '}
              {home}
            </>
          )}
        </p>
        {/* Spent + remaining for this leg, in the leg's local currency. */}
        <SpentRemaining
          spentLocal={legRoll?.spentLocal ?? 0}
          remainingLocal={legRoll?.remainingLocal ?? 0}
          budgetLocal={legRoll?.budgetLocal ?? 0}
          cur={cur}
          testId={`budget-leg-${leg}-spent-remaining`}
        />
      </div>

      {/* Per-category budgets (optional) */}
      <details className="group rounded-lg border border-white/10 bg-navy-900/40">
        <summary
          data-testid={`budget-leg-${leg}-categories-toggle`}
          className="flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
        >
          <span>Break down by category (optional)</span>
          <span aria-hidden="true" className="text-white/40 transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
          {BUDGET_CATEGORIES.map((category) => {
            const colors = CATEGORY_COLORS[category];
            const catId = `budget-cat-${leg}-${category}`;
            const stored = safeAmount(legCats[category]);
            const catRoll = catRollByCategory.get(category);
            // Only show a category's spent/remaining once it HAS a budget set
            // (per-category, where a category budget exists).
            const showCatSpend = stored > 0 && (catRoll?.spentLocal ?? 0) >= 0 && !!catRoll;
            return (
              <div key={category} className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <label
                    htmlFor={catId}
                    className={`inline-flex min-w-[6.5rem] items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colors.bg} ${colors.text}`}
                  >
                    {category}
                  </label>
                  <div className="relative flex-1">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-white/40"
                    >
                      {sym}
                    </span>
                    <input
                      id={catId}
                      data-testid={catId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={stored === 0 ? '' : String(stored)}
                      placeholder="0"
                      aria-label={`${category} budget for the ${leg} leg, in ${cur}`}
                      onChange={(e) => onCategoryBudget(category, e.target.value)}
                      className={`w-full rounded-lg border border-white/15 bg-navy-900/60 py-1.5 pr-2.5 text-xs text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40 ${
                        sym === 'Rs' ? 'pl-8' : 'pl-6'
                      }`}
                    />
                  </div>
                </div>
                {showCatSpend && catRoll && (
                  <p
                    className="pl-[calc(6.5rem+0.75rem)] text-[11px]"
                    data-testid={`budget-cat-${leg}-${category}-spent-remaining`}
                  >
                    <span className="text-white/40">Spent {formatMoney(catRoll.spentLocal, cur)}</span>
                    <span aria-hidden="true" className="mx-1.5 text-white/20">
                      ·
                    </span>
                    <span className={catRoll.remainingLocal < 0 ? 'text-red-400' : 'text-emerald-300/80'}>
                      {catRoll.remainingLocal < 0 ? 'over by ' : 'left '}
                      {formatMoney(Math.abs(catRoll.remainingLocal), cur)}
                    </span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

/**
 * The expense log: a "Log expense" trigger (emits `expense:open`) + the list of logged
 * expenses (newest first) with per-row edit + delete. Amounts show in each expense's leg-local
 * currency. Empty state when nothing is logged yet.
 */
function ExpenseLog({
  expenses,
  onLog,
  onEdit,
  onDelete,
}: {
  expenses: Expense[];
  onLog: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (id: string) => void;
}) {
  // Newest first — sort a copy by createdAt descending (the core keeps insertion order).
  const ordered = useMemo(
    () => [...expenses].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)),
    [expenses],
  );

  return (
    <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5" data-testid="expense-log">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ReceiptText className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-white sm:text-base">Logged expenses</h3>
        </div>
        <button
          type="button"
          onClick={onLog}
          data-testid="expense-log-open"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gold-500 px-3.5 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log expense
        </button>
      </div>

      {ordered.length === 0 ? (
        <div
          data-testid="expense-log-empty"
          className="rounded-lg border border-dashed border-white/10 px-4 py-8 text-center"
        >
          <p className="text-sm text-white/60">No expenses logged yet.</p>
          <p className="mt-1 text-xs text-white/40">
            Tap “Log expense” to record a meal, a taxi, or a ticket — it counts against your budget above.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="expense-list">
          {ordered.map((e) => {
            const cur = legCurrency(e.leg);
            const colors = CATEGORY_COLORS[e.category];
            return (
              <li
                key={e.id}
                data-testid={`expense-item-${e.id}`}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-navy-900/40 p-3"
              >
                <span
                  className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colors.bg} ${colors.text}`}
                >
                  {e.category}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white" data-testid={`expense-item-${e.id}-amount`}>
                    {formatMoney(e.amount, cur)}
                    <span className="ml-1.5 text-xs font-normal capitalize text-white/40">· {e.leg}</span>
                  </p>
                  {e.note && <p className="truncate text-xs text-white/50">{e.note}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(e)}
                  data-testid={`expense-item-edit-${e.id}`}
                  aria-label={`Edit ${e.category} expense of ${formatMoney(e.amount, cur)}`}
                  className="shrink-0 rounded-lg p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(e.id)}
                  data-testid={`expense-item-delete-${e.id}`}
                  aria-label={`Delete ${e.category} expense of ${formatMoney(e.amount, cur)}`}
                  className="shrink-0 rounded-lg p-2 text-white/40 transition-colors hover:bg-red-500/20 hover:text-red-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
