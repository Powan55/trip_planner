// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  distinctAuthors,
  filterItemsByAuthor,
  itemMatchesAuthor,
} from '@/lib/author-filter';
import { signIn, signOut } from '@/lib/token-auth';
import { getPriorUserNames, getUserName } from '@/lib/identity';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

/**
 * S390-B / S390-C — two ways the traveller filter told a traveller they had done nothing.
 *
 * `lib/author-filter.ts` shipped with NO unit test at all, which is why both defects were
 * invisible: the only coverage was an e2e that asserts the control is DORMANT on the seed
 * (0 createdBy / 0 updatedBy / 0 doneBy across 158 items), so it can never reach either path.
 */

const mk = (fields: Partial<ItineraryItem>): ItineraryItem => ({
  id: fields.id ?? 'x',
  title: 'X',
  category: 'sightseeing',
  ...fields,
});

const day = (items: ItineraryItem[]): DayPlan[] => [
  { date: '2026-12-11', city: 'Kathmandu', country: 'nepal', items },
];

describe('S390-B — itemMatchesAuthor / distinctAuthors read `doneBy`', () => {
  // 🔴 ONLY `doneBy`. An item that ALSO carried `createdBy` would pass on the broken code and
  // prove nothing — this is the traveller who ticked six things off and authored none.
  const tickedOnly = mk({ id: 'ticked', doneBy: 'Mika' });
  const authored = mk({ id: 'authored', createdBy: 'Kenji' });

  it('an item attributed ONLY by doneBy matches that author', () => {
    expect(itemMatchesAuthor(tickedOnly, { kind: 'author', name: 'Mika' }, null)).toBe(true);
  });

  it('…and it matches "My edits" for that same person', () => {
    expect(itemMatchesAuthor(tickedOnly, { kind: 'mine' }, 'Mika')).toBe(true);
  });

  it('filtering to that traveller no longer returns an empty list', () => {
    expect(
      filterItemsByAuthor([tickedOnly, authored], { kind: 'author', name: 'Mika' }, null).map(
        (i) => i.id,
      ),
    ).toEqual(['ticked']);
  });

  it('a name that can MATCH is also OFFERABLE — distinctAuthors lists the doneBy-only name', () => {
    expect(distinctAuthors(day([tickedOnly, authored]))).toEqual(['Kenji', 'Mika']);
  });

  it('does not widen: an unrelated author still does not match', () => {
    expect(itemMatchesAuthor(tickedOnly, { kind: 'author', name: 'Kenji' }, null)).toBe(false);
    expect(itemMatchesAuthor(authored, { kind: 'mine' }, 'Mika')).toBe(false);
  });

  it('the dormant seed case is unchanged — no attribution anywhere still yields no options', () => {
    expect(distinctAuthors(day([mk({ id: 'a' }), mk({ id: 'b' })]))).toEqual([]);
  });
});

describe('S390-C — a rename does not split one person into two', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('signIn RECORDS the outgoing name when it changes (and only then)', () => {
    signIn('Powan');
    expect(getPriorUserNames()).toEqual([]); // a first sign-in renames nothing

    signIn('Powan'); // re-sign-in with the same name is not a rename
    expect(getPriorUserNames()).toEqual([]);

    signIn('Nadia'); // the actual rename
    expect(getUserName()).toBe('Nadia');
    expect(getPriorUserNames()).toEqual(['Powan']);

    signIn('Rina'); // renaming again keeps the whole chain
    expect(getPriorUserNames()).toEqual(['Powan', 'Nadia']);

    signIn('Nadia'); // renaming BACK does not duplicate an already-recorded name
    expect(getPriorUserNames()).toEqual(['Powan', 'Nadia', 'Rina']);
    expect(new Set(getPriorUserNames()).size).toBe(3);
  });

  it('"My edits" matches items stamped under a prior name', () => {
    const before = mk({ id: 'before', createdBy: 'Powan' });
    const after = mk({ id: 'after', createdBy: 'Nadia' });
    expect(filterItemsByAuthor([before, after], { kind: 'mine' }, 'Nadia', ['Powan']).map((i) => i.id)).toEqual(
      ['before', 'after'],
    );
  });

  it('distinctAuthors collapses a prior name into the current one — ONE chip per human', () => {
    const plans = day([
      mk({ id: 'a', createdBy: 'Powan' }),
      mk({ id: 'b', createdBy: 'Nadia' }),
      mk({ id: 'c', createdBy: 'Kenji' }),
    ]);
    expect(distinctAuthors(plans)).toEqual(['Kenji', 'Nadia', 'Powan']); // uncollapsed: 3 chips
    expect(distinctAuthors(plans, 'Nadia', ['Powan'])).toEqual(['Kenji', 'Nadia']); // collapsed: 2
  });

  it('🔴 a fellow traveller is NEVER absorbed — only names this user actually renamed away from', () => {
    // The recorded list is the ONLY source of aliases. Kenji is a different human whose stamps
    // happen to sit in the same trip; nothing here may make his items "mine".
    expect(itemMatchesAuthor(mk({ createdBy: 'Kenji' }), { kind: 'mine' }, 'Nadia', ['Powan'])).toBe(
      false,
    );
    expect(distinctAuthors(day([mk({ createdBy: 'Kenji' })]), 'Nadia', ['Powan'])).toEqual(['Kenji']);
  });

  it('🔴 THE HONEST LIMIT: a rename that happened BEFORE this shipped is not repaired', () => {
    // No prior-name record exists for it, and none can be reconstructed — so the split persists.
    // This test exists so the ceiling is asserted rather than described in a comment nobody reads.
    signIn('Nadia'); // arrives with an old name already stamped in the data, never recorded here
    expect(getPriorUserNames()).toEqual([]);
    expect(
      filterItemsByAuthor([mk({ id: 'old', createdBy: 'Powan' })], { kind: 'mine' }, getUserName(), getPriorUserNames()),
    ).toEqual([]);
  });

  it('sign-out clears the prior-name history with the rest of the identity', () => {
    signIn('Powan');
    signIn('Nadia');
    expect(getPriorUserNames()).toEqual(['Powan']);
    signOut();
    // A handed-down device must not give the next person the previous traveller's aliases.
    expect(getPriorUserNames()).toEqual([]);
    expect(getUserName()).toBeNull();
  });
});
