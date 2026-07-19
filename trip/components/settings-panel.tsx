'use client';

import { useEffect, useRef, useState } from 'react';
import {
  User,
  LogOut,
  Coins,
  Info,
  RefreshCw,
  DatabaseZap,
  Trash2,
  Download,
  Upload,
  AlertTriangle,
  KeyRound,
  Plus,
  Copy,
  Check,
  Share2,
  ShieldAlert,
} from 'lucide-react';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { signOut } from '@/lib/token-auth';
import { setActiveTripId, getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
import { getTripId } from '@/lib/firebase-config';
import { withBasePath } from '@/lib/utils';
import { useBudget } from '@/hooks/use-budget';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useExpenses } from '@/hooks/use-expenses';
import { useJournal } from '@/hooks/use-journal';
import { expensesToCsv } from '@/lib/expense-csv';
import { exportExpenses, parseExpenseBackup } from '@/lib/expense-export';
import { compressToBlob, decompressBlobOrText, supportsCompression } from '@/core/vault/compression';
import {
  currencySymbol,
  CURRENCIES,
  SEED_RATES,
  type CurrencyCode,
} from '@/core/budget/model';
import BackupRestore from '@/components/backup-restore';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

/**
 * Settings page panel — a grouped, progressively-disclosed
 * `/settings` island, mounted once via `app/settings/sections.tsx`. Collapsible
 * groups built on native `<details>/<summary>`:
 *
 * 1. IDENTITY — the active traveler's name + Sign out (clears the nickname via `signOut`,
 * which fires `identity:changed` → `TokenGate` re-shows the front-door wall). A sign-out is
 * recoverable by re-entering the token, so it needs no confirm.
 *
 * 2. CURRENCY & RATES — the home/display-currency toggle + the two exchange-rate overrides,
 * RELOCATED verbatim from `budget-panel.tsx`. The write path is IDENTICAL — still
 * `useBudget().commit(() => next)` — so budget sync is
 * untouched; only the rendering location changed. Testids are preserved (`budget-currency-*`,
 * `budget-rate-*`) so the DOM contract is stable, just on `/settings` now.
 *
 * 3. DATA MANAGEMENT — Export/Import surfaced via the reused `<BackupRestore>` panel (
 * discoverable here), plus per-domain "clear all" actions behind Radix `AlertDialog` confirms.
 * Each clear REUSES its domain's proven mechanic so it PROPAGATES under sync and stays cleared
 * on reload:
 * - Itinerary → `clearAll()` folds `clearDay`'s tombstone-all over every day in ONE commit.
 * - Expenses → `clearAll()` tombstones all rows via the delete path in ONE commit.
 * - Budget → `reset()` LWW-writes the seed with a fresh HLC so it wins the next merge.
 * - Journal → `clearAll()` is a LOCAL wipe ONLY.
 * Dormant, every clear is a plain local wipe.
 *
 * A11y / house style: dark glassmorphism, labelled disclosure buttons, ≥44px touch targets,
 * visible focus rings, `aria-live` on the sign-out state. No notifications group.
 */

export default function SettingsPanel() {
  const { traveler } = useActiveTraveler();

  // Post-mount gate: `useActiveTraveler` yields the inert signed-out snapshot on the server + first
  // paint. Read the resolved name only after mount so the identity row never flashes a wrong value.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const name = mounted ? traveler?.name ?? null : null;

  return (
    <section
      aria-labelledby="settings-title"
      className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
      data-testid="settings-panel"
    >
      <div className="flex flex-col gap-4">
        <SettingsGroup
          testId="settings-group-identity"
          icon={<User className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />}
          title="Identity"
          summary="Who your edits are attributed to"
          defaultOpen
        >
          <IdentityGroup name={name} />
        </SettingsGroup>

        <SettingsGroup
          testId="settings-group-trip"
          icon={<KeyRound className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />}
          title="Trip"
          summary="Create a new trip, join one by key, or share this trip"
        >
          <TripGroup />
        </SettingsGroup>

        <SettingsGroup
          testId="settings-group-currency"
          icon={<Coins className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />}
          title="Currency & rates"
          summary="Display currency and exchange-rate overrides"
        >
          <CurrencyGroup />
        </SettingsGroup>

        <SettingsGroup
          testId="settings-group-data"
          icon={<DatabaseZap className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />}
          title="Data management"
          summary="Back up, restore, or clear your trip data"
        >
          <DataGroup />
        </SettingsGroup>
      </div>
    </section>
  );
}

