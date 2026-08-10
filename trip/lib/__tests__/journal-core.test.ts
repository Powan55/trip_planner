import { describe, it, expect } from 'vitest';

/**
 * S104 — pure journal core (D-016/D-099). `core/journal/model.ts` is framework-free; these tests
 * pin the type guards (`isMood`/`isEmptyContent`), the sanitizers (`sanitizeEntry`/`sanitizeEntries`
 * — total, date-required, content-required, mood/highlight coercion, last-write dedupe by date), the
 * lookup (`getEntry`), and the pure transforms (`upsertEntry` create/merge/clear-removes with a
 * CALLER-injected timestamp; `removeEntry`). The clear→remove path is the D-018 "deleting all content
 * leaves a clean empty state" guarantee, proven here at the core.
 */

import {
  MOODS,
  isMood,
  isEmptyContent,
  sanitizeEntry,
  sanitizeEntries,
  getEntry,
  upsertEntry,
  removeEntry,
  type JournalEntry,
} from '@/core/journal/model';

const NOW = '2026-12-14T18:00:00.000Z';
const LATER = '2026-12-14T20:30:00.000Z';

function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    date: '2026-12-14',
    text: 'A good day in Kathmandu.',
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe('MOODS / isMood', () => {
  it('MOODS is the closed 4-value enum in a stable order', () => {
    expect(MOODS).toEqual(['great', 'good', 'okay', 'rough']);
  });

  it('isMood accepts only the 4 canonical moods', () => {
    for (const m of MOODS) expect(isMood(m)).toBe(true);
    expect(isMood('ecstatic')).toBe(false);
    expect(isMood('')).toBe(false);
    expect(isMood(null)).toBe(false);
    expect(isMood(3)).toBe(false);
    expect(isMood(undefined)).toBe(false);
  });
});

describe('isEmptyContent — the "nothing worth persisting" test', () => {
  it('empty iff trimmed text is empty AND no mood AND trimmed highlight is empty', () => {
    expect(isEmptyContent({})).toBe(true);
    expect(isEmptyContent({ text: '   ', highlight: '  ', mood: null })).toBe(true);
    expect(isEmptyContent({ text: 'hi' })).toBe(false);
    expect(isEmptyContent({ mood: 'good' })).toBe(false);
    expect(isEmptyContent({ highlight: 'Boudhanath' })).toBe(false);
    // An invalid mood does NOT count as content.
    expect(isEmptyContent({ mood: 'bogus' as unknown as 'good' })).toBe(true);
  });
});

describe('sanitizeEntry — TOTAL (a corrupt slot never crashes the store)', () => {
  it('salvages a valid entry, trimming text/highlight and keeping a valid mood', () => {
    const e = sanitizeEntry({
      date: '2026-12-14',
      text: '  Momos in Thamel.  ',
      mood: 'great',
      highlight: '  Sunset over the stupa  ',
      createdAt: NOW,
      updatedAt: LATER,
    });
    expect(e).toEqual({
      date: '2026-12-14',
      text: 'Momos in Thamel.',
      mood: 'great',
      highlight: 'Sunset over the stupa',
      createdAt: NOW,
      updatedAt: LATER,
    });
  });

  it('requires a valid YYYY-MM-DD date — else null', () => {
    expect(sanitizeEntry(null)).toBeNull();
    expect(sanitizeEntry('nope')).toBeNull();
    expect(sanitizeEntry({ text: 'hi' })).toBeNull(); // no date
    expect(sanitizeEntry({ date: '2026-13-40', text: 'hi' })).not.toBeNull(); // regex-shaped is enough (total, no calendar check)
    expect(sanitizeEntry({ date: '12/14/2026', text: 'hi' })).toBeNull(); // wrong format
  });

  it('requires non-empty content — a date-only entry is null (a blank day = no entry)', () => {
    expect(sanitizeEntry({ date: '2026-12-14' })).toBeNull();
    expect(sanitizeEntry({ date: '2026-12-14', text: '   ', highlight: '  ' })).toBeNull();
  });

  it('drops an invalid mood + blank highlight, coerces bad timestamps to "" (sortable, no throw)', () => {
    const e = sanitizeEntry({
      date: '2026-12-14',
      text: 'kept',
      mood: 'meh',
      highlight: '   ',
      createdAt: 42,
      updatedAt: null,
    });
    expect(e).toEqual({ date: '2026-12-14', text: 'kept', createdAt: '', updatedAt: '' });
    expect(e).not.toHaveProperty('mood');
    expect(e).not.toHaveProperty('highlight');
  });
});

