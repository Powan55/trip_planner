'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
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
  Copy,
  Check,
  Share2,
  ShieldAlert,
  Smartphone,
} from 'lucide-react';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { signIn, DEFAULT_TRAVELER_NAME } from '@/lib/token-auth';
import { itemMatchesAuthor, type AuthorFilter } from '@/lib/author-filter';
import {
  getActiveTripId,
  DEFAULT_TRIP_ID,
  getSyncCode,
  setSyncCode,
  identityStore,
} from '@/core/storage/gateway';
import SignOutConfirm from '@/components/sign-out-confirm';
import { joinTrip } from '@/core/trips/registry';
import { getTripId, isRemoteConfigured } from '@/lib/firebase-config';
import { withBasePath } from '@/lib/utils';
import { useBudget } from '@/hooks/use-budget';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useExpenses } from '@/hooks/use-expenses';
import { useDocs } from '@/hooks/use-docs';
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
 * 1. IDENTITY — the active traveler's name + Sign out. made sign-out a FULL LOCAL
 * TEARDOWN, not just an identity clear (`wipeAllTripData()` — every trip-scoped domain in
 * BOTH namespaces, plus the app-scoped pointers/lists and `travelMode`) — the previous
 * traveler's trip data must not leak to the next person on a shared device. That makes it a
 * real, unrecoverable-in-this-window destructive action, so it is confirm-gated (via the
 * shared `<SignOutConfirm>`) with a backup offer, not the old no-confirm click. "Forget this
 * device" goes further still and also deletes every photo stored on this device.
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

  /**
   * a capability SECRET — this trip's Trip Token, its `?trip=` share link, and the
   * personal User Token — requires an identified traveler, as does every trip-mutating registry
   * action (create / add / switch). With no guest mode, an unidentified visitor never
   * visibly reaches this page — TokenGate's wall covers it — but `{children}` still mounts
   * underneath the wall, so this gate is kept as defense-in-depth against showing a capability
   * secret on that hidden render. False until mounted so nothing flashes before storage is read.
   */
  const identified = mounted && traveler !== null;

  return (
    <section
      aria-labelledby="settings-title"
      className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
      data-testid="settings-panel"
    >
      <div className="flex flex-col gap-4">
        <SettingsGroup
          testId="settings-group-identity"
          icon={<User className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          title="Identity"
          summary="Who your edits are attributed to"
          defaultOpen
        >
          <IdentityGroup name={name} />
        </SettingsGroup>

        <SettingsGroup
          testId="settings-group-trip"
          icon={<KeyRound className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          title="Trip"
          summary="Create a trip, add one by Trip Token, or share this trip"
        >
          {identified ? <TripGroup /> : <SignInRequired what="trip" />}
        </SettingsGroup>

        <SettingsGroup
          testId="settings-group-sync"
          icon={<Smartphone className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          title="Your key"
          summary="Your account key — log in with it on another device to see the same trips"
        >
          {identified ? <SyncGroup /> : <SignInRequired what="sync" />}
        </SettingsGroup>

        <SettingsGroup
          testId="settings-group-currency"
          icon={<Coins className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          title="Currency & rates"
          summary="Display currency and exchange-rate overrides"
        >
          <CurrencyGroup />
        </SettingsGroup>

        <SettingsGroup
          testId="settings-group-data"
          icon={<DatabaseZap className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
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
        className="flex min-h-[44px] cursor-pointer list-none items-center gap-3 px-6 py-4 transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 sm:px-8"
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

/**
 * Placeholder for where a capability secret would be, shown only if this ever rendered without
 * an identified traveler. With no guest mode this is unreachable in
 * practice — TokenGate's wall already covers the whole viewport whenever `!traveler` — kept as
 * defense-in-depth. No key, no link, no code: just an honest explanation. The wall itself (not
 * this page) is where a visitor actually logs in, so there is no action to offer here.
 */
function SignInRequired({ what }: { what: 'trip' | 'sync' }) {
  return (
    <div
      data-testid={`settings-signin-required-${what}`}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <h3 className="text-sm font-semibold text-white">Log in to unlock this</h3>
      <p className="mt-1 max-w-2xl text-sm text-white/60">
        {what === 'trip'
          ? 'A trip’s Trip Token lets anyone view and edit that trip, so it’s only shown to a logged-in user.'
          : 'Your key is an account credential, so it’s only shown to the logged-in user it belongs to.'}
      </p>
    </div>
  );
}

/** Identity group: the signed-in traveler + a Sign out control. Unreachable unidentified. */
function IdentityGroup({ name }: { name: string | null }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-white/40">Signed in as</p>
          <p
            data-testid="settings-identity-name"
            aria-live="polite"
            className="mt-1 font-display text-2xl font-bold text-display-emphasis"
          >
            {name ?? 'Not signed in'}
          </p>
          <p className="mt-1 max-w-md text-sm text-white/60">
            {name
              ? 'Your itinerary edits are attributed to you across the shared trip.'
              : 'Log in with your key to attribute your edits.'}
          </p>
        </div>
        {/* With no guest mode this page is only ever visibly reached signed-in, so `name`
            is always truthy here in practice.: sign-out is now a confirm-gated full
            teardown (see the module doc comment), not a bare onClick. */}
        <SignOutConfirm testId={name ? 'settings-sign-out' : 'settings-sign-in'}>
          <button
            type="button"
            data-testid={name ? 'settings-sign-out' : 'settings-sign-in'}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {name ? 'Sign out' : 'Sign in'}
          </button>
        </SignOutConfirm>
      </div>
      {/* Rename (Decision 2026-07-30): login is now token-only, so the display name defaults to "Traveler"
          on a fresh device — this is where a signed-in traveler sets/changes it. `signIn` rewrites
          both identity slots + fires identity:changed, so the chip/attribution update live (no reload). */}
      {name && <RenameIdentity current={name} />}
      {/* (Q3) — claim the items you stamped under a name you used to go by. */}
      {name && <ClaimOldName current={name} />}
      {/* "Forget this device" — settings-only, strictly more destructive than sign-out: ALSO
          deletes every locally-stored photo (IndexedDB, app-scoped). Gated on `name` like Rename
          above (meaningless when not signed in). */}
      {name && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white">Forget this device</h3>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Signs out and permanently deletes every photo stored on this device. Use this before
            handing the device to someone else or giving it away.
          </p>
          <SignOutConfirm testId="settings-forget-device" forgetDevice>
            <button
              type="button"
              data-testid="settings-forget-device"
              className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-rose-400/40 px-4 py-2.5 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Forget this device
            </button>
          </SignOutConfirm>
        </div>
      )}
    </div>
  );
}

/** Editable display name for a signed-in traveler. `signIn` is the one primitive that writes both
 * identity slots (name + token) the app reads, so a rename is just a re-sign-in with the new name.
 *
 * the rename also PUBLISHES to `trips/{userToken}/profile/identity`, so the name is
 * an attribute of the account and survives to a device that has never seen this browser's
 * localStorage. Fire-and-forget is correct here — unlike the door and `createTrip()`, this surface
 * does NOT navigate, so there is no in-flight write to kill (the structural reason needs no
 * timeout branch). A publish that fails is retried by the provider's mount reconciler on the next
 * page load. Gated + lazily imported so the dormant build still pulls no firebase. */
function RenameIdentity({ current }: { current: string }) {
  const [value, setValue] = useState(current);
  const trimmed = value.trim();
  const dirty = trimmed !== '' && trimmed !== current;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!dirty || !signIn(trimmed)) return;
        const code = getSyncCode();
        if (!isRemoteConfigured() || !code) return;
        void import('@/lib/trips-remote')
          .then(({ pushAccountIdentity }) => pushAccountIdentity(code, trimmed))
          .catch((err) => console.warn('[settings] account identity publish unavailable:', err));
      }}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <label className="flex-1">
        <span className="text-xs uppercase tracking-widest text-white/40">Display name</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={24}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          data-testid="settings-identity-rename-input"
          className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </label>
      <button
        type="submit"
        disabled={!dirty}
        data-testid="settings-identity-rename-save"
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Save
      </button>
    </form>
  );
}

