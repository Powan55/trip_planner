'use client';

import { useEffect, useRef, useState } from 'react';
import { Inbox, Link2, Trash2, CalendarDays, MapPin } from 'lucide-react';
import { useShare } from '@/hooks/use-share';
import type { ShareItem } from '@/core/share/model';
import { TRIP_DATES, formatDate } from '@/core/dates';
import { isGooglePlaceUrl } from '@/core/places/model';
import { haptic } from '@/lib/haptics';
import ImportPlaceSheet from '@/components/import-place-sheet';

/**
 * ShareInbox — the `/share` route's dual surface: the OS-share-target RECEIVER and the
 * triage INBOX in one island. The installed PWA registers as a GET
 * `share_target` (`scripts/gen-sw.mjs::buildManifest()`); the OS Share sheet navigates here with
 * `?title/?text/?url`. On mount (post-hydration) we parse those raw params (the `trip-now.ts`
 * precedent — `window.location.search`), persist a new unassigned item, then STRIP the params via
 * `history.replaceState` so a reload never re-adds. A session-scoped dedupe key (title+text+url)
 * belt-and-suspenders against a same-session re-add.
 *
 * Triage: newest-first list; each row shows the content, a linkified url
 * (`rel="noopener noreferrer" target="_blank"`), a bounded Dec 9 … Jan 9 day-assign `<select>`
 * (reuses `core/dates` `TRIP_DATES`), and a delete. An empty inbox shows a designed empty state.
 *
 * A11y: a section `h2`, semantic `<ul>`/`<li>` rows, real `<label>`/`<select>`
 * pairs, ≥44px targets, visible focus rings, static markup (reduced-motion-safe by construction).
 */

// Session-scoped (per document load) dedupe of already-received shares. Each OS share is a full
// page load, so this resets naturally; it only guards a same-session re-mount / double effect.
const sessionSeen = new Set<string>();

function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

function dayLabel(day: string): string {
  const idx = TRIP_DATES.indexOf(day);
  return idx < 0 ? formatDate(day) : `Day ${idx + 1} · ${formatDate(day)}`;
}

export default function ShareInbox() {
  const { items, hydrated, addShare, removeShare, assignDay } = useShare();
  const processedRef = useRef(false);
  // Import-a-place entry into the shared ImportPlaceSheet. Two ways in:
  // • "Paste a Google Maps link" header button — iOS + desktop have no OS share_target, so
  // the paste path is first-class; the sheet opens with an EDITABLE URL field.
  // • "Import as place" on a Google-host inbox row — the sheet opens SEEDED with that row's
  // url (read-only, auto-resolved); on a SUCCESSFUL save the source row is removed.
  // One `importState` drives the single shared mount (never a second sheet). Parent-owned focus
  // return: snapshot the active trigger on open, refocus it on the sheet's exit-complete.
  const [importState, setImportState] = useState<{ url: string; editable: boolean; rowId?: string } | null>(null);
  const importTriggerRef = useRef<HTMLElement | null>(null);
  const openImport = () => {
    importTriggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setImportState({ url: '', editable: true });
  };
  const openRowImport = (item: ShareItem) => {
    importTriggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setImportState({ url: item.url ?? '', editable: false, rowId: item.id });
  };
  // Remove the source inbox row only on a real import (the sheet's onImported fires before onClose).
  const handleImported = () => {
    if (importState?.rowId) removeShare(importState.rowId);
  };

  // Receiver: runs ONCE after hydration (commit gates on hydrated, so we must wait for it).
  useEffect(() => {
    if (!hydrated || processedRef.current) return;
    processedRef.current = true;

    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return;
    }
    const title = params.get('title')?.trim() || undefined;
    const text = params.get('text')?.trim() || undefined;
    const url = params.get('url')?.trim() || undefined;
    if (!title && !text && !url) return;

    const key = `${title ?? ''}\u0000${text ?? ''}\u0000${url ?? ''}`;
    if (!sessionSeen.has(key)) {
      sessionSeen.add(key);
      addShare({ title, text, url });
    }
    // Strip the query so a reload / back-forward cache restore cannot re-add the same share.
    try {
      history.replaceState(null, '', window.location.pathname + window.location.hash);
    } catch {
      /* history unavailable — the session dedupe still guards a same-load re-run */
    }
  }, [hydrated, addShare]);

  if (!hydrated) {
    return (
      <section aria-labelledby="share-heading" data-testid="share-inbox" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
        <h2 id="share-heading" className="sr-only">
          Shared links inbox
        </h2>
        <p className="text-sm text-white/55">Loading your shared links…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="share-heading"
      data-testid="share-inbox"
      className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6"
    >
      <header className="mb-6">
        <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
          <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
          Triage inbox
        </p>
        <h2 id="share-heading" className="font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
          Shared <span className="text-display-emphasis">links</span>
        </h2>
        <p className="mt-3 text-sm text-white/70">
          {items.length === 0
            ? 'Anything you share to this app from your phone lands here.'
            : `${items.length} item${items.length === 1 ? '' : 's'} — assign each to a trip day or clear it out.`}
        </p>
        <button
          type="button"
          data-testid="share-paste-link"
          onClick={openImport}
          aria-haspopup="dialog"
          className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-ring/40 bg-primary/10 px-4 text-sm font-medium text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
        >
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          Paste a Google Maps link
        </button>
      </header>

      {items.length === 0 ? (
        <div
          data-testid="share-empty"
          className="glass-subtle flex flex-col items-center rounded-2xl px-6 py-14 text-center"
        >
          <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/40 text-muted-foreground">
            <Inbox className="h-7 w-7" aria-hidden="true" />
          </span>
          <h3 className="font-display text-lg font-bold text-white">Nothing shared yet</h3>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/60">
            Install the app, then use your phone&rsquo;s Share button on any page, note, or link —
            it will show up here, ready to slot into your itinerary.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <ShareRow
              key={item.id}
              item={item}
              onAssign={(day) => {
                assignDay(item.id, day);
                haptic();
              }}
              onDelete={() => {
                removeShare(item.id);
                haptic();
              }}
              onImport={() => openRowImport(item)}
            />
          ))}
        </ul>
      )}

      {/* Import-a-place confirm sheet. Paste mode: editable URL field.
          Row mode: seeded read-only url, source row removed on a successful import.
          Focus returns to the trigger on exit-complete. */}
      {/* the shared Sheet primitive owns the exit AnimatePresence + focus-
          return, so the sheet stays mounted and toggles `open` (unmounting it would skip
          the exit animation and never fire onExitComplete). */}
      <ImportPlaceSheet
        open={importState !== null}
        initialUrl={importState?.url}
        urlEditable={importState?.editable ?? false}
        onImported={handleImported}
        onClose={() => setImportState(null)}
        onExitComplete={() => importTriggerRef.current?.focus?.()}
      />
    </section>
  );
}

