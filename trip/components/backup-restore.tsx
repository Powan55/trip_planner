'use client';

import { useRef, useState, useEffect } from 'react';
import { Download, Upload, ShieldCheck, AlertTriangle } from 'lucide-react';
import { downloadTripBackup, importTripBackup } from '@/lib/trip-backup';
import { savePlans } from '@/lib/itinerary-storage';
import { isTripRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler } from '@/lib/token-auth';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useMyPlaces } from '@/hooks/use-my-places';
import { useDocs } from '@/hooks/use-docs';
import { useDialogOpenFlag } from '@/hooks/use-dialog-open-flag';
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

/**
 * Backup & Restore panel — mounted on `/plan`.
 *
 * Two user-facing controls over the WHOLE TRIP:
 * - EXPORT: downloads the active trip as a single `nepal-japan-trip-backup.json.gz` file via a
 * client-side Blob URL. It carries EVERYTHING local: itinerary, journal,
 * PHOTOS (meta + bytes), expenses, budget, checklists, favorites, map anchors, share inbox.
 * - IMPORT: a file <input> → an explicit CONFIRM dialog (replaces itinerary/journal/photos;
 * merges expenses/budget/documents-checklist when synced — issue #346) →
 * `importTripBackup(file)` → on success the page reloads to re-hydrate every store.
 * A rejected/garbage file never touches live data, and a single malformed domain is dropped,
 * not fatal.
 *
 * PRIVACY: photos are device-local, zero-egress. The copy below states PLAINLY that the
 * backup includes journal AND photos, so downloading a backup can never silently exfiltrate photos —
 * the file only ever lives on the user's own device.
 *
 * A11y / contrast: ruled instrument blocks; the quietest caption is `text-ink-mid`, whose token
 * clears AA on every surface step by construction (#27); status/error use their
 * own AA-clearing tints; buttons expose visible focus rings and the file input is a real,
 * keyboard-reachable, labelled `<input type="file">`. No text animates through low opacity.
 *
 * Overlay mounting: the confirm dialog is a `fixed` overlay. Inline `fixed` route content is
 * trapped by `app/template.tsx`'s `.animate-route-fade` stacking context, so the app `<footer>`
 * (a sibling outside that wrapper) would paint over / capture clicks on the confirm buttons once
 * `/plan` is scrolled down; portaling to `body` lifts the dialog out of that context. That is
 * proved from the document in e2e/export-import.spec.ts, and it still holds.
 *
 * THE CONFIRM IS THE HOUSE PRIMITIVE, not a hand-rolled portal. It used to be the latter, with
 * `role="dialog" aria-modal="true"` and nothing behind it: no Escape, no focus trap, no initial
 * focus, no focus restore, and no `body[data-dialog-open]`, so the page scrolled behind the scrim
 * and a keyboard or screen-reader user was never moved into — or told about — an irreversible
 * import that replaces itinerary, journal and photos. `components/ui/alert-dialog.tsx` (Radix,
 * already in the shared bundle via `sign-out-confirm.tsx`, which is this app's other destructive
 * confirm) supplies every one of those, plus `role="alertdialog"` and initial focus on CANCEL,
 * which is the right default for a destructive choice. Outside-click deliberately does not
 * dismiss — Radix's alert dialog reserves dismissal for an explicit answer.
 *
 * `useDialogOpenFlag` is still ours to call: Radix owns its own scroll lock but knows nothing
 * about `body[data-dialog-open]`, which is the seam `components/quick-add-fab.tsx` reads.
 *
 * The confirm button calls `preventDefault()` so the dialog stays up while the async restore
 * runs (the "Restoring…" state); `confirmImport` clears `pendingImport`, which is what closes it.
 */

type Status =
  | { kind: 'idle' }
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string };

