'use client';

import { useId } from 'react';
import { ImageOff, X } from 'lucide-react';
import Sheet from '@/components/ui/sheet-dark';
import { usePhotoObjectUrl } from '@/hooks/use-photo-object-url';
import type { PhotoMeta } from '@/core/photos/model';

/**
 * PhotoLightbox — the one full-size viewer every thumbnail opens into (issue #225). Every photo
 * render path (`photo-attach.tsx`, `journal-browse.tsx`, `trip-story-recap.tsx`) was a fixed
 * thumbnail with no way to see it larger; this is a thin `Sheet` (`side: 'center'`) wrapper that
 * resolves the SAME `usePhotoObjectUrl` blob the thumbnails already use — no new fetch, no new
 * persistence. No zoom/pan/gallery-navigation (out of scope for #225).
 *
 * Portal, Escape, backdrop-click, Tab-trap, autofocus and parent-owned focus-return all come from
 * `Sheet` — this component owns only the image, its caption, and the close button.
 */
export interface PhotoLightboxProps {
  open: boolean;
  photo: PhotoMeta | null;
  onClose(): void;
  /** parent-owned focus-return, fired on the Sheet's exit-complete. */
  onExitComplete?(): void;
}

export default function PhotoLightbox({ open, photo, onClose, onExitComplete }: PhotoLightboxProps) {
  const titleId = useId();
  const { url, missing } = usePhotoObjectUrl(photo?.id ?? '');

  return (
    <Sheet
      open={open && photo != null}
      onClose={onClose}
      onExitComplete={onExitComplete}
      labelledBy={titleId}
      side="center"
      testId="photo-lightbox"
      className="w-full max-w-3xl max-h-[90vh] rounded-r2"
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-2 pt-4">
        <h3 id={titleId} className="sr-only">
          {photo?.altText ?? 'Photo'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          data-testid="photo-lightbox-close"
          aria-label="Close photo"
          className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r1 text-[color:var(--text-lo)] outline-none transition-colors duration-200 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-4">
        {photo && !missing && url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL of a device-only blob; next/image can't optimize a runtime Blob and disables optimization anyway.
          <img
            src={url}
            alt={photo.altText}
            data-testid="photo-lightbox-image"
            className="max-h-[75vh] max-w-full rounded-r1 object-contain"
          />
        ) : photo && missing ? (
          <div
            data-testid="photo-lightbox-missing"
            className="flex flex-col items-center gap-2 p-8 text-center"
          >
            <ImageOff className="h-8 w-8 text-ink-lo" aria-hidden="true" />
            <span className="empty">{photo.caption ?? photo.altText}</span>
            <span className="sr-only">Photo no longer on this device</span>
          </div>
        ) : (
          <div className="load h-64 w-64" aria-hidden="true"><span className="pr pr--lo">Loading</span></div>
        )}
      </div>

      {photo?.caption && !missing && (
        <p className="shrink-0 px-4 pb-4 text-center text-t-body text-[color:var(--text-mid)]">{photo.caption}</p>
      )}
    </Sheet>
  );
}
