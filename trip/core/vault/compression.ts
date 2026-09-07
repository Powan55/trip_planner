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
 * returned as-is (already text). Throws only when the file IS gzip-magic but this browser
 * lacks `DecompressionStream` — the caller should show that as a normal import error.
 */
/**
 * Largest file the restore path will read into memory (#411). See the note at the check itself
 * for how the number was chosen. A gzip file is measured COMPRESSED, so a crafted archive can
 * still expand past this -- the cap bounds the read, not the expansion.
 */
export const MAX_IMPORT_BYTES = 64 * 1024 * 1024;

export async function decompressBlobOrText(input: Blob | string): Promise<string> {
  if (typeof input === 'string') return input;

  // Size-check the FILE before it is read (#411). Blob.size is metadata, so this costs nothing
  // and, unlike a check after the read, it actually prevents the allocation.
  //
  // WHY 64 MB. Stored photos are downscaled to a 1600px long edge at JPEG q0.8 (core/photos/
  // downscale.ts), so roughly 200-400 KB each, and base64 in a JSON backup inflates that by ~33%
  // -- call it 550 KB per photo at the top end. 64 MB therefore still admits a backup with well
  // over a hundred photos, which is far past any real trip, while bounding a pathological read.
  // It is a memory guard, not a policy on what a legitimate backup may contain; raise it if a
  // real backup ever trips it.
  if (input.size > MAX_IMPORT_BYTES) {
    throw new Error('That file is too large to open (over ' + Math.round(MAX_IMPORT_BYTES / (1024 * 1024)) + ' MB).');
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