/**
 * (Q3) — claim the itinerary items stamped with a name you used to go by.
 *
 * A rename rewrites no stamps, so the pre-rename items keep the old name and you appear as two
 * people in the traveller filter — and the item card renders `by {item.updatedBy}` literally, so
 * seeding the old name into `priorNames` alone would fix the FILTER while the cards still read
 * "by Traveler". The owner asked for the stored rewrite; this is it.
 *
 * 🔴 WHY THIS IS A BUTTON AND NOT A VAULT MIGRATION. `DEFAULT_TRAVELER_NAME` is the literal
 * 'Traveler' — also the login placeholder for any token that resolves to no roster name. A stored
 * 'Traveler' stamp is therefore AMBIGUOUS between "the owner before his rename" and "somebody else
 * on a placeholder login", and the vault SYNCS, so a blanket unattended sweep would fold the second
 * into the first on every device. The count shown before the button is the entire safety mechanism:
 * it hands the ambiguity to the one person who knows whether anyone else ever used a placeholder
 * login. The name is an INPUT, not a hardcoded 'Traveler', because another traveller may need this
 * too — 'Traveler' is only the prefill.
 *
 * It also records the claimed name via `identityStore.addPriorName`, which is what keeps FUTURE
 * filtering correct for anything the rewrite cannot reach (remote items that arrive later, other
 * devices) — already wired into `itemMatchesAuthor` and `distinctAuthors`.
 *
 * SCOPE, stated so it is not mistaken for complete ( widened it to three stores, and only
 * three): itinerary items (`createdBy`/`updatedBy`/`doneBy`), expenses (`createdBy`/`updatedBy`)
 * and documents (`updatedBy`) — all on the ACTIVE trip.
 *
 * 🔴 `Expense.paidBy` and `Expense.split[]` ARE OUT OF SCOPE AND ARE NEVER WRITTEN. They hold the
 * same display-name strings, so a rename genuinely could reach them — but they are money, not
 * attribution: `core/budget/settlement.ts` de-duplicates split members before dividing the bill, so
 * renaming into a split that already contains the new name drops the divisor and re-points every
 * balance. The owner narrowed his own ruling to attribution after seeing that arithmetic.
 */