describe('sanitizeEntries — non-array drop + LAST-write dedupe by date', () => {
  it('drops non-array input and unsalvageable entries', () => {
    expect(sanitizeEntries('not an array')).toEqual([]);
    expect(sanitizeEntries(null)).toEqual([]);
    const cleaned = sanitizeEntries([
      entry({ date: '2026-12-14', text: 'a' }),
      null,
      { date: 'bad', text: 'x' },
      { date: '2026-12-15', text: 'b', createdAt: NOW, updatedAt: NOW },
      { garbage: true },
    ]);
    expect(cleaned.map((e) => e.date)).toEqual(['2026-12-14', '2026-12-15']);
  });

  it('when two entries share a date, the LAST one wins (dedupe → ≤ 1 per date)', () => {
    const cleaned = sanitizeEntries([
      entry({ date: '2026-12-14', text: 'first' }),
      entry({ date: '2026-12-14', text: 'second' }),
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].text).toBe('second');
  });
});

describe('getEntry', () => {
  it('finds the entry for a date, or null', () => {
    const list = [entry({ date: '2026-12-14' }), entry({ date: '2026-12-15', text: 'b' })];
    expect(getEntry(list, '2026-12-15')?.text).toBe('b');
    expect(getEntry(list, '2026-12-20')).toBeNull();
    expect(getEntry([], '2026-12-14')).toBeNull();
    // Total against a corrupt list.
    expect(getEntry(null as unknown as JournalEntry[], '2026-12-14')).toBeNull();
  });
});

describe('upsertEntry — pure merge with a CALLER-injected timestamp', () => {
  it('CREATE: adds a new entry with createdAt = updatedAt = nowIso', () => {
    const list = upsertEntry([], '2026-12-14', { text: 'Day 6', mood: 'good' }, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      date: '2026-12-14',
      text: 'Day 6',
      mood: 'good',
      createdAt: NOW,
      updatedAt: NOW,
    });
    // Pure: the original list is not mutated.
    const base: JournalEntry[] = [];
    upsertEntry(base, '2026-12-14', { text: 'x' }, NOW);
    expect(base).toHaveLength(0);
  });

  it('MERGE: preserves createdAt, moves updatedAt to nowIso, leaves undefined fields unchanged', () => {
    const start = upsertEntry([], '2026-12-14', { text: 'first', mood: 'good', highlight: 'stupa' }, NOW);
    // Patch only text; mood + highlight untouched (undefined = keep).
    const next = upsertEntry(start, '2026-12-14', { text: 'edited' }, LATER);
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({
      date: '2026-12-14',
      text: 'edited',
      mood: 'good',
      highlight: 'stupa',
      createdAt: NOW, // preserved
      updatedAt: LATER, // moved
    });
  });

  it('null CLEARS a field, undefined LEAVES it — the two are distinct', () => {
    const start = upsertEntry([], '2026-12-14', { text: 'body', mood: 'great', highlight: 'H' }, NOW);
    const cleared = upsertEntry(start, '2026-12-14', { mood: null, highlight: null }, LATER);
    expect(cleared[0]).not.toHaveProperty('mood');
    expect(cleared[0]).not.toHaveProperty('highlight');
    expect(cleared[0].text).toBe('body'); // text was undefined → unchanged
  });

  it('CLEAR-ALL removes the entry (D-018: deleting all content = clean empty state, no phantom)', () => {
    const start = upsertEntry([], '2026-12-14', { text: 'body', mood: 'good' }, NOW);
    // Clear text + mood; highlight was never set.
    const emptied = upsertEntry(start, '2026-12-14', { text: '   ', mood: null }, LATER);
    expect(emptied).toEqual([]);
    // A create with empty content is a no-op (never seeds a phantom).
    expect(upsertEntry([], '2026-12-14', { text: '  ' }, NOW)).toEqual([]);
  });

  it('does not disturb OTHER days', () => {
    const list = [entry({ date: '2026-12-14', text: 'a' }), entry({ date: '2026-12-15', text: 'b' })];
    const next = upsertEntry(list, '2026-12-14', { text: 'a2' }, LATER);
    expect(getEntry(next, '2026-12-15')?.text).toBe('b'); // untouched
    expect(getEntry(next, '2026-12-14')?.text).toBe('a2');
  });

  it('TOTAL: an invalid date returns the list unchanged (never throws)', () => {
    const list = [entry()];
    expect(upsertEntry(list, 'not-a-date', { text: 'x' }, NOW)).toEqual(list);
    expect(() => upsertEntry(null as unknown as JournalEntry[], '2026-12-14', { text: 'x' }, NOW)).not.toThrow();
  });
});

describe('removeEntry', () => {
  it('removes a matching date; a non-match is a no-op; pure', () => {
    const list = [entry({ date: '2026-12-14' }), entry({ date: '2026-12-15', text: 'b' })];
    expect(removeEntry(list, '2026-12-14').map((e) => e.date)).toEqual(['2026-12-15']);
    expect(removeEntry(list, '2026-12-20')).toHaveLength(2);
    expect(list).toHaveLength(2); // original untouched
    expect(() => removeEntry(null as unknown as JournalEntry[], '2026-12-14')).not.toThrow();
  });
});
