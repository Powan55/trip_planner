'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Copy, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import {
  listKnownTrips,
  renameKnownTrip,
  removeKnownTrip,
  joinTrip,
  setTripConfig,
  getKnownTrip,
  type TripMeta,
  type TripConfigBlock,
} from '@/core/trips/registry';
import { VIBES, DEFAULT_VIBE } from '@/core/trips/custom';
import { getActiveTripId, DEFAULT_TRIP_ID, getSyncCode, setSyncCode } from '@/core/storage/gateway';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { withBasePath } from '@/lib/utils';
import UserTokenShowOnce from '@/components/user-token-show-once';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

const pad = (n: number) => String(n).padStart(2, '0');
/** Today as `YYYY-MM-DD`, local time (matches the native date input's own value format). */
const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** `isoDate + days`, local time. */
const addDaysIso = (iso: string, days: number): string => {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

/**
 * — how long trip creation waits for its remote writes before navigating anyway.
 *
 * WHY A BUDGET AT ALL: `window.location.assign` unloads the page in 370–740 ms, which aborts an
 * unawaited `pushTripMeta` mid-flight (measured: the doc was absent after 20 s of polling on 5 of
 * 6 creates; the identical call WITHOUT navigating landed in 179 ms). So the create path must
 * await. But a dead or crawling network must never make "create a trip" hang, hence the cap.
 *
 * WHY 5 s: 179 ms is the WARM number and is NOT the case to size for. It is warm because creating
 * requires being logged in, so the provider's domain-sync effects have already pulled the ~456 kB
 * firebase chunk and opened the WebChannel by the time this form is submitted — the create-time
 * cost is then one `setDoc` round-trip. 5 s covers ~10 round-trips at a 500 ms hotel-wifi RTT, and
 * leaves headroom for a partially-cold import. It does NOT cover a fully cold 456 kB fetch on a
 * throttled link (~9 s at 400 kbit/s); that case times out, navigates anyway, and falls back to
 * the two recovery paths in lib/trips-remote's header (the creator's next rename re-pushes; the
 * joiner's self-heal retries every page load).
 */
const CREATE_PUSH_BUDGET_MS = 5000;

/** Resolve when every push has settled, or when `ms` elapses — whichever is first. Never rejects
 * (`allSettled`), so a failing push can never leave the caller stranded before its navigation. */
function settleWithin(pushes: Promise<unknown>[], ms: number): Promise<unknown> {
  return Promise.race([
    Promise.allSettled(pushes),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * `/trips/` hub island — the POST-LOGIN landing
 * and the first-class select / create / add surface over the known-trips registry. Three
 * stacked cards, reusing the Settings TripGroup card/input/button styling verbatim so the
 * two surfaces read as one system:
 *
 * TWO TOKENS: every secret on this page is a **Trip Token** — one trip's
 * capability, and the thing you share to plan together. The **User Token** (the account credential
 * that logged you in) is NEVER shared and never rendered here; the only pointer to it is the
 * Settings link, plus the one-time "Finish setting up your account" card for a grandfathered
 * traveler who signed in before accounts existed (`traveler && !getSyncCode()`,).
 *
 * 1. YOUR TRIPS — `listKnownTrips()` rows (default pack always first). The current row
 * (id-equal `getActiveTripId()`) links Home; any other row's main action is the
 * switch primitive VERBATIM: `joinTrip(id)` then a full navigation to Home. Pencil =
 * inline rename via `renameKnownTrip`. Per-row "Copy link"
 * builds the same `?trip=` share URL as Settings: for a non-default pack the id
 * IS the capability token. The DEFAULT pack is a LOCAL-ONLY SAMPLE (#10 —
 * `NEXT_PUBLIC_TRIP_ID` is retired, `getTripId()` returns '' for it): it has no remote path,
 * so it has no shareable token, its copy buttons are never rendered, and its subtitle says
 * "Sample — on this device only".
 * 2. CREATE A TRIP — required name → `joinTrip(uuid,
 * name)`, then AWAIT the remote meta push under a budget, then navigate Home ( — the
 * navigation used to abort that push in flight and leave joiners with a contentless trip;
 * see `CREATE_PUSH_BUDGET_MS`). The minted uuid IS that trip's Trip Token.
 * 3. ADD A TRIP BY TRIP TOKEN — pasted Trip Token + optional name → `joinTrip(token, name)` +
 * navigate Home, with honest copy about the reality: a Trip Token cannot be
 * verified in advance.
 *
 * LOGIN GATE: creating a trip and adding one
 * by Trip Token both require a LOGGED-IN user, as do rename / forget / switch and every share
 * affordance (a Trip Token, raw or in a `?trip=` URL, is a live write capability). With no guest
 * mode, an unidentified visitor never visibly reaches this page at all — TokenGate's wall covers
 * it — so `canManage`'s false branch is defense-in-depth, not a real visitor-facing state.
 *
 * A11y: real list semantics, labels on every input, ≥44px touch targets, visible focus rings,
 * `aria-live` on the copy confirmation. No animation (utility page). Storage is read post-mount
 * only (ssr:false island; mount-gate mirrors settings-panel).
 */
export default function TripsHub() {
  const { traveler } = useActiveTraveler();
  const [trips, setTrips] = useState<TripMeta[] | null>(null);
  const [activeId, setActiveId] = useState<string>(DEFAULT_TRIP_ID);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedTokenId, setCopiedTokenId] = useState<string | null>(null);
  /**: a grandfathered traveler signed in before accounts existed — no User Token yet. */
  const [needsAccount, setNeedsAccount] = useState(false);
  const [mintedUserToken, setMintedUserToken] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createStart, setCreateStart] = useState('');
  const [createEnd, setCreateEnd] = useState('');
  const [createDestinations, setCreateDestinations] = useState('');
  const [createVibe, setCreateVibe] = useState('');
  const [dateError, setDateError] = useState(false);
  /**: create now awaits its remote pushes (bounded) before navigating — so the button has a
   * real pending state, and a second submit during that window must not mint a second trip. */
  const [creating, setCreating] = useState(false);
  const [joinKey, setJoinKey] = useState('');
  const [joinName, setJoinName] = useState('');
  const [forgetId, setForgetId] = useState<string | null>(null);

  useEffect(() => {
    setTrips(listKnownTrips());
    setActiveId(getActiveTripId());
    setNeedsAccount(getSyncCode() === null);
  }, []);

  const forgetTrip = forgetId ? (trips ?? []).find((t) => t.id === forgetId) : undefined;

  /**
   * gate. `trips !== null` is this island's existing post-mount signal, so this is false
   * during SSR/first paint too — the secrets and mutating controls never flash before storage is
   * read. With no guest mode an unidentified visitor never reaches this surface (the wall
   * covers it), so `!canManage` is defense-in-depth against the hidden-behind-the-wall render, not
   * a real reachable state.
   */
  const canManage = trips !== null && traveler !== null;

  /** The shareable capability token for a row, or null when none exists (see header). */
  const shareTokenFor = (id: string): string | null => {
    if (id !== DEFAULT_TRIP_ID) return id; // non-default pack: the id IS the token
    return null; // default pack: a local-only sample with no remote path (#10) — unshareable
  };

  /**
   * Best-effort push of a row's name/config to its remote meta doc. Resolves the
   * REMOTE token via `shareTokenFor` (not the local id verbatim) — the default pack's local id
   * and its remote path differ; a null token (unconfigured default pack) is a silent
   * no-op. Dynamically imported so the /trips route never pulls firebase eagerly.
   *
   * RETURNS the in-flight promise (and never rejects) so a caller that is about to navigate
   * can await it under a budget — an unawaited push dies with the page. Callers that stay on the
   * page (`saveRename`) keep voiding it; that path was never broken.
   */
  const pushMetaFor = (id: string, name: string, config?: TripConfigBlock): Promise<void> => {
    const token = shareTokenFor(id);
    if (!token) return Promise.resolve();
    return import('@/lib/trips-remote')
      .then(({ pushTripMeta }) => pushTripMeta(token, { name, config }))
      .catch((err) => console.warn('[trips-hub] trip meta push unavailable:', err));
  };

  /**
   * #10 — create the trip's remote doc, naming this device `owner`, BEFORE anything is written
   * underneath it. Ordering is structural, not stylistic: the members map can only be minted on
   * the create, and once it exists every write under `trips/{id}/**` is membership-gated. Same
   * shape as `pushMetaFor` — dynamically imported, never rejects — so it composes into the same
   * `settleWithin` budget below.
   */
  const createTripDocFor = (id: string): Promise<void> =>
    import('@/lib/trips-remote')
      .then(({ createTripDoc }) => createTripDoc(id))
      .catch((err) => console.warn('[trips-hub] trip doc create unavailable:', err));

  /**
   * Best-effort mirror of the updated known-trips list to the owner's User Token doc ( Sync
   * Code, promoted by — same key 28, same remote path) after any
   * list-changing action, so the change reaches their other devices. No-op when no code is set.
   * Dynamically imported so /trips never pulls firebase eagerly; self-gates dormant.
   * returns the in-flight promise (never rejects), same reason as `pushMetaFor`.
   */
  const pushSyncList = (): Promise<void> => {
    const code = getSyncCode();
    if (!code) return Promise.resolve();
    return import('@/lib/trips-remote')
      .then(({ pushTripList }) => pushTripList(code))
      .catch((err) => console.warn('[trips-hub] trip list push unavailable:', err));
  };

  const copyLink = async (id: string) => {
    const token = shareTokenFor(id);
    if (!token) return;
    const url = `${window.location.origin}${withBasePath('/')}?trip=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 2000);
    } catch {
      /* clipboard blocked (permissions / insecure context) — non-fatal, no state change. */
    }
  };

  /**
   * Copy the raw Trip Token (: sharing a trip IS sharing its Trip Token — the `?trip=` link
   * is just a nicer envelope for the same secret). Same clipboard idiom as `copyLink`.
   */
  const copyToken = async (id: string) => {
    const token = shareTokenFor(id);
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopiedTokenId(id);
      setTimeout(() => setCopiedTokenId((c) => (c === id ? null : c)), 2000);
    } catch {
      /* clipboard blocked (permissions / insecure context) — non-fatal, no state change. */
    }
  };

  /**
   * — the grandfathered upgrade. A traveler who signed in before accounts existed has an
   * identity but no User Token; nothing is gated on that except this affordance, so they were never
   * locked out. Minting touches ONLY key 28 — identity slots, `knownTrips`, the active-trip pointer
   * and every trip-scoped byte are untouched by construction, so all local data survives. Shown
   * once via the shared `UserTokenShowOnce`; no reload needed (the next boot's subscribe seeds the
   * remote list, and the best-effort push below does it immediately in a synced build).
   */
  const finishAccount = () => {
    const token = crypto.randomUUID();
    setSyncCode(token);
    setMintedUserToken(token);
    void import('@/lib/trips-remote').then(({ pushTripList }) => pushTripList(token));
  };

  // switch primitive: register + write the pointer, then a FULL navigation to Home so the
  // pack re-hydrates fresh and the switcher lands oriented (same target as the ?trip= handshake).
  const switchTo = (id: string) => {
    joinTrip(id);
    window.location.assign(withBasePath('/'));
  };

  const saveRename = (e: React.FormEvent, id: string) => {
    e.preventDefault();
    const name = renameValue.trim();
    if (name) {
      renameKnownTrip(id, name);
      // Stays on the page, so fire-and-forget is correct here (and is the recovery path that
      // makes a rename fix a trip whose create-time meta push was lost) —.
      void pushMetaFor(id, name, getKnownTrip(id)?.config);
      void pushSyncList();
    }
    setTrips(listKnownTrips());
    setRenamingId(null);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return; // the button is disabled too, but Enter-in-the-field bypasses that
    const name = createName.trim();
    if (!name) return;
    // D2 defaults: dates → today..today+30d, destinations → the trip name, vibe → first VIBES key.
    const start = createStart || todayIso();
    const end = createEnd || addDaysIso(start, 30);
    if (end < start) {
      setDateError(true);
      return;
    }
    setDateError(false);
    const destinations = createDestinations
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d.length > 0);
    const vibe = createVibe || Object.keys(VIBES)[0] || DEFAULT_VIBE;
    const id = crypto.randomUUID();
    const config: TripConfigBlock = {
      start,
      end,
      destinations: destinations.length > 0 ? destinations : [name],
      vibe,
      updatedAt: 0, // setTripConfig stamps its own updatedAt
    };
    joinTrip(id, name);
    setTripConfig(id, config);
    // — the trip is registered locally above; the remote meta doc is what a JOINER reads to
    // learn the trip's dates/destinations. Navigating without awaiting the push aborted it in
    // flight, so the joiner's /plan rendered no day cells at all. Await both pushes under one
    // shared budget, then navigate whatever happened (see CREATE_PUSH_BUDGET_MS).
    setCreating(true);
    // #10 — the trip DOC first, THEN the pushes that live underneath it. The order is structural:
    // the members map can only be minted on the create, and from the moment it exists every write
    // under `trips/{id}/**` is membership-gated, so the creator has to already be in it. Chained
    // inside ONE `settleWithin` rather than awaited twice, so the whole sequence still shares the
    // single navigation budget — a dead network must not make "create a trip" hang for 2×.
    await settleWithin(
      [
        createTripDocFor(id).then(() =>
          Promise.allSettled([pushMetaFor(id, name, config), pushSyncList()]),
        ),
      ],
      CREATE_PUSH_BUDGET_MS,
    );
    window.location.assign(withBasePath('/'));
  };

  /**
   * Forget a trip: drop it from this browser's list + tombstone it (so the Sync-Code
   * merge purges it instead of resurrecting it), then mirror to the owner's other devices. This does
   * NOT delete the trip's cloud data — the confirm copy says so. Forgetting the ACTIVE trip switches
   * the pointer to the default pack inside `removeKnownTrip`, so we navigate Home to re-hydrate.
   */
  const confirmForget = () => {
    const id = forgetId;
    if (!id) return;
    const wasActive = id === activeId;
    removeKnownTrip(id);
    void pushSyncList();
    setForgetId(null);
    if (wasActive) {
      window.location.assign(withBasePath('/'));
      return;
    }
    setTrips(listKnownTrips());
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const id = joinKey.trim();
    if (!id) return; // non-empty is the only possible/needed validation
    joinTrip(id, joinName.trim() || undefined);
    // same unawaited-push-then-navigate shape as create was, but NOT the defect —
    // the trip-list push self-heals on the next load (subscribeTripList re-pushes local extras),
    // and no peer depends on it. Left fire-and-forget deliberately; revisit only if that
    // self-heal is ever shown not to fire.
    void pushSyncList();
    window.location.assign(withBasePath('/'));
  };

  return (
    <section
      aria-labelledby="trips-hub-title"
      data-testid="trips-hub"
      className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
    >
      <h2 id="trips-hub-title" className="sr-only">
        Your trips: select one, create a trip, or add a trip by Trip Token
      </h2>
      <div className="flex flex-col gap-4">
        {/* 1 — Every trip this browser knows. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white">Your trips</h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-mid">
            Every trip this browser has created or joined. Tap one to switch to it.
          </p>
          <ul data-testid="trips-hub-list" className="mt-3 flex flex-col gap-2">
            {(trips ?? []).map((t, i) => {
              const isCurrent = t.id === activeId;
              const token = shareTokenFor(t.id);
              // #10 — the default pack is honest about what it now is: a local-only sample
              // (no remote path, nothing syncs, nothing to share).
              const subtitle =
                t.id === DEFAULT_TRIP_ID
                  ? 'Sample — on this device only'
                  : `Joined ${new Date(t.joinedAt).toLocaleDateString()}`;
              return (
                <li
                  key={t.id}
                  data-testid={`trips-hub-row-${i}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-surface/60 p-2"
                >
                  {renamingId === t.id ? (
                    <form
                      onSubmit={(e) => saveRename(e, t.id)}
                      className="flex min-w-0 flex-1 items-center gap-2"
                    >
                      <label htmlFor={`trips-hub-rename-input-${i}`} className="sr-only">
                        New name for {t.name}
                      </label>
                      <input
                        id={`trips-hub-rename-input-${i}`}
                        data-testid={`trips-hub-rename-input-${i}`}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        maxLength={40}
                        autoFocus
                        autoComplete="off"
                        className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-ink-lo focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                      />
                      <button
                        type="submit"
                        data-testid={`trips-hub-rename-save-${i}`}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-ring/60 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      {isCurrent ? (
                        <Link
                          href="/"
                          className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-lg px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-white">{t.name}</span>
                            <span className="shrink-0 rounded-full border border-ring/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                              Current
                            </span>
                          </span>
                          <span className="text-xs text-ink-mid">{subtitle}</span>
                        </Link>
                      ) : canManage ? (
                        <button
                          type="button"
                          onClick={() => switchTo(t.id)}
                          className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="truncate text-sm font-semibold text-white">{t.name}</span>
                          <span className="text-xs text-ink-mid">{subtitle} · tap to switch</span>
                        </button>
                      ) : (
                        // Unidentified render: readable, but switching is a trip-mutating registry
                        // action — see canManage's docstring above.
                        <div className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center px-2 py-1.5">
                          <span className="truncate text-sm font-semibold text-white">{t.name}</span>
                          <span className="text-xs text-ink-mid">{subtitle}</span>
                        </div>
                      )}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(t.id);
                            setRenameValue(t.name);
                          }}
                          data-testid={`trips-hub-rename-${i}`}
                          aria-label={`Rename ${t.name}`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/15 text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                      {canManage && token !== null && (
                        <>
                          <button
                            type="button"
                            onClick={() => copyToken(t.id)}
                            data-testid={`trips-hub-copy-token-${i}`}
                            aria-label={`Copy the Trip Token for ${t.name}`}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                          >
                            {copiedTokenId === t.id ? (
                              <Check className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Copy className="h-4 w-4" aria-hidden="true" />
                            )}
                            {copiedTokenId === t.id ? 'Copied' : 'Trip Token'}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyLink(t.id)}
                            data-testid={`trips-hub-copy-${i}`}
                            aria-label={`Copy share link for ${t.name}`}
                            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                          >
                            {copiedId === t.id ? (
                              <Check className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Share2 className="h-4 w-4" aria-hidden="true" />
                            )}
                            {copiedId === t.id ? 'Copied' : 'Copy link'}
                          </button>
                        </>
                      )}
                      {canManage && t.id !== DEFAULT_TRIP_ID && (
                        <button
                          type="button"
                          onClick={() => setForgetId(t.id)}
                          data-testid={`trips-hub-forget-${i}`}
                          aria-label={`Forget ${t.name}`}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/15 text-ink-mid transition-colors hover:bg-rose-500/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div aria-live="polite" className="sr-only">
            {copiedTokenId !== null
              ? 'Trip Token copied to clipboard'
              : copiedId !== null
                ? 'Share link copied to clipboard'
                : ''}
          </div>
          {/* Pointer to the User Token — it is what carries
              this list to the owner's other devices. Hidden when unidentified: it is the account
              credential. */}
          {canManage && (
          <Link
            href="/settings/"
            data-testid="trips-hub-sync-link"
            className="mt-3 inline-flex min-h-[44px] items-center gap-1 self-start rounded-lg px-1 text-sm font-semibold text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            See your key &mdash; log in on another device &rarr;
          </Link>
          )}
        </div>

        {/* — one-time account completion for a grandfathered traveler (identity, no User
            Token). canManage-gated, and gone for good once minted. */}
        {canManage && needsAccount && (
          <div
            data-testid="trips-hub-finish-account"
            className="rounded-xl border border-border bg-muted/40 p-4 sm:p-5"
          >
            {mintedUserToken ? (
              <UserTokenShowOnce
                token={mintedUserToken}
                heading="Your account is ready — this is your key."
                confirmLabel="Done"
                testIdPrefix="trips-hub-finish-account-show-once"
                onConfirm={() => {
                  setMintedUserToken(null);
                  setNeedsAccount(false);
                }}
              />
            ) : (
              <>
                <h3 className="text-sm font-semibold text-white">Finish setting up your account</h3>
                <p className="mt-1 max-w-2xl text-sm text-ink-mid">
                  You signed in before accounts existed, so you don&rsquo;t have a key yet.
                  Creating one takes a second, changes nothing you already have, and is what lets you
                  log in on another device and see these same trips.
                </p>
                <button
                  type="button"
                  onClick={finishAccount}
                  data-testid="trips-hub-finish-account-mint"
                  className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-ring/60 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  Create my key
                </button>
              </>
            )}
          </div>
        )}

        {/* no create / join / secrets while unidentified. With no guest mode this
            is unreachable in practice (TokenGate's wall already covers the page) — kept as
            defense-in-depth. No action to offer: the wall itself is where a visitor logs in. */}
        {trips !== null && !canManage && (
          <div
            data-testid="trips-hub-signin-required"
            className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
          >
            <h3 className="text-sm font-semibold text-white">Log in to manage trips</h3>
            <p className="mt-1 max-w-2xl text-sm text-ink-mid">
              Creating a trip, adding one by Trip Token, renaming and sharing all belong to an
              account &mdash; log in with your key, or create an account in a few seconds.
            </p>
          </div>
        )}

        {/* 2 — Create, with a REQUIRED name. */}
        {canManage && (
        <form onSubmit={create} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white">Create a trip</h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-mid">
            Starts a fresh, empty trip with its own Trip Token. You&rsquo;ll switch to it now; copy
            that Trip Token (or its link) from the list above to invite anyone you want to plan with.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="trips-hub-create-name" className="sr-only">
                Name for the new trip
              </label>
              <input
                id="trips-hub-create-name"
                data-testid="trips-hub-create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="e.g. Kerala 2027"
                maxLength={40}
                required
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-ink-lo focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="trips-hub-create-start" className="text-xs text-ink-mid">
                  Start date (optional, defaults to today)
                </label>
                <input
                  id="trips-hub-create-start"
                  data-testid="trips-hub-create-start"
                  type="date"
                  value={createStart}
                  onChange={(e) => {
                    setCreateStart(e.target.value);
                    setDateError(false);
                  }}
                  className="min-w-0 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <label htmlFor="trips-hub-create-end" className="text-xs text-ink-mid">
                  End date (optional, defaults to +30 days)
                </label>
                <input
                  id="trips-hub-create-end"
                  data-testid="trips-hub-create-end"
                  type="date"
                  value={createEnd}
                  onChange={(e) => {
                    setCreateEnd(e.target.value);
                    setDateError(false);
                  }}
                  className="min-w-0 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                />
              </div>
            </div>
            {dateError && (
              <p role="alert" data-testid="trips-hub-create-date-error" className="text-xs text-red-400">
                End date must be on or after the start date.
              </p>
            )}

            <div className="flex flex-col gap-1">
              <label htmlFor="trips-hub-create-destinations" className="text-xs text-ink-mid">
                Destinations (optional, comma-separated — defaults to the trip name)
              </label>
              <input
                id="trips-hub-create-destinations"
                data-testid="trips-hub-create-destinations"
                value={createDestinations}
                onChange={(e) => setCreateDestinations(e.target.value)}
                placeholder="e.g. Kochi, Munnar, Alleppey"
                autoComplete="off"
                className="min-w-0 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-ink-lo focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-xs text-ink-mid">Vibe (optional)</legend>
              <div role="radiogroup" aria-label="Trip vibe" className="flex flex-wrap gap-2">
                {Object.entries(VIBES).map(([key, vibe]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={createVibe ? createVibe === key : key === Object.keys(VIBES)[0]}
                    data-testid={`trips-hub-create-vibe-${key}`}
                    onClick={() => setCreateVibe(key)}
                    className={`inline-flex min-h-[44px] items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                      (createVibe ? createVibe === key : key === Object.keys(VIBES)[0])
                        ? 'border-ring/60 bg-primary/10 text-primary'
                        : 'border-white/15 text-white hover:bg-white/5'
                    }`}
                  >
                    {vibe.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              type="submit"
              disabled={!createName.trim() || creating}
              aria-busy={creating}
              data-testid="trips-hub-create"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 self-start rounded-lg border border-ring/60 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {creating ? 'Creating trip…' : 'Create trip'}
            </button>
          </div>
        </form>
        )}

        {/* 3 — Join by pasted key, with an optional name for the row. */}
        {canManage && (
        <form onSubmit={join} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white">Add a trip by Trip Token</h3>
          <p className="mt-1 max-w-2xl text-sm text-ink-mid">
            Paste the Trip Token a friend shared with you to add their trip to your list and switch
            to it.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <label htmlFor="trips-hub-join-key" className="sr-only">
              Trip Token to add
            </label>
            <input
              id="trips-hub-join-key"
              data-testid="trips-hub-join-key"
              value={joinKey}
              onChange={(e) => setJoinKey(e.target.value)}
              placeholder="Paste a Trip Token"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 font-mono text-sm text-white placeholder:text-ink-lo focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="trips-hub-join-name" className="sr-only">
                Optional name for this trip
              </label>
              <input
                id="trips-hub-join-name"
                data-testid="trips-hub-join-name"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="Shared trip"
                maxLength={40}
                autoComplete="off"
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-ink-lo focus-visible:border-ring/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <button
                type="submit"
                disabled={!joinKey.trim()}
                data-testid="trips-hub-join"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add trip
              </button>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-xs text-ink-lo">
            A Trip Token opens one trip &mdash; it is not a login, and your own key never goes
            here. Trip Tokens can&rsquo;t be verified in advance: if the trip opens empty, it may be
            mistyped or the trip is brand new.
          </p>
        </form>
        )}
      </div>

      {/* forget confirm (reused Radix AlertDialog, mirrors the calendar clear/delete gate). */}
      <AlertDialog open={forgetId !== null} onOpenChange={(open) => { if (!open) setForgetId(null); }}>
        <AlertDialogContent className="glass-card-dark border-white/10 text-white" data-testid="trips-hub-forget-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Forget {forgetTrip?.name ?? 'this trip'}?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-mid">
              This removes the trip from your list on this browser (and your other synced devices). It
              does <strong className="font-semibold text-ink-hi">not</strong> delete the trip&rsquo;s
              cloud data &mdash; anyone holding its Trip Token can still open it, and you can add it
              back any time by pasting that Trip Token.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="trips-hub-forget-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="trips-hub-forget-action"
              onClick={confirmForget}
              className="bg-rose-500 text-white hover:bg-rose-400"
            >
              Forget trip
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