/** The per-store match counts behind the preview. `total` is what the button claims. */
interface ClaimCounts {
  items: number;
  expenses: number;
  docs: number;
  total: number;
}

/**
 * "2 itinerary items", "2 itinerary items and 1 expense", "2 itinerary items, 1 expense and 1
 * document". A store with nothing stamped is LEFT OUT entirely — the owner reads this screen and
 * "0 expenses" is noise that makes a real number harder to check.
 */
function describeClaim(c: ClaimCounts): string {
  const parts: string[] = [];
  if (c.items > 0) parts.push(`${c.items} itinerary item${c.items === 1 ? '' : 's'}`);
  if (c.expenses > 0) parts.push(`${c.expenses} expense${c.expenses === 1 ? '' : 's'}`);
  if (c.docs > 0) parts.push(`${c.docs} document${c.docs === 1 ? '' : 's'}`);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function ClaimOldName({ current }: { current: string }) {
  const { plans, claimAuthorship } = useItineraryContext();
  const { expenses, claimAuthorship: claimExpenses } = useExpenses();
  const { items: docItems, claimAuthorship: claimDocs } = useDocs();
  const [value, setValue] = useState(DEFAULT_TRAVELER_NAME);
  const [claimed, setClaimed] = useState<number | null>(null);
  const from = value.trim();
  const isSelf = from !== '' && from === current;

  // The preview count, derived live from the three shared stores. The itinerary side uses the SAME
  // predicate the traveller filter uses (`itemMatchesAuthor` over updatedBy/createdBy/doneBy) —
  // never a second, drifting definition. The other two match the exact fields their store rewrites,
  // so the previewed number is always the number that changes. `expenses` is already
  // tombstone-filtered by the hook; docs are filtered here (v1 never writes one, but the field is).
  const counts = useMemo<ClaimCounts>(() => {
    if (!from || isSelf) return { items: 0, expenses: 0, docs: 0, total: 0 };
    const filter: AuthorFilter = { kind: 'author', name: from };
    let items = 0;
    for (const plan of plans) {
      for (const item of plan.items ?? []) if (itemMatchesAuthor(item, filter, null)) items++;
    }
    const exp = expenses.filter((e) => e.createdBy === from || e.updatedBy === from).length;
    const docs = docItems.filter((d) => d.deleted !== true && d.updatedBy === from).length;
    return { items, expenses: exp, docs, total: items + exp + docs };
  }, [plans, expenses, docItems, from, isSelf]);

  const matches = counts.total;

  const status = isSelf
    ? `“${current}” is your current name. Enter the name you used before.`
    : from === ''
      ? 'Enter the name you used before.'
      : matches === 0
        ? `Nothing is stamped “${from}”. There is nothing to claim.`
        : `${describeClaim(counts)} ${matches === 1 ? 'is' : 'are'} stamped “${from}”. Claim ${matches === 1 ? 'it' : 'them'} as yours?`;

  return (
    <div
      data-testid="settings-claim-old-name"
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
    >
      <h3 className="text-sm font-semibold text-white">Claim items under an old name</h3>
      <p className="mt-1 max-w-2xl text-sm text-white/60">
        If you renamed yourself, everything you added before the rename is still stamped with the
        old name — so you show up twice in the traveller filter. Claiming rewrites those stamps to
        “{current}” across your plan, your expenses and your document checklist.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (matches === 0) return;
          // Record the claimed name FIRST, then rewrite. Order is load-bearing: `claimAuthorship`
          // commits, and commit dispatches `itinerary:changed` SYNCHRONOUSLY — which is exactly
          // the event `useAuthorFilter` re-reads `priorNames` on. Recording afterwards would leave
          // "My edits" one event behind until some unrelated edit happened to fire. Safe to do up
          // front: the button is disabled unless `matches > 0`, computed with the same predicate
          // the store scans. This is the-C mechanism, reused — it is what keeps FUTURE
          // filtering correct for anything the rewrite cannot reach (items that sync in later).
          identityStore.addPriorName(from);
          // Three small store calls, one per store — each commits once and returns what IT
          // changed. The sum is what the preview promised.
          setClaimed(claimAuthorship(from) + claimExpenses(from) + claimDocs(from));
        }}
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className="flex-1">
          <span className="text-xs uppercase tracking-widest text-white/40">Old name</span>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setClaimed(null);
            }}
            maxLength={24}
            autoComplete="off"
            spellCheck={false}
            data-testid="settings-claim-name-input"
            className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="submit"
          disabled={matches === 0}
          data-testid="settings-claim-name-submit"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {matches === 1 ? 'Claim 1 entry' : `Claim ${matches} entries`}
        </button>
      </form>
      {/* The count preview IS the safety gate — it must be readable before the button is pressed,
          and announced for a screen reader as the typed name changes. */}
      <p
        aria-live="polite"
        data-testid="settings-claim-name-status"
        className="mt-2 text-sm text-white/70"
      >
        {claimed === null
          ? status
          : `Claimed ${claimed} entr${claimed === 1 ? 'y' : 'ies'} as “${current}”.`}
      </p>
      {matches > 0 && claimed === null && (
        <p className="mt-1 max-w-2xl text-xs text-amber-200/70">
          Check that number first. It counts everything carrying that exact name — including
          anything a fellow traveller left while logged in as “{DEFAULT_TRAVELER_NAME}” — and the
          rewrite syncs to every device. Only the “added by” and “last edited by” stamps change:
          who paid for a shared expense, and how it splits, are never touched.
        </p>
      )}
    </div>
  );
}

