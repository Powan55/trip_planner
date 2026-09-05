// @vitest-environment jsdom
//
// #439 — three functions whose docblocks promise they never throw, and that could.
//
// All three are unreachable through the UI today: the outbox slot is written only by this app,
// the city-coords map comes from a trip the user joined, and both flight-tracker call sites read
// curated data. They are grouped because they are the same defect — a promise in a comment that
// the code does not keep — and because "no reachable trigger today" is a statement about the
// current call sites, not about the function.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { outboxDirty } from '@/core/sync/outbox';
import { buildFlightTrackerUrl } from '@/lib/flight-deep-links';
import { keyFor } from '@/core/storage/gateway';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('#439 — outbox loadSlot validates each domain, not just the container', () => {
  it('a non-array domain value does not throw out of outboxDirty', () => {
    // The old guard proved `dirty` was an object and stopped. A corrupt slot like this then
    // reached `[...dirty[domain]]` and threw "is not iterable" out of an async caller.
    localStorage.setItem(
      keyFor('syncOutbox'),
      JSON.stringify({ version: 1, dirty: { expenses: 'not-an-array' } }),
    );
    expect(() => outboxDirty('expenses')).not.toThrow();
    expect(outboxDirty('expenses')).toEqual([]);
  });

  it('keeps the string chunks and drops the junk inside an array', () => {
    localStorage.setItem(
      keyFor('syncOutbox'),
      JSON.stringify({ version: 1, dirty: { expenses: ['main', 42, null, 'nepal'] } }),
    );
    expect(outboxDirty('expenses')).toEqual(['main', 'nepal']);
  });

  it('a good slot is still read unchanged', () => {
    localStorage.setItem(
      keyFor('syncOutbox'),
      JSON.stringify({ version: 1, dirty: { expenses: ['main'] } }),
    );
    expect(outboxDirty('expenses')).toEqual(['main']);
  });

  it('an unknown version is discarded WITH a warning, not silently', () => {
    // Dropping every pending chunk is the kind of event that should leave a trace; silent, a
    // future migration bug just looks like "sync stopped".
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      keyFor('syncOutbox'),
      JSON.stringify({ version: 99, dirty: { expenses: ['main'] } }),
    );
    expect(outboxDirty('expenses')).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});

describe('#439 — buildFlightTrackerUrl survives a prototype key', () => {
  // A bare index reaches INHERITED keys, and every one of these is truthy, so the old
  // `if (!iata)` guard let them through to `.toLowerCase()`.
  it.each(['toString', '__proto__', 'constructor', 'valueOf'])(
    'an airline of %s returns null instead of throwing',
    (name) => {
      expect(() => buildFlightTrackerUrl(`${name} 123`)).not.toThrow();
      expect(buildFlightTrackerUrl(`${name} 123`)).toBeNull();
    },
  );

  it('a real airline still resolves', () => {
    // Guards against "fixed it by breaking it" — the happy path must be untouched.
    const url = buildFlightTrackerUrl('Meridian Air 4471');
    expect(url).toBe('https://www.flightradar24.com/data/flights/md4471');
  });

  it('an unknown airline is still null', () => {
    expect(buildFlightTrackerUrl('Not An Airline 1')).toBeNull();
  });
});
