'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Pencil, Plus, Share2 } from 'lucide-react';
import {
  listKnownTrips,
  renameKnownTrip,
  joinTrip,
  type TripMeta,
} from '@/core/trips/registry';
import { getActiveTripId, DEFAULT_TRIP_ID } from '@/core/storage/gateway';
import { withBasePath } from '@/lib/utils';

/**
 * `/trips/` hub island — the first-class create / join / manage surface over the
 * known-trips registry. Three stacked cards, reusing the Settings TripGroup card/input/button
 * styling verbatim so the two surfaces read as one system:
 *
 * 1. YOUR TRIPS — `listKnownTrips()` rows (default pack always first). The current row
 * (id-equal `getActiveTripId()`) links Home; any other row's main action is the
 * switch primitive VERBATIM: `joinTrip(id)` then a full navigation to Home. Pencil =
 * inline rename via `renameKnownTrip`. Per-row "Copy link"
 * builds the same `?trip=` share URL as Settings: for a non-default pack the id
 * IS the capability token; for the DEFAULT pack the token is the separately
 * minted `NEXT_PUBLIC_TRIP_ID` secret (the same source `getTripId()` reads for the
 * default pack, lib/firebase-config) — NEVER the public `nepal-japan-2026` literal. When
 * that env is unset (dormant build, sync unconfigured) the default pack simply has no
 * shareable token, so its copy button is not rendered.
 * 2. CREATE — required name → `joinTrip(uuid, name)`
 * + navigate Home.
 * 3. JOIN — pasted key + optional name → `joinTrip(key, name)` + navigate Home, with honest
 * copy about the reality: a key cannot be verified in advance.
 *
 * A11y: real list semantics, labels on every input, ≥44px touch targets, visible focus rings,
 * `aria-live` on the copy confirmation. No animation (utility page). Storage is read post-mount
 * only (ssr:false island; mount-gate mirrors settings-panel).
 */
export default function TripsHub() {
  const [trips, setTrips] = useState<TripMeta[] | null>(null);
  const [activeId, setActiveId] = useState<string>(DEFAULT_TRIP_ID);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [joinKey, setJoinKey] = useState('');
  const [joinName, setJoinName] = useState('');

  useEffect(() => {
    setTrips(listKnownTrips());
    setActiveId(getActiveTripId());
  }, []);

  /** The shareable capability token for a row, or null when none exists (see header). */
  const shareTokenFor = (id: string): string | null => {
    if (id !== DEFAULT_TRIP_ID) return id; // non-default pack: the id IS the token
    return process.env.NEXT_PUBLIC_TRIP_ID || null; // default pack: env secret or unshareable
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

  // switch primitive: register + write the pointer, then a FULL navigation to Home so the
  // pack re-hydrates fresh and the switcher lands oriented (same target as the ?trip= handshake).
  const switchTo = (id: string) => {
    joinTrip(id);
    window.location.assign(withBasePath('/'));
  };

  const saveRename = (e: React.FormEvent, id: string) => {
    e.preventDefault();
    const name = renameValue.trim();
    if (name) renameKnownTrip(id, name);
    setTrips(listKnownTrips());
    setRenamingId(null);
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    joinTrip(crypto.randomUUID(), name);
    window.location.assign(withBasePath('/'));
  };

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const id = joinKey.trim();
    if (!id) return; // non-empty is the only possible/needed validation
    joinTrip(id, joinName.trim() || undefined);
    window.location.assign(withBasePath('/'));
  };

  return (
    <section
      aria-labelledby="trips-hub-title"
      data-testid="trips-hub"
      className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
    >
      <h2 id="trips-hub-title" className="sr-only">
        Your trips, create a trip, or join one
      </h2>
      <div className="flex flex-col gap-4">
        {/* 1 — Every trip this browser knows. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white">Your trips</h3>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Every trip this browser has created or joined. Tap one to switch to it.
          </p>
          <ul data-testid="trips-hub-list" className="mt-3 flex flex-col gap-2">
            {(trips ?? []).map((t, i) => {
              const isCurrent = t.id === activeId;
              const token = shareTokenFor(t.id);
              const subtitle =
                t.id === DEFAULT_TRIP_ID
                  ? 'Main trip'
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
                        className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
                      />
                      <button
                        type="submit"
                        data-testid={`trips-hub-rename-save-${i}`}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gold-400/60 px-4 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <>
                      {isCurrent ? (
                        <Link
                          href="/"
                          className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-lg px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                        >
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-white">{t.name}</span>
                            <span className="shrink-0 rounded-full border border-gold-400/60 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gold-400">
                              Current
                            </span>
                          </span>
                          <span className="text-xs text-white/50">{subtitle}</span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => switchTo(t.id)}
                          className="flex min-h-[44px] min-w-0 flex-1 flex-col justify-center rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                        >
                          <span className="truncate text-sm font-semibold text-white">{t.name}</span>
                          <span className="text-xs text-white/50">{subtitle} · tap to switch</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(t.id);
                          setRenameValue(t.name);
                        }}
                        data-testid={`trips-hub-rename-${i}`}
                        aria-label={`Rename ${t.name}`}
                        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/15 text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {token !== null && (
                        <button
                          type="button"
                          onClick={() => copyLink(t.id)}
                          data-testid={`trips-hub-copy-${i}`}
                          aria-label={`Copy share link for ${t.name}`}
                          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        >
                          {copiedId === t.id ? (
                            <Check className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <Share2 className="h-4 w-4" aria-hidden="true" />
                          )}
                          {copiedId === t.id ? 'Copied' : 'Copy link'}
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          <div aria-live="polite" className="sr-only">
            {copiedId !== null ? 'Share link copied to clipboard' : ''}
          </div>
        </div>

        {/* 2 — Create, with a REQUIRED name. */}
        <form onSubmit={create} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white">Create a trip</h3>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Starts a fresh, empty trip with its own key. You&rsquo;ll switch to it now; share its
            link to plan together.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
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
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
            />
            <button
              type="submit"
              disabled={!createName.trim()}
              data-testid="trips-hub-create"
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gold-400/60 px-4 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Create trip
            </button>
          </div>
        </form>

        {/* 3 — Join by pasted key, with an optional name for the row. */}
        <form onSubmit={join} className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h3 className="text-sm font-semibold text-white">Join a trip</h3>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Paste a Trip Key someone shared with you to switch this browser to their trip.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <label htmlFor="trips-hub-join-key" className="sr-only">
              Trip key to join
            </label>
            <input
              id="trips-hub-join-key"
              data-testid="trips-hub-join-key"
              value={joinKey}
              onChange={(e) => setJoinKey(e.target.value)}
              placeholder="Paste a Trip Key"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 font-mono text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
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
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-surface/60 px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/40"
              />
              <button
                type="submit"
                disabled={!joinKey.trim()}
                data-testid="trips-hub-join"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
              >
                Join trip
              </button>
            </div>
          </div>
          <p className="mt-3 max-w-2xl text-xs text-white/50">
            Keys can&rsquo;t be verified in advance — if the trip opens empty, the key may be
            mistyped or the trip is brand new.
          </p>
        </form>
      </div>
    </section>
  );
}
