/**
 * Gzip transport for export/import blobs — native Compression Streams API only, zero
 * library weight. This changes ONLY how the same envelope STRING is packaged for
 * download/upload; the export/import SCHEMA/CONTRACT is untouched — callers
 * still hand this a plain JSON string and get a plain JSON string back.
 *
 * Feature-detected: browsers without `CompressionStream` get an uncompressed `Blob` from
 * `compressToBlob` — no error, no behavior change.
 *
 * Auto-detection on import is by GZIP MAGIC BYTES (`0x1f 0x8b`), not file extension or
 * mime type — a user can rename/re-extension a file, so the first two bytes are the only
 * robust signal. This is what makes an old plain-JSON export and a new.gz
 * export both importable through the same input.
 */

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

/**
 * Largest picked file this will read into memory, checked BEFORE `arrayBuffer()` — the file comes
 * from a picker, so its size is attacker/accident-controlled and nothing downstream bounds it.
 *
 * 64 MB rather than the ~5 MB localStorage budget because a whole-trip backup carries base64 photo
 * bytes from IndexedDB, which that budget does not cover: photos are capped only by the capture
 * downscale (`core/photos/downscale.ts`, long edge 1600, JPEG q0.8 — roughly 300 KB each), so 64 MB
 * is about 200 photos, past what `exportTripBackup` can hold in memory to WRITE such a file in the
 * first place. Refusing a real backup is worse than accepting a big one, so the ceiling sits above
 * anything this app can produce and below what would take the tab out.
 *
 * KNOWN CEILING: this bounds the FILE bytes, not the decompressed size — a crafted gzip bomb under
 * the cap can still inflate past it. Bounding that needs a counting stream on the decompress side.
 */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

/**
 * How much of a rejected or corrupt blob is kept in a quarantine slot. Shared by both quarantine
 * writers — the rejected-import one in `export-import.ts` and the corrupt-read one in
 * `load-save.ts` — so the two cannot drift apart. A blob under this is stored VERBATIM
 * (unchanged); a larger one is truncated to its leading `QUARANTINE_MAX_CHARS` with the original
 * length appended.
 *
 * 64 KB is ~1% of the ~5 MB localStorage budget and holds a backup's identifying head — `format`,
 * `version`, `exportedAt`, `tripId` and the start of `domains.itinerary`, which is what a human
 * reading the slot in devtools needs. Uncapped, a whole-trip backup that missed the `isTripBackup`
 * gate in `lib/trip-backup.ts` (e.g. one that lost its `domains` key) landed here in full —
 * including every base64 photo under `photos.blobs` — and held most of the trip's storage budget
 * until something cleared it.
 *
 * Lives in this module rather than beside either writer because it imports nothing, so both can
 * reach it without importing each other.
 */
export const QUARANTINE_MAX_CHARS = 64 * 1024;

/**
 * True when this browser can do native gzip (de)compression. Exported so callers (e.g. the
 * download UI) can pick the right filename WITHOUT re-deriving support from Blob internals.
 */
export function supportsCompression(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

/** Wrap a single chunk of bytes as a one-shot ReadableStream (source for pipeThrough). */
function bytesToStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/**
 * Gzip-compress `text` into a downloadable Blob. Falls back to a plain-text Blob
 * when `CompressionStream` is unsupported —
 * no error, no behavior change for that browser.
 *
 * Builds the source stream from raw bytes rather than `Blob.prototype.stream()` — the
 * latter is unimplemented in jsdom (the unit-test environment) and this is exactly as
 * correct in real browsers, so one code path covers both (no test-only branch).
 */
export async function compressToBlob(text: string): Promise<Blob> {
  if (!supportsCompression()) {
    return new Blob([text], { type: 'application/json' });
  }
  const bytes = new TextEncoder().encode(text);
  const stream = bytesToStream(bytes).pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/**
 * Decode an imported file back to its original text, auto-detecting compressed vs plain by
 * gzip magic bytes (robust to a renamed/re-extensioned file). A plain string input is
 * returned as-is (already text). Throws when the file IS gzip-magic but this browser
 * lacks `DecompressionStream`, and when the file is over `MAX_IMPORT_BYTES` — the caller should
 * show either as a normal import error (both call sites already catch and report their own copy).
 */
export async function decompressBlobOrText(input: Blob | string): Promise<string> {
  if (typeof input === 'string') return input;

  // Before `arrayBuffer()`, so an oversized file is never materialized.
  if (input.size > MAX_IMPORT_BYTES) {
    throw new Error('That file is too large to be a trip backup.');
  }

  const bytes = new Uint8Array(await input.arrayBuffer());
  const isGzip = bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
  if (!isGzip) return new TextDecoder().decode(bytes);

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This file is compressed and this browser cannot decompress it.');
  }
  const stream = bytesToStream(bytes).pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
