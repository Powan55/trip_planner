'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';
import { downloadTripBackup, importTripBackup } from '@/core/vault/backup';
import { savePlans } from '@/lib/itinerary-storage';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { useItineraryContext } from '@/components/itinerary-provider';

/**
 * Backup & Restore panel — mounted on `/plan`.
 *
 * Two user-facing controls over the WHOLE TRIP:
 * - EXPORT: downloads the active trip as a single `nepal-japan-trip-backup.json.gz` file via a
 * client-side Blob URL. It carries EVERYTHING local: itinerary, journal,
 * PHOTOS (meta + bytes), expenses, budget, checklists, favorites, map anchors, share inbox.
 * - IMPORT: a file <input> → an explicit CONFIRM dialog (this REPLACES the active trip) →
 * `importTripBackup(file)` → on success the page reloads to re-hydrate every store.
 * A rejected/garbage file never touches live data, and a single malformed domain is dropped,
 * not fatal.
 *
 * PRIVACY: photos are device-local, zero-egress. The copy below states PLAINLY that the
 * backup includes journal AND photos, so downloading a backup can never silently exfiltrate photos —
 * the file only ever lives on the user's own device.
 *
 * A11y / contrast: dark glassmorphism; the quietest caption is `text-ink-mid`, whose token
 * clears AA on every surface step by construction (#27); status/error use their
 * own AA-clearing tints; buttons expose visible focus rings and the file input is a real,
 * keyboard-reachable, labelled `<input type="file">`. No text animates through low opacity.
 *
 * Overlay mounting: the confirm dialog is a `fixed` overlay, so it renders
 * via the mount-guarded `createPortal(…, document.body)` pattern — the SAME as
 * `calendar-planner.tsx`'s `ItemEditor` and `add-to-itinerary-dialog.tsx`. Inline
 * `fixed` route content is trapped by `app/template.tsx`'s `.animate-route-fade` stacking
 * context, so the app `<footer>` (a sibling outside that wrapper) would paint over / capture
 * clicks on the confirm buttons once `/plan` is scrolled down; portaling to `body` lifts the
 * dialog out of that context. The `mounted` guard keeps `document.body` untouched during the
 * static-export prerender.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function BackupRestore() {
  const { restorePlans } = useItineraryContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // The picked file, held while the confirm dialog is open (so Confirm can import it and Cancel can
  // discard it). importTripBackup decompresses + parses the raw file itself, so we don't pre-read.
  const [pendingImport, setPendingImport] = useState<{ file: File; name: string } | null>(null);
  // Guards the confirm button while the async restore runs (a restore reads/writes IndexedDB blobs).
  const [importing, setImporting] = useState(false);
  // Portal mount guard: document.body is only touched after mount, never during
  // the static-export prerender. The `dynamic({ssr:false})` mount on /plan already keeps
  // this off the server render, and this guard is the belt-and-suspenders convention match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Whether this build is syncing for a signed-in traveler. Under sync the itinerary is
  // restored via `restorePlans` (tombstone-replace MERGE — propagates + survives the next snapshot);
  // dormant/guest it is the plain local `savePlans` overwrite. Computed post-mount (getActiveTraveler
  // reads localStorage → client-only) to avoid a hydration mismatch. Drives ONLY which itinerary
  // commit path importTripBackup uses — every other domain is local-only regardless.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    setSynced(isRemoteConfigured() && !!getActiveTraveler());
  }, []);

  const handleExport = async () => {
    try {
      // the WHOLE trip (itinerary + journal + photos + every local domain), gzip-packed via the
      // existing compression pipeline (falls back to plain JSON where CompressionStream is absent).
      // the download mechanics were lifted to `downloadTripBackup()` (a pure lift, same
      // behaviour/error surface) so the sign-out confirm dialog's backup offer can reuse them.
      const filename = await downloadTripBackup();
      setStatus({ kind: 'success', message: `Backed up your whole trip (including journal and photos) to ${filename}.` });
    } catch {
      setStatus({ kind: 'error', message: 'Could not back up your trip. Please try again.' });
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value NOW so picking the same file twice still fires `change`.
    e.target.value = '';
    if (!file) return;
    setStatus({ kind: 'idle' });
    setPendingImport({ file, name: file.name });
  };

  const confirmImport = async () => {
    if (!pendingImport || importing) return;
    setImporting(true);
    // Full-trip restore into the ACTIVE trip. Never-destroy: garbage/malformed data leaves the
    // live trip untouched. The itinerary commit follows the DUAL PATH — `restorePlans` (propagating
    // tombstone-replace) under sync, `savePlans` (local overwrite) otherwise. On success we
    // reload to re-hydrate every store.
    const result = await importTripBackup(
      pendingImport.file,
      undefined,
      synced ? restorePlans : savePlans,
    );
    setImporting(false);
    setPendingImport(null);
    if (result.ok) {
      const skipped =
        result.photosSkipped > 0
          ? ` ${result.photosSkipped} photo${result.photosSkipped === 1 ? '' : 's'} could not be restored (storage limit).`
          : '';
      setStatus({
        kind: 'success',
        message: `Trip restored — itinerary, journal, photos and more are back.${skipped} Reloading…`,
      });
      // Reload so every store re-hydrates from the freshly-written localStorage/IndexedDB. A
      // short delay lets the aria-live status announce before the navigation.
      setTimeout(() => window.location.reload(), 600);
    } else {
      setStatus({ kind: 'error', message: result.error });
    }
  };

  const cancelImport = () => {
    if (importing) return;
    setPendingImport(null);
    setStatus({ kind: 'idle' });
  };

  return (
    <section
      aria-labelledby="backup-restore-title"
      className="mx-auto w-full max-w-5xl px-4 pb-16 sm:px-6"
      data-testid="backup-restore"
    >
      <div className="glass-card rounded-2xl p-6 sm:p-8">
        <div className="mb-5 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <h2
              id="backup-restore-title"
              className="font-display text-xl font-bold text-white sm:text-2xl"
            >
              Backup &amp; Restore
            </h2>
            {/* Describes the panel rather than being its subject → ink-mid. */}
            <p className="mt-1 max-w-2xl text-sm text-ink-mid">
              Save your <strong className="font-semibold text-ink-hi">whole trip</strong> to a single
              file — itinerary, journal, photos, expenses, budget and checklists — or restore it all
              from a backup. Everything is stored on this device; a backup lets you keep a copy or move
              your trip to another browser.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Export */}
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Export</h3>
            <p className="text-sm text-ink-mid">
              Download your entire trip — <strong className="text-white">including your journal and
              photos</strong> — as a single backup file.
            </p>
            <button
              type="button"
              onClick={handleExport}
              data-testid="backup-export-button"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Back up whole trip
            </button>
          </div>

          {/* Import */}
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Import</h3>
            <p className="text-sm text-ink-mid">
              Restore everything from a backup — itinerary, journal and photos. This{' '}
              <strong className="text-white">replaces your current trip</strong>.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="backup-import-trigger"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg border border-ring/60 px-4 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose backup file
            </button>
            {/* Real, keyboard-reachable file input. Visually hidden (not display:none, so
                it stays focusable/labelled); the button above opens it, and E2E drives it
                directly via setInputFiles. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json,.gz,application/gzip"
              onChange={handleFileChange}
              data-testid="backup-import-input"
              aria-label="Choose a trip backup file to import"
              className="sr-only"
            />
          </div>
        </div>

        {/* Status line (success/error). aria-live so a screen reader announces the outcome. */}
        <div aria-live="polite" className="mt-4 min-h-[1.25rem]">
          {status.kind === 'success' && (
            <p data-testid="backup-status" className="text-sm font-medium text-green-300">
              {status.message}
            </p>
          )}
          {status.kind === 'error' && (
            <p
              data-testid="backup-error"
              role="alert"
              className="flex items-center gap-2 text-sm font-medium text-red-300"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {status.message}
            </p>
          )}
        </div>
      </div>

      {/* Confirm dialog — PORTALED to document.body, rendered only while an
          import is pending. Portaling lifts this `fixed` overlay out of /plan's
          `.animate-route-fade` stacking context so the app <footer> can't paint over /
          capture its buttons when the page is scrolled down. Explicit
          shared-trip copy. */}
      {mounted &&
        pendingImport &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-confirm-title"
            data-testid="backup-confirm-dialog"
          >
            <div className="glass-card-dark w-full max-w-md rounded-2xl p-6">
              <div className="mb-3 flex items-center gap-2">
                {/* gold is the warning/danger surface colour generally. This is the
                    destructive-confirm ("cannot be undone") affordance, so it STAYS gold — unlike the
                    reassurance ShieldCheck above, which is decoration and went to ink. */}
                <AlertTriangle className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />
                <h3 id="backup-confirm-title" className="font-display text-lg font-bold text-white">
                  Replace your current trip?
                </h3>
              </div>
              <p className="text-sm text-ink-mid">
                Importing <span className="font-medium text-white">{pendingImport.name}</span> will
                replace your current trip — <strong className="text-white">itinerary, journal, photos</strong>,
                expenses, budget and checklists — with the contents of that file.
              </p>
              <p className="mt-2 text-sm text-ink-mid">
                This replaces the trip <strong className="text-white">on this device</strong> and cannot
                be undone. The page will reload once it&apos;s restored.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelImport}
                  disabled={importing}
                  data-testid="backup-confirm-cancel"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={importing}
                  data-testid="backup-confirm-import"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-60"
                >
                  {importing ? 'Restoring…' : 'Replace trip'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
