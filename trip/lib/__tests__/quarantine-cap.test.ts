// @vitest-environment jsdom
//
// #411 / D-496 — the quarantine slot is a diagnostic, not an archive.
//
// A rejected import used to be written to the quarantine key verbatim, with a raw
// `localStorage.setItem`. A whole-trip backup that lost its `domains` key carries every embedded
// base64 photo, so a mid-size unrecognised file could sit on most of the ~5 MB budget forever.
// These pin the cap, the diagnostic tail, and the two D-096 properties the cap must NOT break.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseBackup } from '@/core/vault/export-import';
import { ITINERARY_QUARANTINE_KEY } from '@/lib/itinerary-storage';
import { MAX_IMPORT_BYTES, decompressBlobOrText } from '@/core/vault/compression';

// Unrecognised shape -> rejected -> quarantined. Valid JSON, so this exercises the
// detectVersion rejection rather than the parse error.
function unrecognised(padChars: number): string {
  return JSON.stringify({ notATripExport: 'x'.repeat(padChars) });
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('#411 — the quarantined string is capped', () => {
  it('a small rejected import is still preserved verbatim (D-096 unchanged for normal files)', () => {
    const raw = unrecognised(10);
    expect(parseBackup(raw).ok).toBe(false);
    expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(raw);
  });

  it('a large rejected import is truncated instead of stored whole', () => {
    const raw = unrecognised(2 * 1024 * 1024); // ~2 MB, the shape that used to eat the budget
    expect(parseBackup(raw).ok).toBe(false);

    const stored = localStorage.getItem(ITINERARY_QUARANTINE_KEY) ?? '';
    expect(stored).not.toBe(raw);
    // Comfortably under the old behaviour, and under any sane share of a ~5 MB budget.
    expect(stored.length).toBeLessThan(8 * 1024);
    // The leading slice is what carries the diagnosis, so it must be the ACTUAL head of the file.
    expect(raw.startsWith(stored.slice(0, 200))) .toBe(true);
    // ...and the original size is recoverable from the tail.
    expect(stored).toContain(String(raw.length));
    expect(stored).toContain('truncated');
  });

  it('does not clobber a first capture (D-096 don\'t-clobber, still holds)', () => {
    const first = unrecognised(10);
    expect(parseBackup(first).ok).toBe(false);
    expect(parseBackup(unrecognised(2 * 1024 * 1024)).ok).toBe(false);
    // The ORIGINAL failure is the useful one and must survive the second.
    expect(localStorage.getItem(ITINERARY_QUARANTINE_KEY)).toBe(first);
  });

  it('never throws out of the preserve attempt even when storage rejects the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    // D-096: the preserve attempt is best-effort and must not become the thing that fails.
    expect(() => parseBackup(unrecognised(10))).not.toThrow();
    expect(parseBackup(unrecognised(10)).ok).toBe(false);
  });
});

describe('#411 — an oversized file is rejected before it is read', () => {
  it('a Blob over MAX_IMPORT_BYTES throws instead of being read into memory', async () => {
    // `size` is metadata, so this models a huge file without allocating one.
    const huge = { size: MAX_IMPORT_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;
    await expect(decompressBlobOrText(huge)).rejects.toThrow(/too large/i);
    // The point of checking size first: the bytes are never touched.
    expect((huge as unknown as { arrayBuffer: ReturnType<typeof vi.fn> }).arrayBuffer).not.toHaveBeenCalled();
  });

  it('a file at the limit is still read', async () => {
    const ok = new Blob([new Uint8Array([123, 125])]); // "{}"
    await expect(decompressBlobOrText(ok)).resolves.toBe('{}');
  });
});
