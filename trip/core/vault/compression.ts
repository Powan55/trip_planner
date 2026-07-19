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
export async function decompressBlobOrText(input: Blob | string): Promise<string> {
  if (typeof input === 'string') return input;

  const bytes = new Uint8Array(await input.arrayBuffer());
  const isGzip = bytes.length >= 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
  if (!isGzip) return new TextDecoder().decode(bytes);

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This file is compressed and this browser cannot decompress it.');
  }
  const stream = bytesToStream(bytes).pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