/**
 * Trip group — add a trip by its Trip Token, and share the current
 * trip. Both reuse the pack-switch primitive VERBATIM: `setActiveTripId(id)` then a full page
 * reload (no live re-hydration). Add accepts a pasted Trip Token (only non-empty is validated — an
 * unknown one just resolves to an empty, harmless, never-synced trip,).
 *
 * 🔴-F — CREATE WAS DELETED FROM THIS SURFACE ON PURPOSE. DO NOT ADD IT BACK. It minted a
 * `crypto.randomUUID()` pack named "New trip" with NO config and NO meta push, so a joiner reading
 * the trip's meta doc learned nothing about it. `trips-hub.tsx` (`/trips/`) is the ONE correct
 * create path: it takes a required name, dates, destinations and a vibe, and awaits the meta +
 * list pushes under a budget before navigating. Giving THIS card a `pushTripMeta` would reproduce
 * the defect exactly — it reloads immediately, killing the in-flight write. Two create paths
 * with different guarantees is the defect; one path is the fix.
 *
 * The current Trip Token is `getTripId()`
 * (the REMOTE capability) — treated as a SECRET in copy: anyone holding it can read+write this trip
 * It is NOT the User Token, which is the account credential
 * and lives in its own group below — the two are never mixed.
 * #10 — on the DEFAULT pack `getTripId()` is now `''` (the sample is local-only; the old
 * `NEXT_PUBLIC_TRIP_ID` remote id is retired), so the token card renders an honest "no Trip
 * Token — this is the sample" note instead of an empty secret with copy buttons.
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
  // grandfathered default pack; read client-side like the Trip Token below.
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

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const id = joinValue.trim();
    if (!id) return; // non-empty is the only possible/needed validation
    joinTrip(id, 'Shared trip');
    window.location.reload();
  };

  // — always a way back to the grandfathered default pack. Writing DEFAULT_TRIP_ID makes
  // getActiveTripId() id-equal the default, so keyFor() grandfathers every slot back to the legacy
  // literal keys and the user sees their own main-trip data again. switch = write + reload.
  const switchToMain = () => {
    joinTrip(DEFAULT_TRIP_ID);
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
            className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-ring/60 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Switch to my main trip
          </button>
        </div>
      )}

      {/* Current Trip Token — the shareable secret for THIS trip (and only this trip). */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">This trip&rsquo;s Trip Token</h3>
        {tripKey === '' ? (
          // #10 — the default pack is a local-only sample: no remote path, no token, nothing to
          // share. Rendering the empty string as a "secret" with live copy buttons would hand the
          // user a broken share link.
          <p
            data-testid="settings-trip-key-sample"
            className="mt-1 max-w-2xl text-xs text-white/50"
          >
            This is the sample trip &mdash; it lives on this device only and has no Trip Token.
            Create a trip from your Trips page to get one you can share.
          </p>
        ) : (
        <>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-white/50">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Share this to invite someone to THIS trip &mdash; anyone holding it can view and edit it.
          It opens nothing else in your account.
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
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
            >
              {copied === 'key' ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied === 'key' ? 'Copied' : 'Copy Trip Token'}
            </button>
            <button
              type="button"
              onClick={() => shareLink && copy(shareLink, 'link')}
              disabled={!shareLink}
              data-testid="settings-trip-link-copy"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
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
          {copied === 'key' ? 'Trip Token copied to clipboard' : copied === 'link' ? 'Share link copied to clipboard' : ''}
        </div>
        </>
        )}
      </div>

      {/* Add an existing trip by pasting its Trip Token. */}
      <form
        onSubmit={join}
        className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
      >
        <h3 className="text-sm font-semibold text-white">Add a trip by Trip Token</h3>
        <p className="mt-1 max-w-2xl text-sm text-white/60">
          Paste the Trip Token a friend shared with you to add their trip and switch to it. Your own
          key is a login, not a trip &mdash; it never goes here.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="settings-trip-join" className="sr-only">
            Trip Token to add
          </label>
          <input
            id="settings-trip-join"
            value={joinValue}
            onChange={(e) => setJoinValue(e.target.value)}
            placeholder="Paste a Trip Token"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            data-testid="settings-trip-join-input"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 font-mono text-sm text-white placeholder:text-white/30 focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <button
            type="submit"
            disabled={!joinValue.trim()}
            data-testid="settings-trip-join-submit"
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add trip
          </button>
        </div>
      </form>

      {/* Settings stays the secondary surface — the full list/rename/switch UX lives on
          the dedicated /trips/ hub. Standard internal-link pattern (next/link, basePath-aware). */}
      <Link
        href="/trips/"
        data-testid="settings-trip-manage-link"
        className="inline-flex min-h-[44px] items-center gap-1 self-start rounded-lg px-1 text-sm font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
      >
        Manage all trips &rarr;
      </Link>
    </div>
  );
}

