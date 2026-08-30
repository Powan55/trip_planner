'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInView } from 'framer-motion';
import { useCountUp } from '@/hooks/use-count-up';
import { useDraftOnBlur } from '@/hooks/use-draft-on-blur';
import { showUndoToast } from '@/lib/undo-toast';
import { CATEGORY_COLORS, type ItineraryCategory } from '@/lib/trip-data';
import { useBudget } from '@/hooks/use-budget';
import {
  rollUp,
  legCurrency,
  currencySymbol,
  formatMoney,
  safeAmount,
  convert,
  ratePerUsd,
  BUDGET_CATEGORIES,
  LEGS,
  SEED_RATES,
  type BudgetModel,
  type BudgetRollup,
  type LegRollup,
  type CategoryRollup,
  type CurrencyCode,
  type Leg,
  type SpentInput,
} from '@/core/budget/model';
import { useExpenses } from '@/hooks/use-expenses';
import { usePhotos } from '@/hooks/use-photos';
import { expensesToSpent, type Expense } from '@/core/budget/expenses';
import { settle } from '@/core/budget/settlement';
import { EXPENSE_OPEN_EVENT } from '@/components/expense-log-host';
import { getNow } from '@/lib/trip-now';
import { rosterForActiveTrip } from '@/lib/token-auth';
import { getActiveTrip } from '@/core/trips';
import { formatDate } from '@/core/dates';
import { legLabel } from '@/lib/leg-label';
import BurnRateView from '@/components/burn-rate-view';
import ExpenseLog from '@/components/expense-log';
import SettleUpSummary from '@/components/settle-up-summary';

/**
 * Budget panel. Mounted on `/plan` below the trip timeline
 * via `dynamic({ ssr:false })`. (A4): its four money sub-views (budget · expenses · burn ·
 * settle) sit behind a segmented control — one at a time — so `/plan` stays calendar-first.
 *
 * Lets the traveller SET budgets and rates and SEE the totals — no expense LOGGING and no
 * burn-rate/overlays. Specifically:
 * - a total budget per leg (Nepal in NPR, Japan in JPY);
 * - optional per-category budgets per leg;
 * - the home/display currency (USD / NPR / JPY);
 * - a manual override of the two exchange rates (NPR-per-USD, JPY-per-USD) — the seeds are
 * labelled as approximate defaults; there is NO rate API / fetch.
 * Per-leg totals + a grand total roll up into the home currency. Every edit persists through the
 * typed storage gateway via `saveBudget`, so it survives a reload.
 *
 * State/persistence: SSR-safe — the model starts at the seeded default (matching the server render)
 * and hydrates from `loadBudget()` on mount, so a fresh visitor sees the seeded defaults and a
 * returning one sees their saved model. All math is the pure `core/budget/model.ts`;
 * this component holds only controlled inputs + the persistence effect. Inputs are TOTAL: an empty /
 * NaN value is treated as 0/unset and never renders `NaN`.
 *
 * A11y / house style: hairline-ruled surfaces, labelled inputs, visible focus rings, tap-floor
 * touch targets on every control, and `aria-live` on the grand total. No entrance to fork: the
 * panel is present when you arrive.
 */
