import { describe, it, expect } from 'vitest';

// S316 / D-230 — completion attribution stamping. `stampDone` is transition-gated on the patch
// and name-gated exactly like `stampUpdated`, so the dormant (no-name) build stays byte-identical.

import { stampDone } from '@/lib/attribution';
import type { ItineraryItem } from '@/lib/trip-data';

const NAME = () => 'Powan';
const NO_NAME = () => null;
const ISO = '2026-07-25T12:00:00.000Z';

function mk(fields: Partial<ItineraryItem> = {}): ItineraryItem {
  return { id: 'x', title: 'x', category: 'sightseeing', ...fields };
}

describe('stampDone (D-230)', () => {
  it('(a) done false→true stamps BOTH doneBy + doneAt', () => {
    const out = stampDone(mk({ done: true }), { done: true }, NAME, ISO);
    expect(out.doneBy).toBe('Powan');
    expect(out.doneAt).toBe(ISO);
  });

  it('(b) done true→false CLEARS both keys', () => {
    const out = stampDone(
      mk({ done: false, doneBy: 'Powan', doneAt: ISO }),
      { done: false },
      NAME,
      ISO,
    );
    expect('doneBy' in out).toBe(false);
    expect('doneAt' in out).toBe(false);
  });

  it('(c) an edit not touching `done` leaves both untouched', () => {
    const item = mk({ done: true, doneBy: 'Powan', doneAt: ISO });
    const out = stampDone(item, { title: 'new title' }, NAME, ISO);
    expect(out.doneBy).toBe('Powan');
    expect(out.doneAt).toBe(ISO);
    expect(out).toEqual(item); // fully untouched
  });

  it('(d) no name set ⇒ stamping is a NO-OP (both stay absent, byte-identical toggle)', () => {
    const item = mk({ done: true });
    const out = stampDone(item, { done: true }, NO_NAME, ISO);
    expect('doneBy' in out).toBe(false);
    expect('doneAt' in out).toBe(false);
    expect(out).toEqual(item); // identical to a plain done toggle
  });

  it('uncheck still clears even with no name set (deleting absent key is a no-op)', () => {
    const out = stampDone(
      mk({ done: false, doneBy: 'Powan', doneAt: ISO }),
      { done: false },
      NO_NAME,
      ISO,
    );
    expect('doneBy' in out).toBe(false);
    expect('doneAt' in out).toBe(false);
  });
});