/**
 * "Your User Token" group ( →; promotes Sync Code to the ACCOUNT credential
 * — SAME on-disk key `tripPlannerSyncCode`, gateway key 28, so nothing migrates and the accessor
 * names `getSyncCode`/`setSyncCode` stay as documented internal misnomers). It owns the account's
 * trip list at `trips/{userToken}/profile/tripList`. Two actions:
 * - REVEAL/MINT: masked until revealed; the first reveal mints a `crypto.randomUUID()` and
 * best-effort seeds the remote list with this device's trips. This doubles as the
 * GRANDFATHERED path for a traveler who signed in before accounts existed. Subsequent reveals
 * just unmask the stored token.
 * - COPY: the existing clipboard idiom (copy-then-confirm, degrades silently when blocked) —
 * framed for "your other device" with a NEVER-SHARE warning, because unlike a Trip Token this
 * opens the whole account.
 *
 * The old "Enter a code" form is DELETED: entering a User Token is LOGGING IN, and the
 * front door owns that. Switching accounts = sign out → log in, which keeps one entry point for the
 * one credential instead of a second, unlabelled back door in Settings.
 *
 * A11y / house style matches TripGroup verbatim (glass card, ≥44px targets, focus rings, aria-live).
 * Storage is read post-mount only (ssr:false island). Dormant-safe: minting is a pure local write;
 * the push/subscribe self-gate on `isRemoteConfigured()`, so the token is inert until sync is
 * configured.
 */