/** A collapsible settings group — native `<details>` for keyboard + a11y with zero JS state. */
function SettingsGroup({
  testId,
  icon,
  title,
  summary,
  defaultOpen,
  children,
}: {
  testId: string;
  icon: React.ReactNode;
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      data-testid={testId}
      className="group glass-card overflow-hidden rounded-2xl"
    >
      <summary
        data-testid={`${testId}-toggle`}
        className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 px-6 py-4 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-400/50 sm:px-8"
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-bold text-white">{title}</span>
          <span className="block text-sm text-white/60">{summary}</span>
        </span>
        <span
          aria-hidden="true"
          className="text-white/40 transition-transform group-open:rotate-90"
        >
          ›
        </span>
      </summary>
      <div className="border-t border-white/10 px-6 py-6 sm:px-8">{children}</div>
    </details>
  );
}

/** Identity group: the signed-in traveler + a Sign out control. */
function IdentityGroup({ name }: { name: string | null }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-xs uppercase tracking-widest text-white/40">Signed in as</p>
        <p
          data-testid="settings-identity-name"
          aria-live="polite"
          className="mt-1 font-display text-2xl font-bold text-gradient-gold"
        >
          {name ?? 'Guest'}
        </p>
        <p className="mt-1 max-w-md text-sm text-white/60">
          {name
            ? 'Your itinerary edits are attributed to you across the shared trip.'
            : 'You are browsing locally. Sign in with a nickname to attribute your edits.'}
        </p>
      </div>
      <button
        type="button"
        onClick={() => signOut()}
        data-testid="settings-sign-out"
        className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Sign out
      </button>
    </div>
  );
}

/**
 * Trip group — create a new trip, join one by its Trip Key, and share the
 * current trip. All three reuse the pack-switch primitive VERBATIM: `setActiveTripId(id)`
 * then a full page reload (no live re-hydration). Create mints a fresh `crypto.randomUUID()`
 * capability token; join accepts a pasted key (only non-empty is validated — an
 * unknown key just resolves to an empty, harmless, never-synced trip,). The current Trip Key
 * is `getTripId()` (the REMOTE capability token) — treated as a SECRET in copy: anyone holding it
 * can read+write this trip.
 *
 * Deliberately NOT inside `TokenGate`: the front-door wall stays a zero-regression surface;
 * trip management is an opt-in Settings action most default-pack demo visitors never touch.
 */
