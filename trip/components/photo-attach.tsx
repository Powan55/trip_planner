'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Camera, ImageOff, Trash2, X, Check } from 'lucide-react';
import { usePhotos } from '@/hooks/use-photos';
import { usePhotoObjectUrl } from '@/hooks/use-photo-object-url';
import PhotoLightbox from '@/components/photo-lightbox';
import type { PhotoMeta, PhotoOwner } from '@/core/photos/model';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

/**
 * PhotoAttach — the ONE reusable capture/render surface for journal
 * day-photos (owner `{kind:'journal',date}`), expense receipts (owner `{kind:'expense',expenseId}`),
 * and docs-checklist attachments (owner `{kind:'docs',itemId}`, #258 — passport/visa/boarding-pass scans).
 * Renders the owner's photos as thumbnails (resolved from `BlobStorePort.get` → object URL, revoked on
 * unmount), an "Add photo" control (downscale → store, with a REQUIRED alt-text + optional caption
 * prompt), a graceful placeholder for an evicted/absent blob (alt/caption survive), and inline
 * quota/unavailable/decode states.
 *
 * ZERO EGRESS: everything here reads/writes ONLY `usePhotos` (key-16 meta) + the local
 * `BlobStorePort` (IndexedDB) — no network, no sync, no export path.
 *
 * A11y: labelled file input + alt/caption fields, `alt` on every `<img>`, ≥44px
 * targets, the app-wide accent focus ring, an `aria-live` error region. CSS-only transitions →
 * reduced-motion safe by construction.
 */
