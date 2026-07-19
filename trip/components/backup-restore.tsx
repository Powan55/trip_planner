'use client';

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';
import { exportItinerary, importItinerary, parseBackup } from '@/core/vault/export-import';
import { compressToBlob, decompressBlobOrText, supportsCompression } from '@/core/vault/compression';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { useItineraryContext } from '@/components/itinerary-provider';

/**
 * Backup & Restore panel — mounted on `/plan`.
 *
 * Two user-facing controls over the WHOLE itinerary:
 * - EXPORT: downloads the current trip as `nepal-japan-trip.json` (a v3 Vault
 * envelope) via a client-side Blob URL — no server.
 * - IMPORT: a file <input> → read text → an explicit CONFIRM dialog (this is a
 * destructive, and on a synced trip a shared, replace) → `importItinerary()` →
 * success or a SAFE error. A rejected import never touches the live trip.
 *
 * Sync note: Restore now works under
 * sync. On a synced, signed-in build a Restore is applied as a tombstone-replace MERGE, not an
 * ingest-overwrite: `parseBackup()` validates the file with the same trust boundary, then the
 * store's `restorePlans()` tombstones the current items and re-adds the backup's items as fresh-id
 * copies through the normal `commit()`/outbox fan-out — so it PROPAGATES to the shared trip and
 * survives the next snapshot. Dormant/guest keep the plain local `importItinerary` overwrite
 * (nothing to unwind). Export stays always available.
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
// gzip-compressed exports (native CompressionStream) get a `.gz` filename; the bytes
// stay auto-detected on import by gzip magic bytes regardless of what a user renames the
// file to (see `core/vault/compression.ts`).
const EXPORT_FILENAME_GZ = 'nepal-japan-trip.json.gz';

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function BackupRestore() {
  const { restorePlans } = useItineraryContext();
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

  // Whether this build is syncing for a signed-in traveler. Under sync a Restore is a
  // tombstone-replace MERGE via `restorePlans` (propagates + survives the next snapshot); dormant/
  // guest it is the plain local `importItinerary` overwrite. Computed post-mount (getActiveTraveler
  // reads localStorage → client-only) to avoid a hydration mismatch; the dormant build + guests
  // always resolve `false`. Drives only the confirm-dialog copy + which restore path runs — Restore
  // is ENABLED in every mode now.
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    setSynced(isRemoteConfigured() && !!getActiveTraveler());
  }, []);

  const handleExport = async () => {
    try {
      const json = exportItinerary();
      // gzip via native CompressionStream when supported (compressToBlob feature-
      // detects and falls back to a plain-text Blob — same bytes as before — when not).
      const blob = await compressToBlob(json);
      const filename = supportsCompression() ? EXPORT_FILENAME_GZ : EXPORT_FILENAME;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus({ kind: 'success', message: `Exported your trip to ${filename}.` });
    } catch {
      setStatus({ kind: 'error', message: 'Could not export your trip. Please try again.' });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input value NOW so picking the same file twice still fires `change`.
    e.target.value = '';
    if (!file) return;
    try {
      // auto-detects gzip vs plain by magic bytes (not extension), so both a
      // freshly-compressed export AND an old pre- plain-JSON export import here.
      const text = await decompressBlobOrText(file);
      setStatus({ kind: 'idle' });
      setPendingImport({ text, name: file.name });
    } catch {
      setStatus({ kind: 'error', message: 'Could not read that file. No changes were made to your trip.' });
    }
  };

  const confirmImport = () => {
    if (!pendingImport) return;
    // SYNC: validate with the same trust boundary, then apply as a tombstone-replace merge
    // through the store so the restore propagates + survives the next snapshot. DORMANT/guest: the
    // plain local overwrite (`importItinerary`), which also writes + fires the change event.
    let result: { ok: true } | { ok: false; error: string };
    if (synced) {
      const parsed = parseBackup(pendingImport.text);
      if (parsed.ok) {
        restorePlans(parsed.plans);
        result = { ok: true };
      } else {
        result = parsed;
      }
    } else {
      result = importItinerary(pendingImport.text);
    }
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
            {}/* Most-muted caption — text-white/60 clears AA on #0a0e27. */
            <p className="mt-1 max-w-2xl text-sm text-white/60">
              Save your whole itinerary to a file, or restore it from a backup. Everything is stored
              on this device — a backup lets you keep a copy or move your trip to another browser.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {}/* Export */
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Export</h3>
            <p className="text-sm text-white/70">
              Download your entire trip as a <code className="text-gold-400">.json</code> file.
            </p>
            <button
              type="button"
              onClick={handleExport}
              data-testid="backup-export-button"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gold-400 px-4 py-2.5 text-sm font-semibold text-surface transition-colors hover:bg-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Export trip
            </button>
          </div>

          {}/* Import */
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <h3 className="text-sm font-semibold text-white">Import</h3>
            <p className="text-sm text-white/70">
              Restore from a backup file. This <strong className="text-white">replaces</strong>{' '}
              {synced ? 'the shared trip' : 'your current trip'}.
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="backup-import-trigger"
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg border border-gold-400/60 px-4 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              Choose backup file
            </button>
            {/* Real, keyboard-reachable file input. Visually hidden (not display:none, so
                it stays focusable/labelled); the button above opens it, and E2E drives it
}                directly via setInputFiles. */
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              onChange={handleFileChange}
              data-testid="backup-import-input"
              aria-label="Choose a trip backup file to import"
              className="sr-only"
            />
          </div>
        </div>

        {}/* Status line (success/error). aria-live so a screen reader announces the outcome. */
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
}          shared-trip copy. */
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
                {synced ? (
                  <>
                    This replaces the{' '}
                    <strong className="text-white">shared trip for everyone</strong>. This cannot be
                    undone.
                  </>
                ) : (
                  <>
                    This replaces the itinerary{' '}
                    <strong className="text-white">on this device</strong>. This cannot be undone.
                  </>
                )}
              </p>
              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={cancelImport}
                  data-testid="backup-confirm-cancel"
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmImport}
                  data-testid="backup-confirm-import"
                  className="rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-surface transition-colors hover:bg-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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