export default function BackupRestore() {
  const { restorePlans } = useItineraryContext();
  const { restoreMyPlaces } = useMyPlaces();
  const { restoreDocsChecklist } = useDocs();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Focus-return target. Radix's modal content restores focus to its TRIGGER, and this dialog has
  // none — it is opened by the file input's `change`, so `triggerRef` is null and focus would land
  // on <body>. The button that started the flow is the honest place to put it back.
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // The picked file, held while the confirm dialog is open (so Confirm can import it and Cancel can
  // discard it). importTripBackup decompresses + parses the raw file itself, so we don't pre-read.
  const [pendingImport, setPendingImport] = useState<{ file: File; name: string } | null>(null);
  // Guards the confirm button while the async restore runs (a restore reads/writes IndexedDB blobs).
  const [importing, setImporting] = useState(false);
  // The FAB seam (see the note above). Radix does not set it.
  useDialogOpenFlag(!!pendingImport);
  // Radix keeps the panel mounted through its close animation, by which point `pendingImport` is
  // already null — without this the filename blanks out mid-fade on every cancel.
  const lastImportName = useRef('');
  if (pendingImport) lastImportName.current = pendingImport.name;

  // Whether this build is syncing for a signed-in traveler. Under sync the itinerary is
  // restored via `restorePlans` (tombstone-replace MERGE — propagates + survives the next snapshot);
  // dormant/guest it is the plain local `savePlans` overwrite. Computed post-mount (getActiveTraveler
  // reads localStorage → client-only) to avoid a hydration mismatch. Drives which ITINERARY,
  // myPlaces and docsChecklist commit path importTripBackup uses (myPlaces: `restoreMyPlaces`,
  // tombstone-replace, issue #239; docsChecklist: `restoreDocsChecklist`, a same-id upsert since its
  // 18 ids are fixed, issue #295 — see `lib/trip-backup.ts`'s `CommitMyPlaces`/`CommitDocsChecklist`).
  // Expenses/budget are synced too; importTripBackup still enqueues those through each domain's own
  // outbox-decorated push (a merge, not a replace — the residual gap `trip-backup.ts` documents).
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    setSynced(isTripRemoteConfigured() && !!getActiveTraveler());
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
      synced ? restoreMyPlaces : undefined,
      synced ? restoreDocsChecklist : undefined,
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
      className="w-full"
      data-testid="backup-restore"
    >
      <div className="border-hair border-border bg-surface-raised px-gut py-4">
        <div className="mb-5 flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-ink-lo" aria-hidden="true" />
          <div>
            <h2
              id="backup-restore-title"
              className="pr pr--l text-ink-hi"
            >
              Backup &amp; Restore
            </h2>
            {/* Describes the panel rather than being its subject → ink-mid. */}
            <p className="mt-1 max-w-2xl text-t-body text-ink-mid">
              Save your <strong className="font-semibold text-ink-hi">whole trip</strong> to a single
              file — itinerary, journal, photos, expenses, budget and checklists — or restore it all
              from a backup. Everything is stored on this device; a backup lets you keep a copy or move
              your trip to another browser.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Export */}
          <div className="flex flex-col gap-2 border-hair border-border bg-surface-low px-gut py-4">
            <h3 className="pr pr--l text-ink-hi">Export</h3>
            <p className="text-t-body text-ink-mid">
              Download your entire trip — <strong className="font-semibold text-ink-hi">including your journal and
              photos</strong> — as a single backup file.
            </p>
            <button
              type="button"
              onClick={handleExport}
              data-testid="backup-export-button"
              className="btn mt-1 px-4"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Back up whole trip
            </button>
          </div>

          {/* Import */}
          <div className="flex flex-col gap-2 border-hair border-border bg-surface-low px-gut py-4">
            <h3 className="pr pr--l text-ink-hi">Import</h3>
            <p className="text-t-body text-ink-mid">
              Restore everything from a backup — itinerary, journal and photos. This{' '}
              <strong className="font-semibold text-ink-hi">replaces your current trip</strong>.
            </p>
            <button
              ref={importTriggerRef}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="backup-import-trigger"
              className="btn btn--2 mt-1 px-4"
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
            <p data-testid="backup-status" className="text-t-body font-medium text-ink-hi">
              {status.message}
            </p>
          )}
          {status.kind === 'error' && (
            <p
              data-testid="backup-error"
              role="alert"
              className="err flex items-center gap-2 text-t-body font-medium"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {status.message}
            </p>
          )}
        </div>
      </div>

      {/* Confirm — see the modal-contract note at the top of this file. Controlled by
          `pendingImport`, so the dialog closes only when the pending file is cleared. */}
      <AlertDialog
        open={!!pendingImport}
        onOpenChange={(open) => {
          if (!open) cancelImport();
        }}
      >
        <AlertDialogContent
          // Radix does not set this; it hides the rest of the document with `aria-hidden`
          // instead — except that `hideOthers` deliberately skips any subtree containing an
          // `aria-live` region, and this panel has one (the export/import status line). Keeping
          // the attribute the hand-rolled dialog already carried costs nothing and closes that
          // hole for the ATs that read it.
          aria-modal="true"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            importTriggerRef.current?.focus();
          }}
          className="max-w-md border-2 border-border bg-surface-low"
          data-testid="backup-confirm-dialog"
        >
          {/* The primitive centres its header on mobile; two paragraphs of prose read badly that
              way, and the panel it replaces was left-aligned at every width. */}
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle className="flex items-center gap-2">
              {/* The destructive-confirm ("cannot be undone") affordance, so it carries
                  --destructive — unlike the reassurance ShieldCheck above, which is decoration
                  and sits on the ink ramp. The retired gold literal is gone with the rest. */}
              <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
              Replace your current trip?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Importing{' '}
              <span className="font-machine text-t-sm text-ink-hi">{lastImportName.current}</span> will
              replace your <strong className="font-semibold text-ink-hi">itinerary, journal and photos</strong> with
              the contents of that file.{' '}
              {synced ? (
                <>
                  Expenses, budget and the documents checklist are merged instead — anything you&apos;ve
                  changed on this trip since the backup was made is kept.
                </>
              ) : (
                <>Expenses, budget and checklists are replaced too.</>
              )}
            </AlertDialogDescription>
            {/* A second <AlertDialogDescription> would duplicate Radix's aria-describedby id, so
                this half is a plain paragraph — it is elaboration, and the described-by text
                above already carries what the choice is. */}
            <p className="text-t-body text-[color:var(--text-mid)]">
              This changes the trip <strong className="font-semibold text-ink-hi">on this device</strong> and cannot
              be undone. The page will reload once it&apos;s restored.
            </p>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={importing}
              data-testid="backup-confirm-cancel"
              className="btn btn--2 px-4"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault(); // stay open while the restore runs — see the note up top
                void confirmImport();
              }}
              disabled={importing}
              data-testid="backup-confirm-import"
              className="btn btn--danger px-4"
            >
              {importing ? 'Restoring…' : 'Replace trip'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
