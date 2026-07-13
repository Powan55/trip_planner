'use client';

import { useState, useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import { toast } from 'sonner';
import {
  MapPin, UtensilsCrossed, Camera, ShoppingBag, Trees,
  Landmark, Plane, Hotel, Coffee, Music, X, Check, Users,
} from 'lucide-react';
import { CATEGORY_COLORS, type ItineraryCategory } from '@/lib/trip-data';
import {
  legCurrency, currencySymbol, formatMoney,
  BUDGET_CATEGORIES, type Leg,
} from '@/core/budget/model';
import { useExpenses } from '@/hooks/use-expenses';
import PhotoAttach from '@/components/photo-attach';
import type { Expense } from '@/core/budget/expenses';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { TRAVELERS } from '@/lib/token-auth';

/**
 * Fast expense-log dialog. A lightweight modal, deliberately
 * separate from the itinerary add dialog (`add-to-itinerary-dialog.tsx`), reached via the
 * `expense:open` event + `ExpenseLogHost` — the itinerary quick-add FAB is left single-purpose.
 * It writes expenses THROUGH the reactive store (`useExpenses`), so the budget
 * panel's spent/remaining updates live via the shared CustomEvent.
 *
 * SUB-5s LOG (the UX constraint IS the definition of done): open → amount is AUTOFOCUSED
 * (`inputMode="decimal"`, numeric keypad on mobile) → tap a one-tap category chip → the leg is
 * PRESET (usually correct, no tap) → Save (Enter also saves). Amount + category are the only
 * required fields.
 *
 * MODAL CONTRACT (mirrors AddToItineraryDialog exactly): portal to `document.body`,
 * document-level Esc + Tab-trap + first-field autofocus + parent-owned focus-return (the host's
 * `AnimatePresence onExitComplete`), pinned action footer, and the `body[data-dialog-open]`
 * flag while open. Reduced-motion is honored by framer via the global reduced-motion CSS.
 *
 * EDIT MODE: pass an `expense` and the fields preset from it; Save calls `updateExpense`. Delete
 * lives in the budget panel's list (not here) — this dialog is add/edit only.
 */

const CATEGORY_ICON_MAP: Record<ItineraryCategory, React.ReactNode> = {
  sightseeing: <MapPin className="w-3.5 h-3.5" />,
  food: <UtensilsCrossed className="w-3.5 h-3.5" />,
  photography: <Camera className="w-3.5 h-3.5" />,
  shopping: <ShoppingBag className="w-3.5 h-3.5" />,
  nature: <Trees className="w-3.5 h-3.5" />,
  cultural: <Landmark className="w-3.5 h-3.5" />,
  transportation: <Plane className="w-3.5 h-3.5" />,
  hotel: <Hotel className="w-3.5 h-3.5" />,
  free: <Coffee className="w-3.5 h-3.5" />,
  nightlife: <Music className="w-3.5 h-3.5" />,
};

const LEG_LABEL: Record<Leg, string> = { nepal: 'Nepal', japan: 'Japan' };

export interface ExpenseDialogProps {
  open: boolean;
  /** Preset leg (usually correct with zero taps — resolved by the host from the trip clock). */
  presetLeg: Leg;
  /** Preset date the expense is attributed to ('YYYY-MM-DD'); optional. */
  presetDate?: string;
  /** Edit mode: an existing expense to preset from + update on Save. Absent ⇒ add mode. */
  expense?: Expense;
  onClose(): void;
}

export default function ExpenseDialog({
  open,
  presetLeg,
  presetDate,
  expense,
  onClose,
}: ExpenseDialogProps) {
  const { addExpense, updateExpense } = useExpenses();
  const { traveler } = useActiveTraveler();
  const isEdit = expense != null;
  // The "me" default for the payer (the active traveler; falls back to the first roster name for a
  // guest — the /plan gate means an active traveler is the norm). All roster names for the members.
  const meName = traveler?.name ?? TRAVELERS[0].name;
  const allNames = TRAVELERS.map((t) => t.name);

  // Portal mount guard: `createPortal(…, document.body)` must not run during the
  // static-export prerender. The dialog only mounts on a user action (post-hydration), so this
  // is satisfied immediately on open; it keeps `document` untouched on the server.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Live ref to the latest onClose so the once-registered Esc listener always calls the current
  // closure without re-binding every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Form state. Amount is a raw string (controlled) so a mid-edit blank is possible; the store
  // sanitizes on write. Leg/category preset from the edit target else the props.
  const [amount, setAmount] = useState<string>('');
  const [leg, setLeg] = useState<Leg>(presetLeg);
  const [category, setCategory] = useState<ItineraryCategory>('food');
  const [note, setNote] = useState<string>('');
  // Split — opt-in, default collapsed = the fast path. `paidBy` defaults to me; `members`
  // to everyone (an even split among the whole roster). Enabling with ≥1 member writes paidBy+split.
  const [splitOn, setSplitOn] = useState<boolean>(false);
  const [paidBy, setPaidBy] = useState<string>(meName);
  const [splitMembers, setSplitMembers] = useState<string[]>(allNames);

  // Re-seed the form whenever the dialog (re)opens, so a reused instance never shows stale values.
  useEffect(() => {
    if (!open) return;
    if (expense) {
      setAmount(expense.amount > 0 ? String(expense.amount) : '');
      setLeg(expense.leg);
      setCategory(expense.category);
      setNote(expense.note ?? '');
      const hasSplit = Array.isArray(expense.split) && expense.split.length > 0;
      setSplitOn(hasSplit);
      setPaidBy(expense.paidBy ?? meName);
      setSplitMembers(hasSplit ? expense.split! : allNames);
    } else {
      setAmount('');
      setLeg(presetLeg);
      setCategory('food');
      setNote('');
      setSplitOn(false);
      setPaidBy(meName);
      setSplitMembers(allNames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id, presetLeg]);

  const toggleMember = (name: string) => {
    setSplitMembers((prev) =>
      prev.includes(name) ? prev.filter((m) => m !== name) : [...prev, name],
    );
  };

  // Stable ids for label/aria wiring.
  const baseId = useId();
  const titleId = `${baseId}-modal-title`;
  const amountFieldId = `${baseId}-amount`;
  const categoryLabelId = `${baseId}-category-label`;
  const legLabelId = `${baseId}-leg-label`;
  const noteFieldId = `${baseId}-note`;

  const panelRef = useRef<HTMLDivElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const cur = legCurrency(leg);
  const sym = currencySymbol(cur);
  const numericAmount = amount === '' ? NaN : Number(amount);
  const amountValid = Number.isFinite(numericAmount) && numericAmount > 0;
  // Save is blocked until a positive amount (category always has a value — chips, not empty).
  const saveDisabled = !amountValid;

  const handleSave = () => {
    if (!amountValid) return; // guard (the button is also disabled)
    const value = Number(amount);
    const trimmedNote = note.trim();
    // Split fields: ON ⇒ payer + members; OFF ⇒ undefined (add: dropped by sanitize = byte-identical
    // fast path; edit: explicitly CLEARS a previously-split expense back to the fast path).
    const splitOK = splitOn && splitMembers.length > 0;
    const splitFields = {
      paidBy: splitOK ? paidBy : undefined,
      split: splitOK ? splitMembers : undefined,
    };
    if (isEdit && expense) {
      updateExpense(expense.id, {
        leg,
        category,
        amount: value,
        date: presetDate,
        note: trimmedNote || undefined,
        ...splitFields,
      });
      toast.success(`Updated ${formatMoney(value, cur)} ${category}`);
    } else {
      addExpense({
        leg,
        category,
        amount: value,
        date: presetDate,
        note: trimmedNote || undefined,
        ...splitFields,
      });
      toast.success(`Logged ${formatMoney(value, cur)} ${category}`);
    }
    onClose();
  };

  // On open: focus the amount input (the autofocus target — the sub-5s "type first" field).
  // Re-assert shortly after in case the open animation steals focus.
  useEffect(() => {
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (panel && !panel.contains(document.activeElement)) {
        amountInputRef.current?.focus();
        amountInputRef.current?.select();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // body[data-dialog-open] flag (cross-lane seam): the itinerary FAB hides while it is set, so the
  // FAB never floats over this dialog's scrim. Set while mounted-open, cleared on close/unmount.
  useEffect(() => {
    const body = document.body;
    body.dataset.dialogOpen = '1';
    return () => {
      delete body.dataset.dialogOpen;
    };
  }, []);

  // Esc closes at the document level so it fires wherever focus sits.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Lightweight Tab-trap inside the panel (no new deps), identical to AddToItineraryDialog.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;

    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!mounted) return null;

  return createPortal(
    <m.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <m.div
        ref={panelRef}
        data-testid="expense-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full max-w-md glass-card-dark rounded-2xl shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
      >
        {/* Pinned header */}
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 sm:pt-6 pb-4 shrink-0">
          <div className="min-w-0">
            <h3 id={titleId} className="font-display text-lg font-bold text-white leading-tight">
              {isEdit ? 'Edit expense' : 'Log an expense'}
            </h3>
            <p className="text-sm text-white/60 mt-0.5 truncate">
              {isEdit ? 'Update the amount, category, or leg.' : 'A meal, a taxi, a ticket — a few taps.'}
            </p>
          </div>
          <button
            type="button"
            data-testid="expense-cancel"
            onClick={onClose}
            aria-label="Close dialog"
            className="shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg hover:bg-white/10 text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6">
          <div className="space-y-4 pb-1">
            {/* Amount — the autofocused, "type first" field */}
            <div>
              <label htmlFor={amountFieldId} className="text-xs text-white/50 mb-1 block">
                Amount ({cur}) *
              </label>
              <div className="relative">
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-white/40 ${sym === 'Rs' ? 'left-3 text-sm' : 'left-3 text-base'}`}
                >
                  {sym}
                </span>
                <input
                  id={amountFieldId}
                  ref={amountInputRef}
                  data-testid="expense-amount-input"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={amount}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    // Enter saves from the amount field (sub-5s: type → Enter).
                    if (e.key === 'Enter' && !saveDisabled) {
                      e.preventDefault();
                      handleSave();
                    }
                  }}
                  placeholder="0"
                  autoComplete="off"
                  className={`w-full rounded-lg border border-white/15 bg-navy-900/60 py-2.5 pr-3 text-base text-white placeholder:text-white/30 focus:outline-none focus-visible:border-gold-400/60 focus-visible:ring-2 focus-visible:ring-gold-400/40 ${sym === 'Rs' ? 'pl-9' : 'pl-8'}`}
                />
              </div>
            </div>

            {/* Leg toggle — preset, one tap to override */}
            <div>
              <span id={legLabelId} className="text-xs text-white/50 mb-1 block">Leg</span>
              <div
                role="radiogroup"
                aria-labelledby={legLabelId}
                data-testid="expense-leg-toggle"
                className="flex gap-2"
              >
                {(['nepal', 'japan'] as Leg[]).map((l) => {
                  const active = leg === l;
                  return (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setLeg(l)}
                      data-testid={`expense-leg-${l}`}
                      className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none ${
                        active
                          ? 'border-gold-400 bg-gold-400/15 text-gold-300'
                          : 'border-white/15 text-white/70 hover:bg-white/5'
                      }`}
                    >
                      <span aria-hidden="true">{currencySymbol(legCurrency(l))}</span>
                      {LEG_LABEL[l]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category chips — one-tap, always a value (required, no empty state) */}
            <div>
              <span id={categoryLabelId} className="text-xs text-white/50 mb-1 block">Category *</span>
              <div className="grid grid-cols-4 sm:grid-cols-5 gap-2" role="group" aria-labelledby={categoryLabelId}>
                {BUDGET_CATEGORIES.map((cat) => {
                  const colors = CATEGORY_COLORS[cat];
                  const isActive = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategory(cat)}
                      aria-pressed={isActive}
                      aria-label={`Category: ${cat}`}
                      data-testid={`expense-category-${cat}`}
                      className={`flex flex-col items-center justify-start gap-1 min-h-[3rem] px-1 py-2 rounded-lg text-xs transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                        isActive ? `${colors.bg} ${colors.text} ring-1 ${colors.border}` : 'text-white/60 hover:bg-white/5'
                      }`}
                    >
                      {CATEGORY_ICON_MAP[cat]}
                      <span className="capitalize text-[10px] leading-tight text-center break-words w-full">{cat}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note (optional) */}
            <div>
              <label htmlFor={noteFieldId} className="text-xs text-white/50 mb-1 block">Note</label>
              <input
                id={noteFieldId}
                data-testid="expense-note-input"
                value={note}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNote(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
                placeholder="e.g., Ramen at Ichiran"
                autoComplete="off"
              />
            </div>

            {/* Split — opt-in. Collapsed = the fast path (nothing written). */}
            <div className="rounded-lg border border-white/10 bg-white/[0.02]">
              <button
                type="button"
                data-testid="expense-split-toggle"
                aria-expanded={splitOn}
                onClick={() => setSplitOn((v) => !v)}
                className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm text-white/80 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
              >
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-gold-400" aria-hidden="true" />
                  Split with others
                </span>
                <span aria-hidden="true" className={`text-white/40 transition-transform ${splitOn ? 'rotate-90' : ''}`}>
                  ›
                </span>
              </button>

              {splitOn && (
                <div className="flex flex-col gap-3 px-3 pb-3 pt-1" data-testid="expense-split-panel">
                  {/* Payer */}
                  <div>
                    <span id={`${baseId}-payer-label`} className="text-xs text-white/50 mb-1 block">Paid by</span>
                    <div role="radiogroup" aria-labelledby={`${baseId}-payer-label`} className="flex flex-wrap gap-2">
                      {TRAVELERS.map((t) => {
                        const active = paidBy === t.name;
                        return (
                          <button
                            key={t.name}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setPaidBy(t.name)}
                            data-testid={`expense-payer-${t.name}`}
                            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                              active ? 'border-gold-400 bg-gold-400/15 text-gold-300' : 'border-white/15 text-white/70 hover:bg-white/5'
                            }`}
                          >
                            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: t.accent }} />
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Members (split evenly among) */}
                  <div>
                    <span id={`${baseId}-members-label`} className="text-xs text-white/50 mb-1 block">Split evenly among</span>
                    <div role="group" aria-labelledby={`${baseId}-members-label`} className="flex flex-wrap gap-2">
                      {TRAVELERS.map((t) => {
                        const active = splitMembers.includes(t.name);
                        return (
                          <button
                            key={t.name}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleMember(t.name)}
                            data-testid={`expense-split-member-${t.name}`}
                            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                              active ? 'border-gold-400 bg-gold-400/15 text-gold-300' : 'border-white/15 text-white/50 hover:bg-white/5'
                            }`}
                          >
                            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: t.accent }} />
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                    {splitMembers.length === 0 ? (
                      <p className="mt-1.5 text-xs text-gold-300/80" data-testid="expense-split-hint">
                        Pick at least one person, or this stays a personal expense.
                      </p>
                    ) : (
                      <p className="mt-1.5 text-xs text-white/50" data-testid="expense-split-hint">
                        {amountValid
                          ? `${formatMoney(Number(amount) / splitMembers.length, cur)} each`
                          : `Split ${splitMembers.length} ways`}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Receipt photos. Edit-mode only: a receipt attaches by the expense's id, which
                exists only after the row is saved (log first, then edit to add a receipt). Local-only
                IndexedDB blobs, zero egress — no photo field ever touches the synced Expense. */}
            {isEdit && expense && (
              <PhotoAttach
                owner={{ kind: 'expense', expenseId: expense.id }}
                heading="Receipt"
                altPlaceholder="e.g. Ramen receipt, Ichiran"
              />
            )}
          </div>
        </div>

        {/* Pinned action footer */}
        <div className="shrink-0 px-5 sm:px-6 pt-4 pb-5 sm:pb-6 border-t border-white/10 bg-navy-900/40">
          <button
            onClick={handleSave}
            data-testid="expense-save"
            disabled={saveDisabled}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gold-500 text-navy-900 font-semibold hover:bg-gold-400 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-gold-500"
          >
            <Check className="w-4 h-4" />
            {isEdit ? 'Update expense' : 'Save expense'}
          </button>
        </div>
      </m.div>
    </m.div>,
    document.body,
  );
}
