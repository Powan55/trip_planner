'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Camera, ImageOff, Trash2, X, Check } from 'lucide-react';
import { usePhotos } from '@/hooks/use-photos';
import { usePhotoObjectUrl } from '@/hooks/use-photo-object-url';
import type { PhotoMeta, PhotoOwner } from '@/core/photos/model';

/**
 * PhotoAttach — the ONE reusable capture/render surface for BOTH journal
 * day-photos (owner `{kind:'journal',date}`) and expense receipts (owner `{kind:'expense',expenseId}`).
 * Renders the owner's photos as thumbnails (resolved from `BlobStorePort.get` → object URL, revoked on
 * unmount), an "Add photo" control (downscale → store, with a REQUIRED alt-text + optional caption
 * prompt), a graceful placeholder for an evicted/absent blob (alt/caption survive), and inline
 * quota/unavailable/decode states.
 *
 * ZERO EGRESS: everything here reads/writes ONLY `usePhotos` (key-16 meta) + the local
 * `BlobStorePort` (IndexedDB) — no network, no sync, no export path.
 *
 * A11y: labelled file input + alt/caption fields, `alt` on every `<img>`, ≥44px
 * targets, visible gold focus rings, an `aria-live` error region. CSS-only transitions → reduced-motion
 * safe by construction.
 */
export default function PhotoAttach({
  owner,
  heading = 'Photos',
  altPlaceholder = 'Describe this photo',
}: {
  owner: PhotoOwner;
  heading?: string;
  altPlaceholder?: string;
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
        <h4 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-gold-400/90">
          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          {heading}
        </h4>
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="photo-add-button"
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white/70 outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
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

      {/* Alt-text (required) + caption (optional) prompt, shown after a file is picked. */}
      {pending && (
        <div data-testid="photo-prompt" className="mb-3 space-y-3 rounded-lg border border-white/15 bg-surface/60 p-3">
          <div>
            <label htmlFor={altId} className="mb-1.5 block text-xs font-medium text-white/60">
              Describe this photo <span className="text-gold-300/90">(required)</span>
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
              className="w-full min-h-[44px] rounded-lg border border-white/15 bg-surface/60 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none transition-colors duration-200 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
            />
          </div>
          <div>
            <label htmlFor={captionId} className="mb-1.5 block text-xs font-medium text-white/60">
              Caption <span className="text-white/45">(optional)</span>
            </label>
            <input
              id={captionId}
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              maxLength={200}
              placeholder="A note to remember it by…"
              data-testid="photo-caption-input"
              className="w-full min-h-[44px] rounded-lg border border-white/15 bg-surface/60 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none transition-colors duration-200 focus-visible:border-gold-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={cancelPending}
              data-testid="photo-cancel"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-white/70 outline-none transition-colors duration-200 hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </button>
            <button
              type="button"
              onClick={savePending}
              disabled={!alt.trim() || saving}
              data-testid="photo-save"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-gold-400 px-4 py-2 text-sm font-semibold text-surface outline-none transition-colors duration-200 hover:bg-gold-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-4 w-4" aria-hidden="true" />
              {saving ? 'Saving…' : 'Save photo'}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p data-testid="photo-error" role="status" aria-live="polite" className="mb-3 text-xs text-gold-300">
          {error}
        </p>
      )}

      {/* Thumbnails. Empty (and no pending prompt) → a quiet hint; blobs resolve per-mount. */}
      {photos.length > 0 ? (
        <ul data-testid="photo-grid" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((meta) => (
            <PhotoThumb key={meta.id} meta={meta} onDelete={() => removePhoto(meta.id)} />
          ))}
        </ul>
      ) : (
        !pending && (
          <p className="text-xs text-white/45" data-testid="photo-empty">
            {hydrated ? 'No photos yet.' : 'No photos yet…'}
          </p>
        )
      )}
    </section>
  );
}

/**
 * A single thumbnail. Resolves the blob → object URL on mount (revoking on unmount/id-change); an
 * absent/evicted blob (`get` → null) degrades to a placeholder tile that KEEPS the alt/caption text —
 * the words survive even when the pixels don't. The `<img alt>` is always the stored
 * alt text (a11y, never empty by construction — `addPhoto` requires it).
 */
function PhotoThumb({ meta, onDelete }: { meta: PhotoMeta; onDelete: () => void }) {
  const { url, missing } = usePhotoObjectUrl(meta.id);

  return (
    <li data-testid={`photo-thumb-${meta.id}`} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-white/[0.03]">
      {missing ? (
        <div
          data-testid={`photo-placeholder-${meta.id}`}
          className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
          title={meta.caption ?? meta.altText}
        >
          <ImageOff className="h-4 w-4 text-white/40" aria-hidden="true" />
          <span className="line-clamp-2 text-[10px] leading-tight text-white/50">
            {meta.caption ?? meta.altText}
          </span>
          <span className="sr-only">Photo no longer on this device</span>
        </div>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL of a device-only blob; next/image can't optimize a runtime Blob and disables optimization anyway.
        <img
          src={url}
          alt={meta.altText}
          data-testid={`photo-img-${meta.id}`}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-white/[0.04]" aria-hidden="true" />
      )}

      {(meta.caption || meta.altText) && !missing && (
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-[10px] text-white/80">
          {meta.caption ?? meta.altText}
        </span>
      )}

      <button
        type="button"
        onClick={onDelete}
        data-testid={`photo-delete-${meta.id}`}
        aria-label={`Remove photo: ${meta.altText}`}
        className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/50 text-white/80 opacity-0 outline-none transition-opacity duration-200 hover:bg-red-500/70 hover:text-white focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}