function TripGroup() {
  const [tripKey, setTripKey] = useState<string | null>(null);
  const [joinValue, setJoinValue] = useState('');
  const [copied, setCopied] = useState<'key' | 'link' | null>(null);
  // True once mounted iff the browser is on a non-default (shared/created) pack — drives the
  // "Switch to my main trip" affordance. SSR-false so the button never flashes on the
  // grandfathered default pack; read client-side like the trip key below.
  const [onSharedTrip, setOnSharedTrip] = useState(false);

  // Read the active trip's remote token + pack identity after mount (client-only; ssr:false island).
  useEffect(() => {
    setTripKey(getTripId());
    setOnSharedTrip(getActiveTripId() !== DEFAULT_TRIP_ID);
  }, []);

  const shareLink =
    tripKey !== null && typeof window !== 'undefined'
      ? `${window.location.origin}${withBasePath('/')}?trip=${encodeURIComponent(tripKey)}`
      : '';

  const copy = async (text: string, which: 'key' | 'link') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
    } catch {
      /* clipboard blocked (permissions / insecure context) — the value stays visible to select. */
    }
  };

  // switch: write the pointer, then full reload (this route) — the pack re-hydrates fresh.
  const createTrip = () => {
    setActiveTripId(crypto.randomUUID());
    window.location.reload();
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const id = joinValue.trim();
    if (!id) return; // non-empty is the only possible/needed validation
    setActiveTripId(id);
    window.location.reload();
  };

  // — always a way back to the grandfathered default pack. Writing DEFAULT_TRIP_ID makes
  // getActiveTripId() id-equal the default, so keyFor() grandfathers every slot back to the legacy
  // literal keys and the user sees their own main-trip data again. switch = write + reload.
  const switchToMain = () => {
    setActiveTripId(DEFAULT_TRIP_ID);
    window.location.reload();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* On a non-default pack only: banner + a way back to the grandfathered main trip. */}
      {onSharedTrip && (
        <div
          data-testid="settings-trip-shared-banner"
          className="rounded-xl border border-gold-400/40 bg-gold-400/[0.06] p-4 sm:p-5"
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldAlert className="h-4 w-4 shrink-0 text-gold-400" aria-hidden="true" />
            You&rsquo;re on a shared trip
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            This browser is viewing a trip you created or joined. Your own itinerary and data are
            safe on your main trip — switch back any time.
          </p>
          <button
            type="button"
            onClick={switchToMain}
            data-testid="settings-trip-switch-main"
            className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gold-400/60 px-4 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Switch to my main trip
          </button>
        </div>
      )}

      {/* Current Trip Key — the shareable secret for THIS trip. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">This trip&rsquo;s key</h3>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-white/50">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Treat this like a password — anyone with this key can view and edit this trip.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code
            data-testid="settings-trip-key"
            className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-surface/60 px-3 py-2.5 font-mono text-sm text-white/80"
          >
            {tripKey ?? '…'}
          </code>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => tripKey && copy(tripKey, 'key')}
              disabled={!tripKey}
              data-testid="settings-trip-key-copy"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
            >
              {copied === 'key' ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied === 'key' ? 'Copied' : 'Copy key'}
            </button>
            <button
              type="button"
              onClick={() => shareLink && copy(shareLink, 'link')}
              disabled={!shareLink}
              data-testid="settings-trip-link-copy"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
            >
              {copied === 'link' ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Share2 className="h-4 w-4" aria-hidden="true" />
              )}
              {copied === 'link' ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
        <div aria-live="polite" className="sr-only">
          {copied === 'key' ? 'Trip key copied to clipboard' : copied === 'link' ? 'Share link copied to clipboard' : ''}
        </div>
      </div>

      {/* Create a brand-new trip. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">Start a new trip</h3>
        <p className="mt-1 max-w-2xl text-sm text-white/60">
          Creates a fresh, empty trip with its own key. You&rsquo;ll switch to it now; share its key
          to plan together.
        </p>
        <button
          type="button"
          onClick={createTrip}
          data-testid="settings-trip-create"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gold-400/60 px-4 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create new trip
        </button>
      </div>

      {/* Join an existing trip by pasting its Trip Key. */}
      <form
        onSubmit={join}
        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
      >
        <h3 className="text-sm font-semibold text-white">Join a trip</h3>
        <p className="mt-1 max-w-2xl text-sm text-white/60">
          Paste a Trip Key someone shared with you to switch this browser to their trip.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="settings-trip-join" className="sr-only">
            Trip key to join
          </label>
          <input
            id="settings-trip-join"
            value={joinValue}
            onChange={(e) => setJoinValue(e.target.value)}
            placeholder="Paste a Trip Key"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            data-testid="settings-trip-join-input"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 font-mono text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
          />
          <button
            type="submit"
            disabled={!joinValue.trim()}
            data-testid="settings-trip-join-submit"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            Join trip
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Currency & rates group — the home-currency toggle + exchange-rate overrides RELOCATED from
 * `budget-panel.tsx`. Write path unchanged (`useBudget().commit`) so budget sync is unaffected.
 */
function CurrencyGroup() {
  const { model, commit } = useBudget();

  const setHomeCurrency = (home: CurrencyCode) => {
    commit((cur) => ({ ...cur, homeCurrency: home }));
  };

  const setRate = (currency: 'NPR' | 'JPY', value: string) => {
    // Keep the raw typed number; the pure math seed-defaults a 0/blank at read time, so a mid-edit
    // blank never breaks the totals. '' parses to 0, which `ratePerUsd` treats as "fall back to seed".
    const n = value === '' ? 0 : Number(value);
    const rate = Number.isFinite(n) ? n : 0;
    commit((cur) => ({ ...cur, rates: { ...cur.rates, [currency]: rate } }));
  };

  const resetRates = () => {
    commit((cur) => ({ ...cur, rates: { ...SEED_RATES } }));
  };

  const home = model.homeCurrency;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
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
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
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
          Approximate defaults — edit to match today&apos;s rate. Units per 1 US dollar.
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
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Reset to defaults
        </button>
      </fieldset>
    </div>
  );
}