function ShareRow({
  item,
  onAssign,
  onDelete,
  onImport,
}: {
  item: ShareItem;
  onAssign: (day: string | undefined) => void;
  onDelete: () => void;
  onImport: () => void;
}) {
  const heading = item.title || item.text || item.url || 'Shared item';
  const selectId = `share-day-${item.id}`;
  // "Import as place" only on rows whose url is a Google place link (same allow-list as the sheet).
  const canImport = isGooglePlaceUrl(item.url);

  return (
    <li data-testid={`share-item-${item.id}`} className="glass-subtle rounded-2xl p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium leading-snug text-white/90 break-words">{heading}</p>
          {item.text && item.text !== heading && (
            <p className="mt-1 text-sm leading-relaxed text-white/60 break-words">{item.text}</p>
          )}
          {item.url && (
            <p className="mt-2 flex items-center gap-1.5 text-sm">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {isHttpUrl(item.url) ? (
                <a
                  data-testid={`share-item-link-${item.id}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate text-primary underline underline-offset-2 outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring rounded"
                >
                  {item.url}
                </a>
              ) : (
                <span className="truncate text-white/55 break-all">{item.url}</span>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          data-testid={`share-item-delete-${item.id}`}
          onClick={onDelete}
          aria-label={`Delete shared item: ${heading}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5 text-white/60 outline-none transition-colors hover:bg-white/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <label htmlFor={selectId} className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/45">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          Trip day
        </label>
        <select
          id={selectId}
          data-testid={`share-item-day-${item.id}`}
          value={item.day ?? ''}
          onChange={(e) => onAssign(e.target.value === '' ? undefined : e.target.value)}
          className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/85 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Unassigned</option>
          {TRIP_DATES.map((day) => (
            <option key={day} value={day}>
              {dayLabel(day)}
            </option>
          ))}
        </select>
      </div>

      {canImport && (
        <div className="mt-3">
          <button
            type="button"
            data-testid={`share-item-import-${item.id}`}
            onClick={onImport}
            aria-haspopup="dialog"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-ring/40 bg-primary/10 px-4 text-sm font-medium text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface focus-visible:outline-none"
          >
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            Import as place
          </button>
        </div>
      )}
    </li>
  );
}
