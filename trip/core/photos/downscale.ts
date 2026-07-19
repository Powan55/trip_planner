/**
 * Capture downscale pipeline. Browser-facing but dependency-free ( — native
 * `createImageBitmap` + Canvas + `toBlob`, no `sharp`/`browser-image-compression`/etc.). A captured
 * `File`/`Blob` is decoded, drawn scaled onto an offscreen canvas, and re-encoded as JPEG q0.8 with a
 * long edge of at most 1600 px BEFORE any `BlobStorePort.put` — original full-size bytes are never
 * written anywhere.
 *
 * The scaling MATH (`fitWithin`) is pure + unit-tested; the encode is thin browser glue proven in a
 * real browser by the Playwright capture flow (jsdom implements neither `createImageBitmap` nor
 * `canvas.toBlob`).
 */

/** Max long edge of a stored photo: retina-sharp at every in-app surface, ~4× smaller area
 * than a 12 MP original. */
export const MAX_EDGE = 1600;
/** JPEG quality: the visually-transparent knee for photographic content. */
export const JPEG_QUALITY = 0.8;

export type PreparedPhoto =
  | { ok: true; blob: Blob; w: number; h: number }
  | { ok: false; reason: 'decode' };

/**
 * Fit `w`×`h` within a `maxEdge` box, preserving aspect ratio and NEVER upscaling. Returns integer
 * dimensions. Pure + total: a non-positive/NaN input degrades to a 1×1 floor rather than throwing.
 */
export function fitWithin(w: number, h: number, maxEdge: number = MAX_EDGE): { w: number; h: number } {
  const sw = Number.isFinite(w) && w > 0 ? w : 1;
  const sh = Number.isFinite(h) && h > 0 ? h : 1;
  const longEdge = Math.max(sw, sh);
  // Never upscale: a source already within the box re-encodes at its own size.
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  return {
    w: Math.max(1, Math.round(sw * scale)),
    h: Math.max(1, Math.round(sh * scale)),
  };
}

/**
 * Decode → downscale → JPEG-encode a captured image. `imageOrientation:'from-image'` bakes EXIF
 * rotation in (a portrait receipt stays portrait). A decode failure (exotic/corrupt format) returns
 * `{ ok:false, reason:'decode' }` — non-destructive, nothing stored. Browser-only; returns `decode`
 * under SSR / a missing canvas 2D context.
 */
export async function preparePhoto(file: File | Blob): Promise<PreparedPhoto> {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
    return { ok: false, reason: 'decode' };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return { ok: false, reason: 'decode' };
  }

  try {
    const { w, h } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, reason: 'decode' };
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) return { ok: false, reason: 'decode' };
    return { ok: true, blob, w, h };
  } catch {
    return { ok: false, reason: 'decode' };
  } finally {
    bitmap.close?.();
  }
}
