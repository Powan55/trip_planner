'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { m, useReducedMotion, useInView } from 'framer-motion';
import { useCountUp } from '@/hooks/use-count-up';
import { showUndoToast } from '@/lib/undo-toast';
import { Wallet } from 'lucide-react';
import { CATEGORY_COLORS, type ItineraryCategory } from '@/lib/trip-data';
import { useBudget } from '@/hooks/use-budget';
import {
  rollUp,
  legCurrency,
  currencySymbol,
  formatMoney,
  safeAmount,
  BUDGET_CATEGORIES,
  type BudgetModel,
  type BudgetRollup,
  type LegRollup,
  type CurrencyCode,
  type Leg,
} from '@/core/budget/model';
import { useExpenses } from '@/hooks/use-expenses';
import { usePhotos } from '@/hooks/use-photos';
import { expensesToSpent, type Expense } from '@/core/budget/expenses';
import { settle } from '@/core/budget/settlement';
import { EXPENSE_OPEN_EVENT } from '@/components/expense-log-host';
import { getNow } from '@/lib/trip-now';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { TRAVELERS } from '@/lib/token-auth';
import BurnRateView from '@/components/burn-rate-view';
import ExpenseLog from '@/components/expense-log';
import SettleUpSummary from '@/components/settle-up-summary';

/**
 * Budget panel. Mounted on `/plan` between the calendar planner and Backup & Restore
 * via `dynamic({ ssr:false })`.
 *
 * Lets the traveller SET budgets and rates and SEE the totals — expense logging and
 * burn-rate/overlays live in sibling components. Specifically:
 *   - a total budget per leg (Nepal in NPR, Japan in JPY);
 *   - optional per-category budgets per leg (the 10 canonical ItineraryCategory values);
 *   - the home/display currency (USD / NPR / JPY);
 *   - a manual override of the two exchange rates (NPR-per-USD, JPY-per-USD) — the seeds are
 *     labelled as approximate defaults; there is NO rate API / fetch.
 * Per-leg totals + a grand total roll up into the home currency. Every edit persists through the
 * typed storage gateway via `saveBudget`, so it survives a reload.
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

  // Reactive budget store — the shared `createReactiveStore` skeleton. Seeds from
  // the StoragePort's SSR value, hydrates on mount, and re-reads on the `'budget:changed'` event +
  // cross-tab `storage`. Replaces the panel's former ad-hoc `useState` + `loadBudget`/
  // `saveBudget`; the money math + input handling below are unchanged.
  const { model, commit } = useBudget();
  // The clock instant that drives the burn-rate TIME math. SSR-safe: start at the real
  // `new Date()` (matches first paint, no hydration mismatch), then re-resolve via `getNow()` on
  // mount so the `?today=` override is applied client-side (the same post-mount pattern the
  // calendar's travel-mode default uses). Resolved once per load — the override is a module-cached
  // read — which is exactly right for a "how far into the trip are we" figure.
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    setNow(getNow());
  }, []);

  // Persist every change through the store's single commit choke-point (fresh-base
  // read + fan-out). Gated on `hydrated` INSIDE `commit` (so a first-render seed can't clobber a saved
  // model before load), which is why the setters can build `next` from the
  // current `model` and hand it in as a constant compute.
  const persist = (next: BudgetModel) => {
    commit(() => next);
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

  // The home-currency toggle + exchange-rate override moved to the Settings page
  // (`components/settings-panel.tsx`). The write path is IDENTICAL (still `useBudget().commit`),
  // so budget sync (`mergeBudget`) is unaffected — only the rendering location changed.

  // The reactive expense store. Its aggregate feeds the `rollUp` `spent` seam, so the
  // rollup now returns real spent/remaining. The store's CustomEvent makes this update live the
  // instant an expense is logged/edited/deleted from the global dialog (or the list below).
  const { expenses, removeExpense, restoreExpense } = useExpenses();
  // The sync-on expense Undo re-adds a FRESH-ID copy, so any receipt photo pointed at the
  // old id must follow. `repointExpense` is a no-op when the id is unchanged (dormant restore).
  const { repointExpense } = usePhotos();
  const spent = useMemo(() => expensesToSpent(expenses), [expenses]);
  const roll = useMemo(() => rollUp(model, spent), [model, spent]);
  const home = model.homeCurrency;

  // The read-only "who owes whom" settlement over the SAME expenses (per-leg / per-currency).
  // Separate from the spend rollup above — split never changes totals, only who reimburses whom.
  // `me` (the active traveler) is the payer fallback for a split expense logged without an explicit
  // payer. Empty until ≥1 split expense exists, so the summary stays hidden on the fast path.
  const { traveler } = useActiveTraveler();
  const settlements = useMemo(
    () => settle(expenses, TRAVELERS.map((t) => t.name), traveler?.name),
    [expenses, traveler],
  );

  // Delete an expense immediately (fast-log ethos — no confirm dialog), then offer a sonner
  // Undo that re-inserts the EXACT removed object (same id + createdAt) via the store's
  // restore path. Keeping the removed object captured in the closure is what makes the restore
  // byte-identical rather than a fresh-id re-log.
  const handleDeleteExpense = (expense: Expense) => {
    removeExpense(expense.id);
    showUndoToast(
      `Deleted ${formatMoney(expense.amount, legCurrency(expense.leg))} ${expense.category}`,
      () => {
        // Restore returns the id the row came back under (fresh under sync, same when dormant); move
        // any receipt meta to it so a synced Undo doesn't strand the photo. No-op if unchanged.
        const newId = restoreExpense(expense);
        repointExpense(expense.id, newId);
      },
    );
  };

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

  // Axe-deterministic reveal: full-opacity slide (opacity pinned to 1) so the axe scan
  // (no reduced motion) never catches the muted budget copy mid-fade below AA. Reduced-motion
  // branch left intact (it only runs under reduced motion, which the scan does not exercise).
  const reveal = prefersReducedMotion
    ? { hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.3 } } }
    : {
        hidden: { opacity: 1, y: 16 },
        show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
      };

  return (
    <section
      aria-labelledby="budget-panel-title"
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
              id="budget-panel-title"
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

        {/* Per-leg budgets */}
        <div className="grid gap-4 lg:grid-cols-2">
          <LegBudgetCard
            leg="nepal"
            title="Nepal leg"
            subtitle="Dec 9 – 18 · Kathmandu & around"
            model={model}
            home={home}
            legRoll={roll.legs[0]}
            onLegBudget={(v) => setLegBudget('nepal', v)}
            onCategoryBudget={(c, v) => setCategoryBudget('nepal', c, v)}
          />
          <LegBudgetCard
            leg="japan"
            title="Japan leg"
            subtitle="Dec 19 – Jan 9 · Tokyo, Kyoto & more"
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
          onDelete={handleDeleteExpense}
        />

        {/* Settle up — who owes whom over the split expenses; hidden until ≥1 split. */}
        <SettleUpSummary settlements={settlements} />
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