function SyncGroup() {
  const [code, setCode] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setCode(getSyncCode()), []);

  const reveal = () => {
    let c = getSyncCode();
    if (!c) {
      c = crypto.randomUUID();
      setSyncCode(c);
      // Best-effort: seed the remote list with this device's trips so the code is usable at once.
      // Dynamically imported so /settings never pulls firebase eagerly; self-gates dormant.
      const minted = c;
      void import('@/lib/trips-remote').then(({ pushTripList }) => pushTripList(minted));
    }
    setCode(c);
    setRevealed(true);
  };

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (permissions / insecure context) — the value stays visible to select. */
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="settings-sync-card">
      {/* Your User Token — masked until revealed. */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white">Your key</h3>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-white/50">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          This is how you log in. <strong className="font-semibold text-white/80">Never share it</strong>{' '}
          &mdash; it opens your whole account and every trip in it. Copy it only to log in on your own
          other device; to invite someone to a trip, share that trip&rsquo;s Trip Token instead.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code
            data-testid="settings-sync-code"
            className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-surface/60 px-3 py-2.5 font-mono text-sm text-white/80"
          >
            {code === null ? 'Not set up yet' : revealed ? code : '•'.repeat(24)}
          </code>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reveal}
              data-testid="settings-sync-reveal"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-ring/60 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              {code === null ? 'Create my key' : revealed ? 'Showing' : 'Reveal'}
            </button>
            <button
              type="button"
              onClick={copy}
              disabled={code === null || !revealed}
              data-testid="settings-sync-copy"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40"
            >
              {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
        <div aria-live="polite" className="sr-only">
          {copied ? 'Your key copied to clipboard' : ''}
        </div>
        <p className="mt-3 max-w-2xl text-xs text-white/50">
          To use this account on another device, log out there (or open the app fresh) and enter this
          key at the front door.
        </p>
      </div>
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
                className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                  active
                    ? 'border-ring bg-primary/10 text-primary'
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
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
        className="w-full rounded-lg border border-white/15 bg-surface/60 px-3 py-2 text-sm text-white placeholder:text-white/30 focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
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
          className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export expenses (JSON)
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="settings-import-expenses-trigger"
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-ring/60 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