export default function PhotoAttach({
  owner,
  heading = 'Photos',
  altPlaceholder = 'Describe this photo',
  helperText,
}: {
  owner: PhotoOwner;
  heading?: string;
  altPlaceholder?: string;
  /** Optional note rendered under the heading (e.g. the docs-row on-device-only + sensitivity copy). */
  helperText?: ReactNode;
}) {
  const { photosFor, addPhoto, removePhoto, hydrated } = usePhotos();
  const photos = photosFor(owner);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const altInputRef = useRef<HTMLInputElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // Unique field ids so two PhotoAttach instances on one page never share a label target (a11y).
  const baseId = useId();
  const altId = `${baseId}-alt`;
  const captionId = `${baseId}-caption`;

  // A picked-but-not-yet-saved file, held while the alt/caption prompt is open.
  const [pending, setPending] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Delete confirm gate (#116). The blob is gone from IndexedDB the moment `removePhoto` runs and
  // there is no capture-and-restore path for the bytes, so this is the confirm arm of the
  // house pattern, not the undo arm.
  const [pendingDelete, setPendingDelete] = useState<PhotoMeta | null>(null);
  // Lightbox (#225): the thumbnail a photo is currently opened from + its trigger element, so
  // closing can return focus there (the shared Sheet primitive's parent-owned focus-return idiom).
  const [lightboxPhoto, setLightboxPhoto] = useState<PhotoMeta | null>(null);
  const lightboxTriggerRef = useRef<HTMLElement | null>(null);

  // Focus the alt field when the prompt opens (first-field-on-open, mirrors the journal editor).
  useEffect(() => {
    if (pending) altInputRef.current?.focus();
  }, [pending]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    // Reset the input so re-picking the same file re-fires change.
    e.target.value = '';
    if (!file) return;
    setError(null);
    setAlt('');
    setCaption('');
    setPending(file);
  };

  const cancelPending = () => {
    setPending(null);
    setSaving(false);
    addButtonRef.current?.focus();
  };

  const reasonMessage = (reason: 'quota' | 'unavailable' | 'decode'): string => {
    switch (reason) {
      case 'quota':
        return 'Device photo storage is full — the photo was not saved.';
      case 'unavailable':
        return "Photos aren't available in this browser mode.";
      case 'decode':
      default:
        return "Couldn't read that image — try a different photo.";
    }
  };

  const savePending = async () => {
    if (!pending || !alt.trim() || saving) return;
    setSaving(true);
    setError(null);
    const result = await addPhoto(owner, pending, alt, caption);
    if (result.ok) {
      setPending(null);
      setSaving(false);
      addButtonRef.current?.focus();
    } else {
      setSaving(false);
      setError(reasonMessage(result.reason));
      // Keep the prompt open on quota/unavailable so the words aren't lost; drop the file on decode.
      if (result.reason === 'decode') setPending(null);
    }
  };

  return (
    <section data-testid="photo-attach" aria-label={heading} className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="pr flex items-center gap-2">
          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          {heading}
        </h4>
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="photo-add-button"
          className="chip min-h-tap shrink-0 gap-1.5 px-3 outline-none transition-colors hover:bg-white/5 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Add photo
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onPick}
          data-testid="photo-file-input"
          aria-label={`Add a photo to ${heading}`}
          className="sr-only"
        />
      </div>

      {helperText && (
        <p data-testid="photo-helper-text" className="mb-3 text-t-sm text-ink-mid">
          {helperText}
        </p>
      )}

      {/* Alt-text (required) + caption (optional) prompt, shown after a file is picked. */}
      {pending && (
        <div data-testid="photo-prompt" className="mb-3 space-y-3 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-raised))] p-3">
          <div>
            <label htmlFor={altId} className="pr pr--lo mb-1 block">
              Describe this photo <span className="text-ink-hi">(required)</span>
            </label>
            <input
              ref={altInputRef}
              id={altId}
              type="text"
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              maxLength={200}
              placeholder={altPlaceholder}
              data-testid="photo-alt-input"
              className="w-full min-h-tap rounded-r1 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface))] px-3 py-2 text-t-body text-ink-hi placeholder:text-ink-lo outline-none transition-colors duration-200 focus-visible:border-[color:hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div>
            <label htmlFor={captionId} className="pr pr--lo mb-1 block">
              Caption (optional)
            </label>
            <input
              id={captionId}
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={200}
              placeholder="A note to remember it by…"
              data-testid="photo-caption-input"
              className="w-full min-h-tap rounded-r1 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface))] px-3 py-2 text-t-body text-ink-hi placeholder:text-ink-lo outline-none transition-colors duration-200 focus-visible:border-[color:hsl(var(--accent))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelPending}
              data-testid="photo-cancel"
              className="chip min-h-tap gap-1.5 px-3 outline-none transition-colors hover:bg-white/5 hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </button>
            <button
              type="button"
              onClick={savePending}
              disabled={!alt.trim() || saving}
              data-testid="photo-save"
              className="btn px-4 focus-visible:outline-none"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {saving ? 'Saving…' : 'Save photo'}
            </button>
          </div>
        </div>
      )}

      {/* The region is mounted always and is empty (and boxless — the margin is on the <p>)
          until there is something to say: a live region announces a MUTATION of a region
          already in the tree, so one inserted together with its text is not reliably
          announced. Same idiom as settings-panel.tsx / backup-restore.tsx. */}
      <div role="status" aria-live="polite">
        {error && (
          <p data-testid="photo-error" className="err mb-3 text-t-body">
            {error}
          </p>
        )}
      </div>

      {/* Thumbnails. Empty (and no pending prompt) → a quiet hint; blobs resolve per-mount. */}
      {photos.length > 0 ? (
        <ul data-testid="photo-grid" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((meta) => (
            <PhotoThumb
              key={meta.id}
              meta={meta}
              onDelete={() => setPendingDelete(meta)}
              onOpen={() => {
                lightboxTriggerRef.current = (document.activeElement as HTMLElement) ?? null;
                setLightboxPhoto(meta);
              }}
            />
          ))}
        </ul>
      ) : (
        !pending && (
          // 9.8: an empty state renders the SHAPE of the thing that is missing, at the
          // size it will be — three thumbnail slots drawn hollow in the grid the photos
          // will land in — plus the condition, in words, at --t-body. Never a grey
          // sentence at --t-micro, which is smaller than body copy and is the line a
          // first-run user reads most.
          <div data-testid="photo-empty">
            <ul aria-hidden="true" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {[0, 1, 2].map((i) => (
                <li key={i} className="empty-frame aspect-square" />
              ))}
            </ul>
            <p className="empty mt-2">
              {hydrated ? 'No photos on file yet.' : 'No photos on file yet…'}
            </p>
          </div>
        )
      )}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent className="bg-[rgb(var(--surface-low))] border-hair border-[color:var(--border-ui)] rounded-r2 text-ink-hi" data-testid="photo-delete-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this photo?</AlertDialogTitle>
            <AlertDialogDescription className="text-t-body text-ink-mid">
              {pendingDelete?.caption ?? pendingDelete?.altText} — this deletes it from this device
              for good. It is not backed up anywhere and there is no undo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="photo-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="photo-delete-action"
              onClick={() => {
                if (pendingDelete) void removePhoto(pendingDelete.id);
                setPendingDelete(null);
              }}
              className="btn btn--danger"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PhotoLightbox
        open={lightboxPhoto !== null}
        photo={lightboxPhoto}
        onClose={() => setLightboxPhoto(null)}
        onExitComplete={() => lightboxTriggerRef.current?.focus?.()}
      />
    </section>
  );
}