export default function BudgetPanel() {
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

  // (A4): the four money sub-views (budget · expenses · burn · settle) show ONE AT A TIME
  // behind a real tablist, instead of the old single long stacked scroll — so /plan stays
  // calendar-first. Default = Budget: the planning primitive you set first (the section's own
  // seed state + <h2> "Trip Budget"), and the logical head of the money flow (set target → track
  // spend → check pace → settle up). Every view stays reachable; all money math is unchanged.
  const [view, setView] = useState<MoneyView>('budget');

  // Persist every change through the store's single commit choke-point ( fresh-base +
  //). Gated on `hydrated` INSIDE `commit` (so a first-render seed can't clobber a saved
  // model before load — the discipline), which is why the setters can build `next` from the
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

  // the home-currency toggle + exchange-rate override moved to the Settings page
  // (`components/settings-panel.tsx`). The write path is IDENTICAL (still `useBudget().commit`),
  // so budget sync is unaffected — only the rendering location changed.

  // the reactive expense store. Its aggregate feeds the `rollUp` `spent` seam, so the
  // rollup now returns real spent/remaining. The store's CustomEvent makes this update live the
  // instant an expense is logged/edited/deleted from the global dialog (or the list below).
  const { expenses, removeExpense, restoreExpense } = useExpenses();
  // the sync-on expense Undo re-adds a FRESH-ID copy, so any receipt photo pointed at the
  // old id must follow. `repointExpense` is a no-op when the id is unchanged (dormant restore).
  const { repointExpense, photosFor, removePhoto } = usePhotos();
  const spent = useMemo(() => expensesToSpent(expenses), [expenses]);
  const roll = useMemo(() => rollUp(model, spent), [model, spent]);
  const home = model.homeCurrency;

  // the read-only "who owes whom" settlement over the SAME expenses (per-leg / per-currency).
  // Separate from the spend rollup above — split never changes totals, only who reimburses whom.
  // Empty until ≥1 split expense exists, so the summary stays hidden on the fast path. It takes NO
  // identity: a split row without a recorded `paidBy` settles to nobody rather than to whoever is
  // signed in (D-333), so this view is identical on every device.
  const settlements = useMemo(
    () => settle(expenses, rosterForActiveTrip(expenses)),
    [expenses],
  );

  // delete an expense immediately (fast-log ethos — no confirm dialog), then offer a sonner
  // Undo that re-inserts the EXACT removed object (same id + createdAt) via the store's
  // restore path. Keeping the removed object captured in the closure is what makes the restore
  // byte-identical rather than a fresh-id re-log.
  const handleDeleteExpense = (expense: Expense) => {
    // Captured BEFORE the delete: the receipt has to outlive the undo window (Undo re-points it),
    // so it is freed only once that window closes un-taken (#119).
    const receipts = photosFor({ kind: 'expense', expenseId: expense.id });
    removeExpense(expense.id);
    showUndoToast(
      `Deleted ${formatMoney(expense.amount, legCurrency(expense.leg))} ${expense.category}`,
      () => {
        // Restore returns the id the row came back under (fresh under sync, same when dormant); move
        // any receipt meta to it so a synced Undo doesn't strand the photo. No-op if unchanged.
        const newId = restoreExpense(expense);
        repointExpense(expense.id, newId);
      },
      () => {
        void (async () => {
          // Sequential: each removePhoto commits over the store's current value.
          for (const photo of receipts) await removePhoto(photo.id);
        })();
      },
    );
  };

  // Open the fast-log dialog (add mode) via the global host. The button that had focus is the
  // parent-owned focus-return target.
  const openLogDialog = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(EXPENSE_OPEN_EVENT));
  };

  // Open the dialog in edit mode for a specific expense.
  const openEditDialog = (expense: Expense) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(EXPENSE_OPEN_EVENT, { detail: { expense } }));
  };

  return (
    <section
      aria-labelledby="budget-panel-title"
      className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
      data-testid="budget-panel"
    >
      <div className="border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))] p-gut sm:p-6">
        {/* Header */}
        <div className="mb-5">
          <div className="sec">
            <h2 id="budget-panel-title">Trip budget</h2>
            <span className="sub">{expenses.length} entries logged</span>
          </div>
          <p className="max-w-2xl text-t-body text-ink-mid">
            Track your budget, spending, pace, and who owes whom — all in one place, saved on this
            device.
          </p>
        </div>

        {/* the money views behind a real, keyboard-operable tablist (one at a time). */}
        <MoneyTabs view={view} onChange={setView} />

        {/* Budget: per-leg budgets + grand total */}
        <div
          role="tabpanel"
          id="budget-view-panel-budget"
          aria-labelledby="budget-view-tab-budget"
          hidden={view !== 'budget'}
          tabIndex={0}
          className="mt-6 focus-visible:outline-none"
        >
          {/* The ruled ledger. It is the SHAPE of the record, drawn at the
              size it will be: every category line, every leg currency and the derived home
              column, ruled and totalled, whether or not anything has been written into it. */}
          <Ledger spent={spent} model={model} entries={expenses.length} home={home} />

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {LEGS.map((leg) => {
              const tripLeg = getActiveTrip().legs.find((l) => l.id === leg);
              return (
                <LegBudgetCard
                  key={leg}
                  leg={leg}
                  title={`${legLabel(leg)} leg`}
                  subtitle={
                    tripLeg
                      ? `${formatDate(tripLeg.start)} – ${formatDate(tripLeg.end)} · ${tripLeg.fallbackCity}`
                      : ''
                  }
                  model={model}
                  home={home}
                  legRoll={roll.legs.find((l) => l.leg === leg)}
                  onLegBudget={(v) => setLegBudget(leg, v)}
                  onCategoryBudget={(c, v) => setCategoryBudget(leg, c, v)}
                />
              );
            })}
          </div>
          <GrandTotal roll={roll} home={home} />
        </div>

        {/* Expenses: the fast-log trigger + the logged-expense list */}
        <div
          role="tabpanel"
          id="budget-view-panel-expenses"
          aria-labelledby="budget-view-tab-expenses"
          hidden={view !== 'expenses'}
          tabIndex={0}
          className="mt-6 focus-visible:outline-none"
        >
          <ExpenseLog
            expenses={expenses}
            onLog={openLogDialog}
            onEdit={openEditDialog}
            onDelete={handleDeleteExpense}
          />
        </div>

        {/* Burn-rate vs plan: rendered from the SAME live `roll` — spent-vs-budget bar, days
            elapsed/remaining, daily avg vs budget, projected end-of-trip total, under/on/over pace.
            No duplicate budget/expense load — it's fed the panel's reactive totals + the clock. */}
        <div
          role="tabpanel"
          id="budget-view-panel-burn"
          aria-labelledby="budget-view-tab-burn"
          hidden={view !== 'burn'}
          tabIndex={0}
          className="mt-6 focus-visible:outline-none"
        >
          <BurnRateView
            budgetHome={roll.totalBudgetHome}
            spentHome={roll.totalSpentHome}
            home={home}
            now={now}
          />
        </div>

        {/* Settle up — who owes whom over the split expenses; empty until ≥1 split. */}
        <div
          role="tabpanel"
          id="budget-view-panel-settle"
          aria-labelledby="budget-view-tab-settle"
          hidden={view !== 'settle'}
          tabIndex={0}
          className="mt-6 focus-visible:outline-none"
        >
          <SettleUpSummary settlements={settlements} />
          {settlements.length === 0 && (
            <p className="empty border-hair border-[color:hsl(var(--border))] p-gut">
              Nothing is split yet, so nobody owes anybody. Log a{' '}
              <strong className="font-semibold text-ink-hi">split</strong> expense on the Expenses
              tab and the minimal set of transfers is printed here.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * THE RULED LEDGER — the empty state as the designed state.
 *
 * The hardest empty state in the app is this one: at three months out `legBudgets` is
 * `{nepal: 0, japan: 0}` and there are zero expenses. Rendering that as "No expenses yet" throws
 * away every fact the app actually holds. So the ledger is drawn instead: all ten real category
 * lines, one column per leg in that leg's own currency, the derived home column, the rates
 * printed in the head with their provenance, and a double-ruled total — ruled and waiting for the
 * first entry rather than captioned as absent.
 *
 * Every figure is READ, never asserted: the categories are `BUDGET_CATEGORIES`, the currencies
 * `legCurrency`, the rates `model.rates` (labelled `seed` only while they still equal
 * `SEED_RATES`), and the amounts the same `expensesToSpent` aggregate the rollup consumes.
 *
 * The home column DROPS below 560px, not clips: it is derived from the leg columns at the rates
 * printed in the head, so nothing unrecoverable leaves the screen.
 */
function Ledger({
  spent,
  model,
  entries,
  home,
}: {
  spent: SpentInput;
  model: BudgetModel;
  entries: number;
  home: CurrencyCode;
}) {
  const seeded = model.rates.NPR === SEED_RATES.NPR && model.rates.JPY === SEED_RATES.JPY;
  const rows = BUDGET_CATEGORIES.map((category, i) => {
    const perLeg = LEGS.map((leg) => safeAmount(spent.byCategory?.[leg]?.[category]));
    const homeTotal = LEGS.reduce(
      (sum, leg, j) => sum + convert(perLeg[j], legCurrency(leg), home, model.rates),
      0,
    );
    return { category, no: String(i + 1).padStart(2, '0'), perLeg, homeTotal };
  });
  const legTotals = LEGS.map((_, j) => rows.reduce((sum, r) => sum + r.perLeg[j], 0));
  const homeGrand = rows.reduce((sum, r) => sum + r.homeTotal, 0);
  const unwritten = entries === 0;
  const cell = 'px-2 py-1.5 text-right whitespace-nowrap border-b-hair border-[color:hsl(var(--border))]';

  return (
    <div data-testid="budget-ledger">
      <div className="sec">
        <h3 className="pr pr--l text-ink-hi">Expense ledger</h3>
        <span className="sub">{unwritten ? 'ruled, unwritten' : `${entries} entries`}</span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {unwritten && <span className="stamp stamp--dry">Unwritten</span>}
        {LEGS.map((leg) => (
          <span key={leg} className="chip">
            {legCurrency(leg)} {ratePerUsd(model.rates, legCurrency(leg))} / {home}
          </span>
        ))}
        <span className="chip">{seeded ? 'seed rates' : 'rates overridden'}</span>
      </div>

      <div className="overflow-x-auto border-hair border-[color:hsl(var(--border))]">
        <table className="w-full border-collapse">
          <caption className="sr-only">
            Logged spend by category, one column per leg in that leg&rsquo;s currency plus the
            total converted to {home}.
          </caption>
          <thead>
            <tr className="border-b-2 border-[color:hsl(var(--border))]">
              <th scope="col" className="pr pr--lo px-2 py-1.5 text-left">No</th>
              <th scope="col" className="pr pr--lo px-2 py-1.5 text-left">Category</th>
              {LEGS.map((leg) => (
                <th key={leg} scope="col" className="pr pr--lo px-2 py-1.5 text-right whitespace-nowrap">
                  {legLabel(leg)} · {legCurrency(leg)}
                </th>
              ))}
              <th scope="col" className="pr pr--lo hidden px-2 py-1.5 text-right min-[560px]:table-cell">
                {home}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const blank = row.homeTotal === 0;
              return (
                <tr key={row.category} data-testid={`budget-ledger-${row.category}`} data-mark={blank ? 'hollow' : undefined}>
                  <td className={`num px-2 py-1.5 border-b-hair border-[color:hsl(var(--border))] ${blank ? 'text-ink-lo' : 'text-ink-mid'}`}>
                    {row.no}
                  </td>
                  <td className={`px-2 py-1.5 capitalize border-b-hair border-[color:hsl(var(--border))] text-t-body ${blank ? 'text-ink-lo' : 'text-ink-hi'}`}>
                    {row.category}
                  </td>
                  {LEGS.map((leg, j) => (
                    <td key={leg} className={`num ${cell} ${row.perLeg[j] > 0 ? 'text-ink-hi' : 'text-ink-lo'}`}>
                      {row.perLeg[j] > 0 ? formatMoney(row.perLeg[j], legCurrency(leg)) : '—'}
                    </td>
                  ))}
                  <td className={`num hidden min-[560px]:table-cell ${cell} ${blank ? 'text-ink-lo' : 'text-ink-hi'}`}>
                    {blank ? '—' : formatMoney(row.homeTotal, home)}
                  </td>
                </tr>
              );
            })}
            {/* The double rule is the ledger's own convention for a closing total. */}
            <tr data-testid="budget-ledger-total" className="border-t-[3px] border-double border-[color:hsl(var(--border))]">
              <td className="px-2 py-2" />
              <td className="pr px-2 py-2 text-left">Total · {entries} {entries === 1 ? 'entry' : 'entries'}</td>
              {LEGS.map((leg, j) => (
                <td key={leg} className="num px-2 py-2 text-right whitespace-nowrap text-ink-hi">
                  {formatMoney(legTotals[j], legCurrency(leg))}
                </td>
              ))}
              <td className="num hidden px-2 py-2 text-right text-ink-hi min-[560px]:table-cell">
                {formatMoney(homeGrand, home)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// the four money views. Order = the money flow: set budget → log spend → check pace → settle.
type MoneyView = 'budget' | 'expenses' | 'burn' | 'settle';
const MONEY_TABS: { id: MoneyView; label: string }[] = [
  { id: 'budget', label: 'Budget' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'burn', label: 'Burn' },
  { id: 'settle', label: 'Settle' },
];

/**
 * Money segmented control — a real WAI-ARIA tablist with roving tabindex + arrow/Home/End
 * keys, so only one money view shows at a time and /plan stays calendar-first. Hand-rolled (no
 * Radix/new dep — the repo has no shared Tabs primitive) but follows the same roving-tabindex a11y
 * contract as `time-picker.tsx`. Reduced-motion-safe (no transitions gate content); focus-visible
 * rings on every tab; ≥44px touch targets. Activation is on click/Arrow (automatic), the common
 * pattern for cheap, already-mounted panels.
 */
function MoneyTabs({ view, onChange }: { view: MoneyView; onChange: (v: MoneyView) => void }) {
  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = MONEY_TABS.findIndex((t) => t.id === view);
    let next = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % MONEY_TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (idx - 1 + MONEY_TABS.length) % MONEY_TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = MONEY_TABS.length - 1;
    else return;
    e.preventDefault();
    const nextId = MONEY_TABS[next].id;
    onChange(nextId);
    // Move focus to the newly-selected tab (roving tabindex).
    (e.currentTarget.querySelector(`#budget-view-tab-${nextId}`) as HTMLElement | null)?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Money views"
      onKeyDown={onKeyDown}
      className="flex gap-1 overflow-x-auto border-b-2 border-[color:hsl(var(--border))] pt-1.5"
    >
      {MONEY_TABS.map((t) => {
        const active = t.id === view;
        return (
          <button
            key={t.id}
            id={`budget-view-tab-${t.id}`}
            data-testid={`budget-view-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`budget-view-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`min-h-tap flex-1 whitespace-nowrap rounded-t-r2 border-hair border-b-0 px-4 font-machine text-t-label uppercase tracking-[0.11em] transition-[translate,background-color] [transition-duration:var(--duration-raise)] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
              active
                ? '-translate-y-[5px] border-[color:var(--border-ui)] bg-[rgb(var(--surface-overlay))] text-ink-hi'
                : 'border-[color:hsl(var(--border))] bg-[rgb(var(--surface-raised))] text-ink-lo hover:text-ink-hi'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
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
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-machine text-t-sm" data-testid={testId}>
      <span className="text-ink-mid">
        Spent{' '}
        <span className="num text-ink-hi" data-testid={`${testId}-spent`}>
          {formatMoney(spentLocal, cur)}
        </span>
      </span>
      <span aria-hidden="true" className="text-ink-lo">
        ·
      </span>
      <span className={over ? 'text-[color:hsl(var(--destructive))]' : 'text-[color:var(--mint)]'}>
        {over ? 'Over by ' : 'Left '}
        <span className="font-semibold" data-testid={`${testId}-remaining`}>
          {formatMoney(Math.abs(remainingLocal), cur)}
        </span>
      </span>
    </p>
  );
}

/**
 * count-up: a money figure that eases up to its value the first time it scrolls
 * into view (reusing the underused `use-count-up` hook, exactly like the dashboard
 * stats). PRESENTATIONAL ONLY — `formatMoney` still formats the REAL number every
 * frame, and the final frame lands on `amount` exactly, so the displayed value is
 * byte-identical to a plain render once settled. Reduced motion is owned by the hook
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
      className="mt-6 flex flex-col gap-3 border-t-[3px] border-double border-[color:hsl(var(--border))] p-gut sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="pr">Total trip budget</p>
        <p className="mt-1 text-t-sm text-ink-mid">
          {LEGS.map(legLabel).join(' + ')}, converted to {home}
        </p>
      </div>
      <div className="sm:text-right">
        <p
          data-testid="budget-grand-total-value"
          aria-live="polite"
          className="num text-n-lg text-ink-hi"
        >
          {formatMoney(roll.totalBudgetHome, home)}
        </p>
        {anySpend && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-machine text-t-sm sm:justify-end">
            <span className="text-ink-mid">
              Spent{' '}
              <CountUpMoney
                amount={roll.totalSpentHome}
                cur={home}
                testId="budget-grand-total-spent"
                className="num text-ink-hi"
              />
            </span>
            <span aria-hidden="true" className="text-ink-lo">
              ·
            </span>
            <span className={over ? 'text-[color:hsl(var(--destructive))]' : 'text-[color:var(--mint)]'}>
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
  const legDraft = useDraftOnBlur(legTotal === 0 ? '' : String(legTotal), onLegBudget);

  return (
    <div
      data-testid={`budget-leg-${leg}`}
      data-leg={leg}
      className="flex flex-col gap-4 border-hair border-[color:hsl(var(--border))] p-gut"
    >
      <div className="sec !mb-0">
        <h3 className="pr pr--l text-ink-hi">{title}</h3>
        <span className="sub">{subtitle}</span>
      </div>

      {/* Leg total budget (in the leg's local currency) */}
      <div className="flex flex-col gap-1">
        <label htmlFor={legInputId} className="pr pr--lo">
          Total budget ({cur})
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-machine text-t-sm text-ink-lo"
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
            placeholder="0"
            {...legDraft}
            className={`num w-full min-h-tap rounded-r1 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface))] py-2 pr-3 text-t-body text-ink-hi placeholder:text-ink-lo focus-visible:border-[color:hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
              sym === 'Rs' ? 'pl-9' : 'pl-7'
            }`}
          />
        </div>
        {/* Home-currency echo of this leg's total (presentation-only). */}
        <p className="font-machine text-t-sm text-ink-mid" data-testid={`budget-leg-${leg}-home`}>
          {home === cur ? (
            <span>Shown in {cur}</span>
          ) : (
            <>
              ≈ <span className="num text-ink-hi">{formatMoney(budgetHome, home)}</span> in {home}
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
      <details className="group border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface))]">
        <summary
          data-testid={`budget-leg-${leg}-categories-toggle`}
          className="pr flex min-h-tap cursor-pointer list-none items-center justify-between px-3 py-2 text-ink-hi transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
          <span>Break down by category (optional)</span>
          <span aria-hidden="true" className="text-ink-lo transition-transform group-open:rotate-90">
            ›
          </span>
        </summary>
        <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
          {BUDGET_CATEGORIES.map((category) => (
            <CategoryBudgetInput
              key={category}
              leg={leg}
              category={category}
              cur={cur}
              sym={sym}
              stored={safeAmount(legCats[category])}
              catRoll={catRollByCategory.get(category)}
              onCommit={(v) => onCategoryBudget(category, v)}
            />
          ))}
        </div>
      </details>
    </div>
  );
}

/** One per-category budget row — its own `useDraftOnBlur` instance so a keystroke in one
 * category's field never re-renders/commits any other row. Preserves every `data-testid`/
 * `id`/`aria-label` byte-for-byte (`e2e` reads `budget-cat-{leg}-{category}` directly). */
function CategoryBudgetInput({
  leg,
  category,
  cur,
  sym,
  stored,
  catRoll,
  onCommit,
}: {
  leg: Leg;
  category: ItineraryCategory;
  cur: CurrencyCode;
  sym: string;
  stored: number;
  catRoll: CategoryRollup | undefined;
  onCommit: (value: string) => void;
}) {
  const colors = CATEGORY_COLORS[category];
  const catId = `budget-cat-${leg}-${category}`;
  // Only show a category's spent/remaining once it HAS a budget set (by design:
  // per-category where a category budget exists).
  const showCatSpend = stored > 0 && (catRoll?.spentLocal ?? 0) >= 0 && !!catRoll;
  const draft = useDraftOnBlur(stored === 0 ? '' : String(stored), onCommit);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3">
        <label
          htmlFor={catId}
          className={`chip min-w-[6.5rem] capitalize ${colors.text}`}
        >
          {category}
        </label>
        <div className="relative flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-machine text-t-micro text-ink-lo"
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
            placeholder="0"
            aria-label={`${category} budget for the ${leg} leg, in ${cur}`}
            {...draft}
            className={`num w-full min-h-tap rounded-r1 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface))] py-1.5 pr-2.5 text-t-sm text-ink-hi placeholder:text-ink-lo focus-visible:border-[color:hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 ${
              sym === 'Rs' ? 'pl-8' : 'pl-6'
            }`}
          />
        </div>
      </div>
      {showCatSpend && catRoll && (
        <p
          className="pl-[calc(6.5rem+0.75rem)] font-machine text-t-micro"
          data-testid={`budget-cat-${leg}-${category}-spent-remaining`}
        >
          <span className="text-ink-mid">Spent {formatMoney(catRoll.spentLocal, cur)}</span>
          <span aria-hidden="true" className="mx-1.5 text-ink-lo">
            ·
          </span>
          <span className={catRoll.remainingLocal < 0 ? 'text-[color:hsl(var(--destructive))]' : 'text-[color:var(--mint)]'}>
            {catRoll.remainingLocal < 0 ? 'over by ' : 'left '}
            {formatMoney(Math.abs(catRoll.remainingLocal), cur)}
          </span>
        </p>
      )}
    </div>
  );
}

