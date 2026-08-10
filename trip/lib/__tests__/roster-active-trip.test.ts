import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Expense } from '@/core/budget/expenses';
import {
  rosterForActiveTrip,
  rosterAccent,
  accentForName,
  signIn,
  signOut,
  TRAVELERS,
} from '../token-auth';

// D-223: the split roster is fixed TRAVELERS on the default pack and DERIVED from
// expense history + self on a custom trip. `isDefaultTrip` (the gateway pointer) is mocked per
// test via a mutable flag, the same pattern as nav-items.test.ts, so these stay pure over the
// boolean. `getActiveTraveler()` reads the real (jsdom) identity slot, driven by signIn/signOut.
vi.mock('@/core/trips', () => ({ isDefaultTrip: () => mockIsDefault }));
let mockIsDefault = true;

/** Minimal valid Expense — only the fields the roster derivation reads matter to the assertions. */
function exp(partial: Partial<Expense>): Expense {
  return {
    id: partial.id ?? 'e1',
    leg: partial.leg ?? 'nepal',
    category: partial.category ?? 'food',
    amount: partial.amount ?? 100,
    createdAt: partial.createdAt ?? '2026-12-10T00:00:00.000Z',
    ...partial,
  };
}

beforeEach(() => {
  mockIsDefault = true;
  signOut(); // clear any identity from a prior test
});

describe('rosterForActiveTrip — default pack (pixel-identical)', () => {
  it('returns exactly the fixed TRAVELERS names, ignoring expenses', () => {
    expect(rosterForActiveTrip([])).toEqual(['Powan', 'Sushil', 'Uttam']);
    // History on the default pack changes nothing — still the fixed roster.
    expect(
      rosterForActiveTrip([exp({ paidBy: 'Stranger', split: ['Someone'] })]),
    ).toEqual(TRAVELERS.map((t) => t.name));
  });
});

describe('rosterForActiveTrip — custom trip (derived)', () => {
  beforeEach(() => {
    mockIsDefault = false;
  });

  it('no active traveler, no expenses ⇒ empty roster (honest degrade, no invented UI)', () => {
    expect(rosterForActiveTrip([])).toEqual([]);
  });

  it('signed-in traveler with no expenses ⇒ self only (can create the first split)', () => {
    signIn('Alice');
    expect(rosterForActiveTrip([])).toEqual(['Alice']);
  });

  it('derives the distinct union of self + paidBy + split members + createdBy, self first', () => {
    signIn('Alice');
    const roster = rosterForActiveTrip([
      exp({ id: 'a', paidBy: 'Bob', split: ['Alice', 'Bob', 'Carol'], createdBy: 'Bob' }),
      exp({ id: 'b', paidBy: 'Carol', split: ['Carol', 'Dan'], createdBy: 'Alice' }),
    ]);
    // "me" first, then first-seen order across paidBy → split[] → createdBy.
    expect(roster).toEqual(['Alice', 'Bob', 'Carol', 'Dan']);
  });

  it('de-dupes case-insensitively, keeping the first-seen casing', () => {
    const roster = rosterForActiveTrip([
      exp({ id: 'a', paidBy: 'Bob', split: ['bob', 'BOB'] }),
      exp({ id: 'b', createdBy: ' bob ' }),
    ]);
    expect(roster).toEqual(['Bob']);
  });

  it('skips empty / whitespace names', () => {
    const roster = rosterForActiveTrip([
      exp({ id: 'a', paidBy: '', split: ['', '   ', 'Zoe'], createdBy: '  ' }),
    ]);
    expect(roster).toEqual(['Zoe']);
  });

  it('includes self exactly once even when self also appears in the history', () => {
    signIn('Bob');
    const roster = rosterForActiveTrip([exp({ paidBy: 'Bob', split: ['Bob', 'Eve'] })]);
    expect(roster).toEqual(['Bob', 'Eve']);
  });
});

describe('rosterAccent', () => {
  it('a default TRAVELER keeps its fixed hand-assigned tint (pixel-identical)', () => {
    for (const t of TRAVELERS) {
      expect(rosterAccent(t.name)).toBe(t.accent);
      expect(rosterAccent(t.name.toLowerCase())).toBe(t.accent); // case-insensitive
    }
  });

  it('an unknown (custom) name falls back to the deterministic accentForName hash', () => {
    expect(rosterAccent('Zoe')).toBe(accentForName('Zoe'));
  });
});