/**
 * A single thumbnail. Resolves the blob → object URL on mount (revoking on unmount/id-change); an
 * absent/evicted blob (`get` → null) degrades to a placeholder tile that KEEPS the alt/caption text —
 * the words survive even when the pixels don't. The `<img alt>` is always the stored
 * alt text (a11y, never empty by construction — `addPhoto` requires it).
 */
function PhotoThumb({
  meta,
  onDelete,
  onOpen,
}: {
  meta: PhotoMeta;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const { url, missing } = usePhotoObjectUrl(meta.id);

  return (
    <li data-testid={`photo-thumb-${meta.id}`} className="relative aspect-square overflow-hidden rounded-r1 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-low))]">
      {missing ? (
        <div
          data-testid={`photo-placeholder-${meta.id}`}
          className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
          title={meta.caption ?? meta.altText}
        >
          <ImageOff className="h-4 w-4 text-ink-lo" aria-hidden="true" />
          <span className="line-clamp-2 text-t-micro leading-tight text-ink-mid">
            {meta.caption ?? meta.altText}
          </span>
          <span className="sr-only">Photo no longer on this device</span>
        </div>
      ) : url ? (
        // Opens the lightbox (#225). The delete button below is a SIBLING absolutely positioned
        // over this tile, not a wrapper around the image, so no stopPropagation is needed here.
        <button
          type="button"
          onClick={onOpen}
          data-testid={`photo-open-${meta.id}`}
          aria-label={`View photo: ${meta.altText}`}
          className="block h-full w-full outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL of a device-only blob; next/image can't optimize a runtime Blob and disables optimization anyway. */}
          <img
            src={url}
            alt={meta.altText}
            data-testid={`photo-img-${meta.id}`}
            className="h-full w-full object-cover"
          />
        </button>
      ) : (
        // No shimmer and no pulse over a photograph — a sweep there reads as a rendering
        // fault. The word is a real text node, because a plain grey tile is
        // indistinguishable from an empty slot.
        <div className="load h-full w-full" aria-hidden="true">
          <span className="pr pr--lo">Loading</span>
        </div>
      )}

      {(meta.caption || meta.altText) && !missing && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-t-micro text-ink-hi">
          {meta.caption ?? meta.altText}
        </span>
      )}

      {/* Permanently visible, NOT hover/focus-revealed. A touch device fires neither,
          so the hover-only version left no way to remove a photo on this feature's primary
          device. It sits on a bg-black/70 chip over the caption's from-black/70 gradient — 70%
          and not 50% because the worst-case pixel under it is a white one, where 50% measures
          3.54:1 against the glyph and 70% measures 8.45:1. */}
      <button
        type="button"
        onClick={onDelete}
        data-testid={`photo-delete-${meta.id}`}
        aria-label={`Remove photo: ${meta.altText}`}
        className="absolute right-1 top-1 inline-flex h-tap w-tap items-center justify-center rounded-r1 bg-black/70 text-ink-hi outline-none transition-colors hover:bg-[color:hsl(var(--destructive))] hover:text-[color:var(--on-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}
