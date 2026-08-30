'use client';

import { useEffect, useRef, useState } from 'react';
import { Inbox, Link2, Trash2, CalendarDays, MapPin } from 'lucide-react';
import { useShare } from '@/hooks/use-share';
import type { ShareItem } from '@/core/share/model';
import { TRIP_DATES, formatDate } from '@/core/dates';
import { isGooglePlaceUrl } from '@/core/places/model';
import { haptic } from '@/lib/haptics';
import { isHttpHref } from '@/lib/safe-href';
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
 * A11y: a section `h2` (sr-only — `app/share/page.tsx`'s masthead carries the visible title),
 * semantic `<ul>`/`<li>` rows, real `<label>`/`<select>`
 * pairs, ≥44px targets, visible focus rings, static markup (reduced-motion-safe by construction).
 */

// Session-scoped (per document load) dedupe of already-received shares. Each OS share is a full
// page load, so this resets naturally; it only guards a same-session re-mount / double effect.
const sessionSeen = new Set<string>();

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
      <section aria-labelledby="share-heading" data-testid="share-inbox" className="mx-auto w-full max-w-3xl px-gut pb-16">
        <h2 id="share-heading" className="sr-only">
          Shared links inbox
        </h2>
        <p className="empty">Loading your shared links…</p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="share-heading"
      data-testid="share-inbox"
      className="mx-auto w-full max-w-3xl pb-16"
    >
      <header className="mb-6 px-gut">
        <p className="pr pr--lo mb-2 flex items-center gap-1.5">
          <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
          Triage inbox
        </p>
        {/* #218: the title used to be printed here a second time, ~40px under the page
            masthead that already carries it. The heading stays as the section's accessible
            name (`aria-labelledby` above) and the h2 the cards' h3s nest under — sr-only, the
            same shape as the pre-hydration branch. The "Triage inbox" eyebrow is NOT a
            duplicate: the masthead's reads "Shared to your trip". */}
        <h2 id="share-heading" className="sr-only">
          Shared links inbox
        </h2>
        <p className="mt-3 max-w-2xl text-t-body text-ink-mid">
          {items.length === 0
            ? 'Anything you share to this app from your phone lands here.'
            : `${items.length} item${items.length === 1 ? '' : 's'} — assign each to a trip day or clear it out.`}
        </p>
        <button
          type="button"
          data-testid="share-paste-link"
          onClick={openImport}
          aria-haspopup="dialog"
          className="btn btn--2 mt-4 px-4"
        >
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          Paste a Google Maps link
        </button>
      </header>

      {items.length === 0 ? (
        // The empty state renders the SHAPE of the row that is missing at the size it will
        // be, plus the condition that fills it. Nothing is captioned as absent.
        <div data-testid="share-empty">
          <div className="head static flex-wrap">
            <span className="f">
              <span className="k">Inbox</span>
              <span className="v">Awaiting</span>
            </span>
            <span className="f">
              <span className="k">Items</span>
              <span className="v">0</span>
            </span>
            <span className="f f--drop">
              <span className="k">Source</span>
              <span className="v">OS share sheet</span>
            </span>
          </div>
          <ul aria-hidden="true" className="list empty-frame">
            {['Link', 'Note', 'Place'].map((slot) => (
              <li key={slot} className="r" data-mark="hollow">
                <span className="tm flex items-center">
                  <Inbox className="h-4 w-4 text-ink-lo" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <h3>{slot}</h3>
                  <span className="mt">unassigned · no trip day</span>
                </span>
                <span className="hollow-tag">not yet</span>
              </li>
            ))}
          </ul>
          <p className="empty mt-4 max-w-2xl px-gut">
            Install the app, then use your phone&rsquo;s Share button on any page, note, or link —
            it will show up here, ready to slot into your itinerary.
          </p>
        </div>
      ) : (
        <ul className="list">
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
    <li data-testid={`share-item-${item.id}`} className="border-b-hair border-border">
      <div className="r !border-b-0" data-mark={item.day ? undefined : 'hollow'}>
        <span className="tm flex items-center">
          <Link2 className="h-4 w-4 text-ink-lo" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <h3 className="break-words">{heading}</h3>
          {item.text && item.text !== heading && (
            <span className="mt !normal-case !tracking-normal text-ink-mid break-words">
              {item.text}
            </span>
          )}
          {item.url && (
            <span className="mt-1 block text-t-sm">
              {isHttpHref(item.url) ? (
                <a
                  data-testid={`share-item-link-${item.id}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block truncate rounded-r1 text-primary underline underline-offset-2 outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.url}
                </a>
              ) : (
                <span className="block truncate break-all text-ink-mid">{item.url}</span>
              )}
            </span>
          )}
        </span>
        <span className="flex items-start gap-2">
          <span className={item.day ? 'chip chip--struck' : 'hollow-tag'}>
            {item.day ? 'filed' : 'unassigned'}
          </span>
          <button
            type="button"
            data-testid={`share-item-delete-${item.id}`}
            onClick={onDelete}
            aria-label={`Delete shared item: ${heading}`}
            className="inline-flex min-h-tap min-w-tap shrink-0 items-center justify-center rounded-r1 text-ink-mid outline-none transition-colors hover:bg-[hsl(var(--destructive)/0.08)] hover:text-destructive focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-gut pb-3">
        <label htmlFor={selectId} className="pr pr--lo flex items-center gap-1.5">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
          Trip day
        </label>
        <select
          id={selectId}
          data-testid={`share-item-day-${item.id}`}
          value={item.day ?? ''}
          onChange={(e) => onAssign(e.target.value === '' ? undefined : e.target.value)}
          className="min-h-tap min-w-0 flex-1 rounded-r1 border-hair border-[color:var(--border-ui)] bg-surface-raised px-3 py-2 text-t-body text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Unassigned</option>
          {TRIP_DATES.map((day) => (
            <option key={day} value={day}>
              {dayLabel(day)}
            </option>
          ))}
        </select>
        {canImport && (
          <button
            type="button"
            data-testid={`share-item-import-${item.id}`}
            onClick={onImport}
            aria-haspopup="dialog"
            className="btn btn--2 shrink-0 px-4"
          >
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            Import as place
          </button>
        )}
      </div>
    </li>
  );
}