/**
 * Count-up: a money figure that eases up to its value the first time it scrolls
 * into view (reusing the `use-count-up` hook, exactly like the dashboard
 * stats). PRESENTATIONAL ONLY — `formatMoney` still formats the REAL number every
 * frame, and the final frame lands on `amount` exactly, so the displayed value is
 * byte-identical to a plain render once settled. Reduced motion is owned by the hook:
 * it skips the ramp and reports the final value immediately. In jsdom (unit
 * tests) `useInView` never fires, so the hook reports the live value with no ramp.
 */
function CountUpMoney({
  amount,
  cur,
  testId,
  className,
}: {
  amount: number;
  cur: CurrencyCode;
  testId: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const { value } = useCountUp(amount, inView);
  return (
    <span ref={ref} data-testid={testId} className={className}>
      {formatMoney(value, cur)}
    </span>
  );
}

/** The grand-total block: budget + (once anything is spent) spent + remaining in the home currency. */
function GrandTotal({ roll, home }: { roll: BudgetRollup; home: CurrencyCode }) {
  const over = roll.totalRemainingHome < 0;
  const anySpend = roll.totalSpentHome > 0;
  return (
    <div
      data-testid="budget-grand-total"
      className="mt-6 flex flex-col gap-3 rounded-xl border border-gold-400/25 bg-gold-400/[0.06] p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-xs uppercase tracking-widest text-gold-400/80">Total trip budget</p>
        <p className="mt-1 text-sm text-white/50">Nepal + Japan, converted to {home}</p>
      </div>
      <div className="sm:text-right">
        <p
          data-testid="budget-grand-total-value"
          aria-live="polite"
          className="font-display text-3xl font-bold text-gradient-gold"
        >
          {formatMoney(roll.totalBudgetHome, home)}
        </p>
        {anySpend && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs sm:justify-end">
            <span className="text-white/50">
              Spent{' '}
              <CountUpMoney
                amount={roll.totalSpentHome}
                cur={home}
                testId="budget-grand-total-spent"
                className="font-semibold text-white/80"
              />
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
        <p className="mt-0.5 text-xs text-white/50">{subtitle}</p>
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
            <span className="text-white/55">Shown in {cur}</span>
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
          className="flex min-h-[44px] cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-xs font-medium text-white/70 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
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
            // Only show a category's spent/remaining once it HAS a budget set (per the brief:
            // per-category where a category budget exists).
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
                    <span className="text-white/55">Spent {formatMoney(catRoll.spentLocal, cur)}</span>
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