/** A labelled numeric rate input with its seed shown as the placeholder/hint (moved from budget-panel). */
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
  // Show the empty string when the stored rate is the "unset" sentinel 0 (so the placeholder seed
  // shows through); otherwise the typed number. This keeps a mid-edit blank possible.
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
        className="w-full rounded-lg border border-white/15 bg-surface/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
      />
    </div>
  );
}

/** Data-management group: Export/Import (reused BackupRestore) + per-domain clears behind confirms. */
function DataGroup() {
  const { clearAll: clearItinerary } = useItineraryContext();
  const { expenses, clearAll: clearExpenses, restoreExpenses } = useExpenses();
  const { reset: resetBudget } = useBudget();
  const { clearAll: clearJournal } = useJournal();

  // — CSV export of the logged expenses (read-only over `useExpenses`; no store change).
  // Mirrors BackupRestore's Blob/URL.createObjectURL download idiom exactly.
  const handleExportCsv = () => {
    const csv = expensesToCsv(expenses);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nepal-japan-expenses.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Export / Import — the reused panel, discoverable from settings. */}
      <BackupRestore />

      {/* Expense CSV export — a spreadsheet-ready sibling to the whole-trip JSON export
          above. Disabled when there is nothing to export (empty-safe: no zero-row file). */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">Export expenses</h3>
        <p className="mt-1 max-w-2xl text-sm text-white/60">
          Download every logged expense as a spreadsheet-ready CSV file.
        </p>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={expenses.length === 0}
          data-testid="settings-export-expenses-csv"
          className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export expenses (CSV)
        </button>
      </div>

      {/* Expenses backup / restore JSON — expenses get their OWN export
          file/schema, NOT an extension of the itinerary Vault above. */}
      <ExpensesBackupRestore expenses={expenses} restoreExpenses={restoreExpenses} />

      {/* Per-domain clears — each behind a Radix AlertDialog confirm. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">Clear trip data</h3>
        <p className="mt-1 max-w-2xl text-sm text-white/60">
          Permanently remove data for one area of the trip. On a shared trip this clears it for
          everyone; the journal is always private to this device.
        </p>
        <ul className="mt-4 flex flex-col divide-y divide-white/10">
          <ClearRow
            testId="settings-clear-itinerary"
            label="Itinerary"
            description="Every planned activity across all days."
            title="Clear the whole itinerary?"
            body="This removes every planned activity from all 32 days. On a shared trip it clears the itinerary for everyone. This cannot be undone."
            confirmLabel="Clear itinerary"
            onConfirm={clearItinerary}
          />
          <ClearRow
            testId="settings-clear-expenses"
            label="Expenses"
            description="Every logged expense and split."
            title="Clear all expenses?"
            body="This removes every logged expense. On a shared trip it clears expenses for everyone. This cannot be undone."
            confirmLabel="Clear expenses"
            onConfirm={clearExpenses}
          />
          <ClearRow
            testId="settings-clear-budget"
            label="Budget"
            description="Reset budgets and rates to defaults."
            title="Reset the budget?"
            body="This resets every leg and category budget and the exchange rates back to the seeded defaults. On a shared trip it resets the budget for everyone. This cannot be undone."
            confirmLabel="Reset budget"
            onConfirm={resetBudget}
          />
          <ClearRow
            testId="settings-clear-journal"
            label="Journal"
            description="Every private journal entry (this device only)."
            title="Clear the journal?"
            body="This removes every journal entry. The journal is private to this device and is never shared, so this only affects this browser. This cannot be undone."
            confirmLabel="Clear journal"
            onConfirm={clearJournal}
          />
        </ul>
      </div>
    </div>
  );
}

/**
 * Expenses backup/restore — mirrors `<BackupRestore>`'s export/confirm/import
 * shape, but over the expenses-only schema (`lib/expense-export.ts`) instead of the itinerary Vault.
 * Restore composes with `useExpenses().restoreExpenses` (tombstone-replace under sync,; a
 * plain overwrite dormant,) — the SAME merge machinery `clearAll`/`restorePlans` use. The
 * confirm step reuses the app's Radix `AlertDialog` (already imported here) CONTROLLED by
 * `pendingImport`, rather than duplicating BackupRestore's bespoke portal dialog.
 */
function ExpensesBackupRestore({
  expenses,
  restoreExpenses,
}: {
  expenses: ReturnType<typeof useExpenses>['expenses'];
  restoreExpenses: ReturnType<typeof useExpenses>['restoreExpenses'];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<{ text: string; name: string } | null>(null);
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const handleExport = async () => {
    const json = exportExpenses(expenses);
    // same gzip-via-CompressionStream helper the itinerary export uses, shared rather
    // than re-implemented — feature-detects and falls back to plain bytes automatically.
    const blob = await compressToBlob(json);
    const filename = supportsCompression() ? 'nepal-japan-expenses.json.gz' : 'nepal-japan-expenses.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus({ kind: 'success', message: `Exported your expenses to ${filename}.` });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      // auto-detects gzip vs plain by magic bytes, so old plain-JSON expense backups
      // still import.
      const text = await decompressBlobOrText(file);
      setStatus({ kind: 'idle' });
      setPendingImport({ text, name: file.name });
    } catch {
      setStatus({ kind: 'error', message: 'Could not read that file. No changes were made to your expenses.' });
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    const parsed = parseExpenseBackup(pendingImport.text);
    setPendingImport(null);
    if (parsed.ok) {
      restoreExpenses(parsed.expenses);
      setStatus({
        kind: 'success',
        message: 'Expenses imported. Your logged expenses have been replaced with the backup.',
      });
    } else {
      setStatus({ kind: 'error', message: parsed.error });
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <h3 className="text-sm font-semibold text-white">Expenses backup</h3>
      <p className="mt-1 max-w-2xl text-sm text-white/60">
        Save your logged expenses to a file, or restore them from a backup. This is a separate file
        from the whole-trip export above — it covers expenses only.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleExport}
          data-testid="settings-export-expenses-json"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export expenses (JSON)
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="settings-import-expenses-trigger"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gold-400/60 px-4 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Upload className="h-4 w-4" aria-hidden="true" />
          Restore expenses
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          data-testid="settings-import-expenses-input"
          aria-label="Choose an expenses backup file to restore"
          className="sr-only"
        />
      </div>

      <div aria-live="polite" className="mt-3 min-h-[1.25rem]">
        {status.kind === 'success' && (
          <p data-testid="settings-import-expenses-status" className="text-sm font-medium text-green-300">
            {status.message}
          </p>
        )}
        {status.kind === 'error' && (
          <p
            data-testid="settings-import-expenses-error"
            role="alert"
            className="flex items-center gap-2 text-sm font-medium text-red-300"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {status.message}
          </p>
        )}
      </div>

      <AlertDialog
        open={pendingImport !== null}
        onOpenChange={(open) => {
          // Only clears the pending file (covers Escape / outside-click / either button's
          // own auto-close) — NEVER touches `status` here, so it can't race and clobber the
          // success/error `confirmImport` just set in the SAME click ( fail-safe evidence
          // must stay visible to the user).
          if (!open) setPendingImport(null);
        }}
      >
        <AlertDialogContent
          className="glass-card-dark border-white/10 text-white"
          data-testid="settings-import-expenses-dialog"
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your logged expenses?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Importing <span className="font-medium text-white">{pendingImport?.name}</span> will
              replace your current expenses with the contents of that file. On a shared trip this
              replaces expenses for everyone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-testid="settings-import-expenses-cancel"
              onClick={() => setStatus({ kind: 'idle' })}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="settings-import-expenses-confirm"
              onClick={confirmImport}
              className="bg-rose-500 text-white hover:bg-rose-400"
            >
              Replace expenses
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One clear-data row: a label + a destructive "Clear" button that opens a confirm dialog. */
function ClearRow({
  testId,
  label,
  description,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  testId: string;
  label: string;
  description: string;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{label}</p>
        <p className="text-xs text-white/55">{description}</p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button
            type="button"
            data-testid={testId}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-rose-400/40 px-3 py-2 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Clear
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent
          className="glass-card-dark border-white/10 text-white"
          data-testid={`${testId}-dialog`}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">{body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid={`${testId}-cancel`}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid={`${testId}-confirm`}
              onClick={onConfirm}
              className="bg-rose-500 text-white hover:bg-rose-400"
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
