// @vitest-environment jsdom
//
// S228 — gzip transport for export/import blobs (D-098: transport only, schema untouched).
// Covers: compress/decompress round-trip byte-identity, auto-detect compressed vs plain by
// magic bytes (not extension), and the unsupported-browser fallback (CompressionStream mocked
// undefined).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { compressToBlob, decompressBlobOrText, supportsCompression } from '@/core/vault/compression';

const SAMPLE = JSON.stringify({ schemaVersion: 5, updatedAt: '2026-07-17T00:00:00.000Z', payload: [] });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S228 compress/decompress round-trip', () => {
  it('compressToBlob → decompressBlobOrText reproduces the original text byte-for-byte', async () => {
    const blob = await compressToBlob(SAMPLE);
    const out = await decompressBlobOrText(blob);
    expect(out).toBe(SAMPLE);
  });

  it('a compressed blob is smaller than the plain text for realistic repetitive JSON', async () => {
    const big = JSON.stringify({
      schemaVersion: 5,
      updatedAt: '2026-07-17T00:00:00.000Z',
      payload: Array.from({ length: 50 }, (_, i) => ({
        date: `2026-12-${String((i % 28) + 1).padStart(2, '0')}`,
        city: 'Kathmandu',
        country: 'nepal',
        items: [{ id: `item-${i}`, title: 'Sunrise at Swayambhunath', category: 'photography' }],
      })),
    });
    const blob = await compressToBlob(big);
    expect(blob.size).toBeLessThan(big.length);
    // Sanity: still round-trips.
    expect(await decompressBlobOrText(blob)).toBe(big);
  });

  it('a gzip-compressed Blob is detected by MAGIC BYTES regardless of any filename/extension', async () => {
    const blob = await compressToBlob(SAMPLE);
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect(head[0]).toBe(0x1f);
    expect(head[1]).toBe(0x8b);
  });
});

describe('S228 auto-detect on import — compressed vs plain, independent of extension', () => {
  it('a plain (uncompressed) JSON Blob decodes as-is', async () => {
    const plainBlob = new Blob([SAMPLE], { type: 'application/json' });
    expect(await decompressBlobOrText(plainBlob)).toBe(SAMPLE);
  });

  it('an OLD pre-S228 plain-JSON export string still imports (string passthrough)', async () => {
    expect(await decompressBlobOrText(SAMPLE)).toBe(SAMPLE);
  });

  it('a gzip Blob decodes correctly even when given a misleading ".txt" File name', async () => {
    const blob = await compressToBlob(SAMPLE);
    // Built from the raw bytes (not a nested Blob part — jsdom's File constructor doesn't
    // flatten a Blob part's bytes, only real content sources) so this exercises the same
    // gzip bytes a browser's <input type="file"> would hand us, just under a misleading name.
    const bytes = await blob.arrayBuffer();
    const file = new File([bytes], 'not-really.txt', { type: 'text/plain' });
    expect(await decompressBlobOrText(file)).toBe(SAMPLE);
  });
});

describe('S228 unsupported-browser fallback (CompressionStream/DecompressionStream absent)', () => {
  it('compressToBlob falls back to an uncompressed Blob when CompressionStream is undefined', async () => {
    const original = globalThis.CompressionStream;
    // @ts-expect-error — simulating an unsupported browser.
    globalThis.CompressionStream = undefined;
    try {
      expect(supportsCompression()).toBe(false);
      const blob = await compressToBlob(SAMPLE);
      const text = await blob.text();
      expect(text).toBe(SAMPLE); // plain bytes, no gzip magic
    } finally {
      globalThis.CompressionStream = original;
    }
  });

  it('decompressBlobOrText still reads a plain Blob fine even when DecompressionStream is undefined', async () => {
    const original = globalThis.DecompressionStream;
    // @ts-expect-error — simulating an unsupported browser.
    globalThis.DecompressionStream = undefined;
    try {
      const plainBlob = new Blob([SAMPLE], { type: 'application/json' });
      expect(await decompressBlobOrText(plainBlob)).toBe(SAMPLE);
    } finally {
      globalThis.DecompressionStream = original;
    }
  });

  it('decompressBlobOrText THROWS a safe error for a gzip file when DecompressionStream is unavailable', async () => {
    // Compress with support present, then simulate losing DecompressionStream on import.
    const gzBlob = await compressToBlob(SAMPLE);
    const original = globalThis.DecompressionStream;
    // @ts-expect-error — simulating an unsupported browser.
    globalThis.DecompressionStream = undefined;
    try {
      await expect(decompressBlobOrText(gzBlob)).rejects.toThrow();
    } finally {
      globalThis.DecompressionStream = original;
    }
  });
});
