// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveToken,
  accentForName,
  signIn,
  signOut,
  getActiveTraveler,
  TRAVELERS,
  IDENTITY_CHANGED_EVENT,
} from '@/lib/token-auth';
import { STORAGE_KEYS } from '@/core/storage/gateway';

/**
 * Free-text nickname sign-in (S233, D-209 item 3). The fixed 3-name roster was retired from the
 * sign-in path: ANY non-empty trimmed string is a valid nickname, its accent is a deterministic
 * name-hash, and the identity pipeline (`setUserName` + token slot) is otherwise unchanged so
 * createdBy/updatedBy attribution needs zero changes. `TRAVELERS` survives ONLY as the default
 * expense-split roster.
 */
describe('token-auth · free-text nickname resolveToken', () => {
  it('accepts any non-empty trimmed name and preserves it verbatim', () => {
    const t = resolveToken('Alex');
    expect(t).not.toBeNull();
    expect(t!.name).toBe('Alex');
    expect(t!.token).toBe('Alex');
  });

  it('trims surrounding whitespace', () => {
    expect(resolveToken('   Sam  ')!.name).toBe('Sam');
  });

  it('rejects empty / whitespace-only input', () => {
    expect(resolveToken('')).toBeNull();
    expect(resolveToken('   ')).toBeNull();
  });

  it('accepts an arbitrary name that is NOT a roster member (roster no longer gates sign-in)', () => {
    const t = resolveToken('Zephyr');
    expect(t).not.toBeNull();
    expect(t!.name).toBe('Zephyr');
  });
});

describe('token-auth · accentForName', () => {
  it('is deterministic and case-insensitive', () => {
    expect(accentForName('Alex')).toBe(accentForName('Alex'));
    expect(accentForName('Alex')).toBe(accentForName('  alex '));
  });

  it('returns an on-brand palette hex', () => {
    // R2/D-265: pins the full 6-entry ACCENT_PALETTE verbatim (token-auth.ts). CORRECT today — the
    // content palette stays gold under the ruling — but it pins the literal hexes, so a future
    // accent move fails here with a message about accents, not about a chrome repaint.
    const palette = ['#f0c760', '#d4a843', '#f7a0b3', '#ffb7c5', '#ff8c42', '#e67635'];
    expect(palette).toContain(accentForName('anybody'));
  });

  it('resolveToken threads the hashed accent through', () => {
    expect(resolveToken('Alex')!.accent).toBe(accentForName('Alex'));
  });
});

describe('token-auth · signIn / getActiveTraveler / signOut round-trip', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists the nickname + token and reads it back', () => {
    const t = signIn('Casey');
    expect(t!.name).toBe('Casey');
    // Attribution pipeline unchanged: both the name slot AND the token slot are written.
    expect(window.localStorage.getItem(STORAGE_KEYS.userName)).toBe('Casey');
    expect(window.localStorage.getItem(STORAGE_KEYS.token)).toBe('Casey');

    const active = getActiveTraveler();
    expect(active!.name).toBe('Casey');
    expect(active!.accent).toBe(accentForName('Casey'));
  });

  it('signIn returns null and writes nothing for an empty name', () => {
    expect(signIn('   ')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
  });

  it('signOut clears both identity slots', () => {
    signIn('Dana');
    signOut();
    expect(getActiveTraveler()).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.userName)).toBeNull();
  });
});

describe('token-auth · TRAVELERS is now only the expense-split roster', () => {
  it('still exposes the three friends with their brand accents', () => {
    expect(TRAVELERS.map((t) => t.name)).toEqual(['Powan', 'Sushil', 'Uttam']);
    // R2/D-265: pins Powan's fixed hand-assigned tint (TRAVELERS[0].accent, token-auth.ts).
    // CORRECT today, but a future accent move fails here with a message about Powan's accent, not
    // about a chrome repaint.
    expect(TRAVELERS[0].accent).toBe('#f0c760');
  });
});

/**
 * S352, D-249 (amended by Ruling 1 / Ruling 1b / Ruling 4) — signOut() is now a FULL local
 * teardown, not just an identity clear. These pin the integration (signOut → wipeAllTripData);
 * `wipeAllTripData()`'s own unit coverage (both-namespace shape, collect-then-delete, SSR/disabled
 * safety) lives in `gateway-trip-scope.test.ts`.
 */
describe('token-auth · signOut is a full local teardown (S352, D-249)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('clears trip data in BOTH namespaces — the default pack (bare keys) AND a trip:* pack — not just identity', () => {
    // Default pack (bare, unprefixed) — the common case on a browser that never switched trips.
    window.localStorage.setItem('nepal_japan_budget', '{}');
    window.localStorage.setItem('nepal_japan_journal', '[]');
    // A non-default pack's namespaced keys too — both namespaces, one sign-out.
    window.localStorage.setItem('trip:some-other-trip:budget', '{}');
    signIn('Powan');

    signOut();

    expect(window.localStorage.getItem('nepal_japan_budget')).toBeNull();
    expect(window.localStorage.getItem('nepal_japan_journal')).toBeNull();
    expect(window.localStorage.getItem('trip:some-other-trip:budget')).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.token)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.userName)).toBeNull();
  });

  it('clears activeTrip, syncCode, knownTrips, removedTrips and travelMode (Ruling 4)', () => {
    window.localStorage.setItem(STORAGE_KEYS.activeTrip, 'some-trip');
    window.localStorage.setItem(STORAGE_KEYS.syncCode, 'abc-123');
    window.localStorage.setItem(STORAGE_KEYS.knownTrips, '[{"id":"x"}]');
    window.localStorage.setItem(STORAGE_KEYS.removedTrips, '[{"id":"y"}]');
    window.localStorage.setItem(STORAGE_KEYS.travelMode, 'active');
    signIn('Powan');

    signOut();

    expect(window.localStorage.getItem(STORAGE_KEYS.activeTrip)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.syncCode)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.knownTrips)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.removedTrips)).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEYS.travelMode)).toBeNull();
  });

  it('clears itineraryCorrupt too (Ruling 1b) — the quarantine slot is wiped by sign-out, unlike every other path', () => {
    window.localStorage.setItem(STORAGE_KEYS.itineraryCorrupt, "previous traveler's raw bytes");
    signIn('Powan');
    signOut();
    expect(window.localStorage.getItem(STORAGE_KEYS.itineraryCorrupt)).toBeNull();
  });

  it('emits identity:changed only AFTER the full teardown — a listener must never see half-deleted state', () => {
    window.localStorage.setItem(STORAGE_KEYS.activeTrip, 'some-trip');
    window.localStorage.setItem('nepal_japan_budget', '{}');
    signIn('Powan');

    let activeTripDuringEvent: string | null = 'sentinel-not-yet-fired';
    let budgetDuringEvent: string | null = 'sentinel-not-yet-fired';
    window.addEventListener(
      IDENTITY_CHANGED_EVENT,
      () => {
        activeTripDuringEvent = window.localStorage.getItem(STORAGE_KEYS.activeTrip);
        budgetDuringEvent = window.localStorage.getItem('nepal_japan_budget');
      },
      { once: true },
    );

    signOut();

    expect(activeTripDuringEvent).toBeNull();
    expect(budgetDuringEvent).toBeNull();
  });

  it('is total: never throws when storage is disabled mid-teardown', () => {
    signIn('Powan');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('disabled');
    });
    try {
      expect(() => signOut()).not.toThrow();
    } finally {
      vi.restoreAllMocks();
    }
  });
});
