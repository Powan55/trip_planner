'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Upload, ShieldCheck, AlertTriangle, Info } from 'lucide-react';
import { exportItinerary, importItinerary } from '@/core/vault/export-import';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';

/**
 * Backup & Restore panel — mounted on `/plan`.
 *
 * Two user-facing controls over the WHOLE itinerary:
 *   - EXPORT: downloads the current trip as `nepal-japan-trip.json` (a v3 Vault
 *     envelope) via a client-side Blob URL — no server involved.
 *   - IMPORT: a file <input> → read text → an explicit CONFIRM dialog (this is a
 *     destructive, and on a synced trip a shared, replace) → `importItinerary()` →
 *     success or a SAFE error. A rejected import never touches the live trip.
 *
 * Sync note (honest containment): on a build with sync configured AND an active
 * traveler signed in, RESTORE/import is DISABLED. Import is an ingest-style path that never
 * pushes (per the push-only-from-local-commits rule), so on a synced trip the next snapshot
 * merge would resurrect removed items and a reload's first-snapshot-authoritative apply would
 * revert the restore wholesale — i.e. it silently does not stick. Rather than ship that trap,
 * Restore is limited to LOCAL MODE ONLY for now (Export stays always available; guests and the
 * dormant/portfolio build keep Restore unchanged). Future work: make Restore a real
 * tombstone-replace that propagates to the shared trip.
 *
 * A11y / contrast: dark glassmorphism; the most-muted caption is `text-white/60`
 * (well above the AA 4.5:1 floor of `/50` = 5.32:1 on `#0a0e27`); status/error use their
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

const EXPORT_FILENAME = 'nepal-japan-trip.json';

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function BackupRestore() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // The picked file's text, held while the confirm dialog is open (so Confirm can
  // import it and Cancel can discard it without re-reading the file).
  const [pendingImport, setPendingImport] = useState<{ text: string; name: string } | null>(null);
  // Portal mount guard: document.body is only touched after mount, never during
  // the static-export prerender. The `dynamic({ssr:false})` mount on /plan already keeps
  // this off the server render, and this guard is the belt-and-suspenders convention match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Restore is available in LOCAL mode only for now. When sync is configured AND a traveler is
  // signed in, an ingest-style import doesn't propagate + gets reverted by the next snapshot merge,
  // so we disable it. Computed post-mount (getActiveTraveler reads localStorage → client-only) to
  // avoid a hydration mismatch; the dormant build + guests always resolve `false` (Restore enabled).
  const [restoreBlocked, setRestoreBlocked] = useState(false);
  useEffect(() => {
    setRestoreBlocked(isRemoteConfigured() && !!getActiveTraveler());
  }, []);

  const handleExport = () => {
    try {
      const json = exportItinerary();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = EXPORT_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus({ kind: 'success', message: `Exported your trip to ${EXPORT_FILENAME}.` });
    } catch {
      setStatus({ kind: 'error', message: 'Could not export your trip. Please try again.' });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value NOW so picking the same file twice still fires `change`.
    e.target.value = '';
    // defense-in-depth: never ingest a file while Restore is sync-blocked (the button is also
    // disabled, but the input can be driven directly).
    if (restoreBlocked || !file) return;
    try {
      const text = await file.text();
      setStatus({ kind: 'idle' });
      setPendingImport({ text, name: file.name });
    } catch {
      setStatus({ kind: 'error', message: 'Could not read that file. No changes were made to your trip.' });
    }
  };

  const confirmImport = () => {
    if (restoreBlocked || !pendingImport) return;
    const result = importItinerary(pendingImport.text);
    setPendingImport(null);
    if (result.ok) {
      setStatus({
        kind: 'success',
        message: 'Trip imported. Your planner has been updated with the imported itinerary.',
      });
    } else {
      setStatus({ kind: 'error', message: result.error });
    }
  };

  const cancelImport = () => {
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
          <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-gold-400" aria-hidden="true" />
          <div>
            <h2
              id="backup-restore-title"
              className="font-display text-xl font-bold text-white sm:text-2xl"
            >
              Backup &amp; Restore
            </h2>
            {/* Most-muted caption — text-white/60 clears AA on #0a0e27. */}
            <p className="mt-1 max-w-2xl text-sm text-white/60">
              Save your whole itinerary to a file, or restore it from a backup. Everything is stored
              on this device — a backup lets you keep a copy or move your trip to another browser.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Export */}
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Export</h3>
            <p className="text-sm text-white/70">
              Download your entire trip as a <code className="text-gold-400">.json</code> file.
            </p>
            <button
              type="button"
              onClick={handleExport}
              data-testid="backup-export-button"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gold-400 px-4 py-2.5 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export trip
            </button>
          </div>

          {/* Import */}
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Import</h3>
            {restoreBlocked ? (
              // sync-configured + signed-in ⇒ Restore is local-mode-only for now.
              <p
                data-testid="backup-restore-sync-note"
                className="flex items-start gap-2 text-sm text-white/70"
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-400/80" aria-hidden="true" />
                <span>
                  Restore is available in local mode only for now — it can&apos;t yet replace the
                  shared synced trip.
                </span>
              </p>
            ) : (
              <p className="text-sm text-white/70">
                Restore from a backup file. This <strong className="text-white">replaces</strong>{' '}
                your current trip.
              </p>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={restoreBlocked}
              data-testid="backup-import-trigger"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg border border-gold-400/60 px-4 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 disabled:cursor-not-allowed disabled:border-white/15 disabled:text-white/40 disabled:hover:bg-transparent"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose backup file
            </button>
            {/* Real, keyboard-reachable file input. Visually hidden (not display:none, so
                it stays focusable/labelled); the button above opens it, and E2E drives it
                directly via setInputFiles. Disabled while Restore is sync-blocked. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              disabled={restoreBlocked}
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
          shared-trip copy in the dialog body. */}
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
                <AlertTriangle className="h-5 w-5 shrink-0 text-gold-400" aria-hidden="true" />
                <h3 id="backup-confirm-title" className="font-display text-lg font-bold text-white">
                  Replace your current trip?
                </h3>
              </div>
              <p className="text-sm text-white/70">
                Importing <span className="font-medium text-white">{pendingImport.name}</span> will
                overwrite your current itinerary with the contents of that file.
              </p>
              <p className="mt-2 text-sm text-white/70">
                This replaces the itinerary{' '}
                <strong className="text-white">on this device</strong>. This cannot be undone.
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelImport}
                  data-testid="backup-confirm-cancel"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  data-testid="backup-confirm-import"
                  className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-navy-900 transition-colors hover:bg-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900"
                >
                  Replace trip
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}
