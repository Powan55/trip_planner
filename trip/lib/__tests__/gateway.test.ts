// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STORAGE_KEYS,
  readString,
  writeString,
  removeKey,
  hasKey,
  readJson,
  writeJson,
  identityStore,
  uiPrefs,
  clockOverride,
  favoritesStore,
  tourStore,
  legibilityPrefs,
  installHintStore,
  isQuotaError,
  notifyQuotaExceeded,
} from '@/core/storage/gateway';

/**
 * Typed storage gateway (S91 / D-097 LOCKED) — the ONE module fronting the non-itinerary
 * persisted keys. These tests pin the properties the design note demands and the three
 * back-compat risks it calls out:
 *   - SSR no-op (no window → read fallback / write no-op, never throws)
 *   - never-throw on quota / disabled storage
 *   - key-presence semantics (D-018 signal)
 *   - store-per-key routing (local vs SESSION for the clock override — D-075)
 *   - clearIdentity clears BOTH name + token (cross-module ownership, risk 2)
 *   - nightlife pref is String(boolean), lenient `=== 'true'` parse, NOT JSON (risk 3)
 *   - on-disk key strings + value shapes byte-identical to the pre-gateway code
 *
 * The gateway is the on-disk contract for a LIVE, sync-enabled site, so "the stored bytes
 * are exactly what the old inline code wrote" is asserted directly (not just via behavior).
 */

describe('storage gateway (D-097)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  // ── Key registry: the exact on-disk strings are frozen (back-compat) ──────
  describe('STORAGE_KEYS — the on-disk key strings are byte-identical', () => {
    it('pins every non-itinerary persisted key literal verbatim', () => {
      expect(STORAGE_KEYS.userName).toBe('tripPlannerUserName');
      expect(STORAGE_KEYS.token).toBe('tripPlannerToken');
      expect(STORAGE_KEYS.nightlifeVisible).toBe('nightlife_section_visible');
      expect(STORAGE_KEYS.todayOverride).toBe('tripPlannerTodayOverride');
    });

    it('now OWNS the itinerary keys too (S232/D-210 — moved into the registry from the Vault)', () => {
      // Historically the itinerary Vault kept its two literals OUT of the registry (S90). S232
      // moves them in (byte-identical strings) so keyFor() can trip-scope a non-default pack's
      // itinerary — the local-data-bleed fix. The default pack still grandfathers these bytes.
      expect(STORAGE_KEYS.itinerary).toBe('nepal_japan_itinerary');
      expect(STORAGE_KEYS.itineraryCorrupt).toBe('nepal_japan_itinerary_corrupt');
    });
  });

  // ── Low-level primitives ──────────────────────────────────────────────────
  describe('primitives — store-per-key routing (local vs session)', () => {
    it('readString/writeString round-trip on the LOCAL store, isolated from session', () => {
      writeString('local', 'k', 'v');
      expect(readString('local', 'k')).toBe('v');
      expect(readString('session', 'k')).toBeNull(); // different backend
      expect(window.localStorage.getItem('k')).toBe('v');
      expect(window.sessionStorage.getItem('k')).toBeNull();
    });

    it('readString/writeString round-trip on the SESSION store, isolated from local', () => {
      writeString('session', 'k', 'v');
      expect(readString('session', 'k')).toBe('v');
      expect(readString('local', 'k')).toBeNull();
      expect(window.sessionStorage.getItem('k')).toBe('v');
      expect(window.localStorage.getItem('k')).toBeNull();
    });

    it('removeKey removes from the correct store only', () => {
      writeString('local', 'k', 'v');
      writeString('session', 'k', 'v');
      removeKey('local', 'k');
      expect(readString('local', 'k')).toBeNull();
      expect(readString('session', 'k')).toBe('v'); // session untouched
    });

    it('readString returns null for an absent key', () => {
      expect(readString('local', 'nope')).toBeNull();
    });

    it('hasKey reflects presence regardless of value, per store (D-018 signal)', () => {
      expect(hasKey('local', 'k')).toBe(false);
      writeString('local', 'k', ''); // present but empty
      expect(hasKey('local', 'k')).toBe(true);
      expect(hasKey('session', 'k')).toBe(false); // not on session
    });

    it('readJson returns the fallback on absent, and parses a stored object', () => {
      expect(readJson('local', 'j', { a: 1 })).toEqual({ a: 1 });
      writeJson('local', 'j', { a: 2, b: true });
      expect(readJson<{ a: number; b: boolean }>('local', 'j', { a: 0, b: false })).toEqual({
        a: 2,
        b: true,
      });
    });

    it('readJson returns the fallback (never throws) on corrupt JSON', () => {
      window.localStorage.setItem('j', '{not json');
      expect(readJson('local', 'j', { safe: true })).toEqual({ safe: true });
    });
  });

  // ── SSR-safety (no window) ────────────────────────────────────────────────
  describe('SSR-safety — no window ⇒ read fallback / write no-op, never throws', () => {
    let savedWindow: typeof globalThis.window;

    beforeEach(() => {
      savedWindow = globalThis.window;
      // Simulate the server: no window. jsdom lets us delete + restore it.
      // @ts-expect-error — intentionally removing window for the SSR path.
      delete globalThis.window;
    });

    afterEach(() => {
      globalThis.window = savedWindow;
    });

    it('reads return the typed fallback and writes are inert (both stores)', () => {
      expect(() => {
        expect(readString('local', STORAGE_KEYS.token)).toBeNull();
        expect(readString('session', STORAGE_KEYS.todayOverride)).toBeNull();
        writeString('local', STORAGE_KEYS.token, 'x'); // no-op
        removeKey('session', STORAGE_KEYS.todayOverride); // no-op
      }).not.toThrow();
    });

    it('domain accessors are SSR-safe too', () => {
      expect(() => {
        expect(identityStore.getName()).toBeNull();
        expect(identityStore.getToken()).toBeNull();
        expect(uiPrefs.getNightlifeVisible()).toBeNull();
        expect(clockOverride.get()).toBeNull();
        identityStore.setName('x');
        identityStore.clearIdentity();
        clockOverride.set('2026-12-09');
      }).not.toThrow();
    });
  });

  // ── Never-throw on quota / disabled storage ───────────────────────────────
  describe('never-throw on quota / disabled storage', () => {
    it('writeString swallows a throwing setItem and does not propagate', () => {
      const spy = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new DOMException('QuotaExceededError');
        });
      expect(() => writeString('local', 'k', 'v')).not.toThrow();
      expect(spy).toHaveBeenCalled();
    });

    it('writeJson swallows a throwing setItem', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(() => writeJson('local', 'k', { a: 1 })).not.toThrow();
    });

    it('readString swallows a throwing getItem and returns null', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(readString('local', 'k')).toBeNull();
      expect(hasKey('local', 'k')).toBe(false);
    });

    it('removeKey swallows a throwing removeItem', () => {
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(() => removeKey('local', 'k')).not.toThrow();
    });

    it('writeJson silently drops an unserializable (cyclic) value without throwing', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => writeJson('local', 'k', cyclic)).not.toThrow();
      expect(window.localStorage.getItem('k')).toBeNull(); // nothing written
    });
  });

  // ── S279 — reactive `trip:quota-exceeded` event on a detected quota failure ───
  describe('S279 — isQuotaError()', () => {
    it('true for a QuotaExceededError-named DOMException (code 22)', () => {
      expect(isQuotaError(new DOMException('nope', 'QuotaExceededError'))).toBe(true);
    });

    it('true for Firefox NS_ERROR_DOM_QUOTA_REACHED (code 1014)', () => {
      expect(isQuotaError(new DOMException('nope', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
    });

    it('false for a differently-named DOMException (e.g. disabled storage / SecurityError)', () => {
      expect(isQuotaError(new DOMException('nope', 'SecurityError'))).toBe(false);
    });

    it('false for a non-DOMException throw (plain Error, string, undefined)', () => {
      expect(isQuotaError(new Error('disabled'))).toBe(false);
      expect(isQuotaError('nope')).toBe(false);
      expect(isQuotaError(undefined)).toBe(false);
    });
  });

  describe('S279 — writeString/writeJson fire trip:quota-exceeded ONLY on a detected quota error', () => {
    it('writeString fires the event (with the key in detail) on a QuotaExceededError-shaped setItem throw', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
      const handler = vi.fn();
      window.addEventListener('trip:quota-exceeded', handler);
      try {
        expect(() => writeString('local', 'k', 'v')).not.toThrow();
        expect(handler).toHaveBeenCalledTimes(1);
        const evt = handler.mock.calls[0][0] as CustomEvent<{ key: string }>;
        expect(evt.detail.key).toBe('k');
      } finally {
        window.removeEventListener('trip:quota-exceeded', handler);
      }
    });

    it('writeJson (delegates to writeString) also fires the event on a quota-shaped throw', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
      const handler = vi.fn();
      window.addEventListener('trip:quota-exceeded', handler);
      try {
        expect(() => writeJson('local', 'k', { a: 1 })).not.toThrow();
        expect(handler).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('trip:quota-exceeded', handler);
      }
    });

    it('does NOT fire on a non-quota failure (disabled storage / privacy mode) — stays silent', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      const handler = vi.fn();
      window.addEventListener('trip:quota-exceeded', handler);
      try {
        expect(() => writeString('local', 'k', 'v')).not.toThrow();
        expect(handler).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('trip:quota-exceeded', handler);
      }
    });

    it('does NOT fire on a successful write', () => {
      const handler = vi.fn();
      window.addEventListener('trip:quota-exceeded', handler);
      try {
        writeString('local', 'k', 'v');
        expect(handler).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener('trip:quota-exceeded', handler);
      }
    });

    it('NEVER-THROW is absolute: dispatchEvent itself throwing (e.g. a listener blowing up, which this jsdom rethrows synchronously) does not break the write or propagate', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });
      vi.spyOn(window, 'dispatchEvent').mockImplementation(() => {
        throw new Error('listener blew up');
      });
      expect(() => writeString('local', 'k', 'v')).not.toThrow();
    });

    it('notifyQuotaExceeded itself never throws even with no CustomEvent support', () => {
      const original = globalThis.CustomEvent;
      // @ts-expect-error — simulate an environment without CustomEvent.
      delete globalThis.CustomEvent;
      try {
        expect(() => notifyQuotaExceeded('k')).not.toThrow();
      } finally {
        globalThis.CustomEvent = original;
      }
    });

    it('notifyQuotaExceeded is a no-op (never throws) with no window (SSR)', () => {
      const saved = globalThis.window;
      // @ts-expect-error — intentionally remove window for the SSR path.
      delete globalThis.window;
      try {
        expect(() => notifyQuotaExceeded('k')).not.toThrow();
      } finally {
        globalThis.window = saved;
      }
    });
  });

  // ── identityStore (keys 3 + 4) — incl. risk 2: clearIdentity clears BOTH ──
  describe('identityStore (keys 3 + 4)', () => {
    it('name round-trips on localStorage and trims on write (unchanged contract)', () => {
      identityStore.setName('  Powan  ');
      expect(identityStore.getName()).toBe('Powan');
      expect(window.localStorage.getItem('tripPlannerUserName')).toBe('Powan'); // on-disk value
    });

    it('token round-trips on localStorage under the exact key', () => {
      identityStore.setToken('Sushil');
      expect(identityStore.getToken()).toBe('Sushil');
      expect(window.localStorage.getItem('tripPlannerToken')).toBe('Sushil');
    });

    it('RISK 2 — clearIdentity clears BOTH the token AND the name (sign-out)', () => {
      identityStore.setName('Uttam');
      identityStore.setToken('Uttam');
      identityStore.clearIdentity();
      expect(identityStore.getName()).toBeNull();
      expect(identityStore.getToken()).toBeNull();
      expect(window.localStorage.getItem('tripPlannerUserName')).toBeNull();
      expect(window.localStorage.getItem('tripPlannerToken')).toBeNull();
    });
  });

  // ── uiPrefs (key 7) — RISK 3: String(boolean), lenient `=== 'true'` parse ─
  describe('uiPrefs (key 7) — RISK 3: nightlife pref is String(boolean), NOT JSON', () => {
    it('getNightlifeVisible returns null when the key is ABSENT (preserves default)', () => {
      expect(uiPrefs.getNightlifeVisible()).toBeNull();
    });

    it('setNightlifeVisible writes String(boolean) — "true"/"false", not JSON', () => {
      uiPrefs.setNightlifeVisible(true);
      expect(window.localStorage.getItem('nightlife_section_visible')).toBe('true');
      uiPrefs.setNightlifeVisible(false);
      expect(window.localStorage.getItem('nightlife_section_visible')).toBe('false');
    });

    it('getNightlifeVisible parses leniently with `=== "true"` (round-trip both bools)', () => {
      uiPrefs.setNightlifeVisible(true);
      expect(uiPrefs.getNightlifeVisible()).toBe(true);
      uiPrefs.setNightlifeVisible(false);
      expect(uiPrefs.getNightlifeVisible()).toBe(false);
    });

    it('any non-"true" stored string reads as false (lenient, never JSON.parse)', () => {
      // A stored value that JSON.parse would choke on must NOT throw here.
      window.localStorage.setItem('nightlife_section_visible', 'yes');
      expect(uiPrefs.getNightlifeVisible()).toBe(false);
      window.localStorage.setItem('nightlife_section_visible', '1');
      expect(uiPrefs.getNightlifeVisible()).toBe(false);
    });
  });

  // ── clockOverride (key 8) — SESSION store only (D-075) ────────────────────
  describe('clockOverride (key 8) — SESSION store only (D-075)', () => {
    it('set/get round-trips a YYYY-MM-DD string on SESSION storage', () => {
      clockOverride.set('2026-12-09');
      expect(clockOverride.get()).toBe('2026-12-09');
      // on-disk: SESSION storage, NOT localStorage (the store-per-key invariant).
      expect(window.sessionStorage.getItem('tripPlannerTodayOverride')).toBe('2026-12-09');
      expect(window.localStorage.getItem('tripPlannerTodayOverride')).toBeNull();
    });

    it('clear removes the SESSION key (the `?today=off` path)', () => {
      clockOverride.set('2026-12-09');
      clockOverride.clear();
      expect(clockOverride.get()).toBeNull();
      expect(window.sessionStorage.getItem('tripPlannerTodayOverride')).toBeNull();
    });

    it('is isolated from localStorage — a local value of the same key is invisible', () => {
      window.localStorage.setItem('tripPlannerTodayOverride', '2099-01-01');
      expect(clockOverride.get()).toBeNull(); // reads SESSION only
    });
  });

  // ── favoritesStore (key 14, S149) — mirrors journalStore/expensesStore exactly ─
  describe('favoritesStore (key 14, S149)', () => {
    it('the on-disk key string is exactly nepal_japan_favorites (additive, no migration)', () => {
      expect(STORAGE_KEYS.favorites).toBe('nepal_japan_favorites');
      expect(STORAGE_KEYS.favorites).not.toBe(STORAGE_KEYS.itinerary);
      expect(STORAGE_KEYS.favorites).not.toBe(STORAGE_KEYS.journal);
    });

    it('get returns the fallback when absent', () => {
      expect(favoritesStore.get<string[]>([])).toEqual([]);
    });

    it('set → get round-trips a string[] of ids, stored as JSON under the key', () => {
      favoritesStore.set<string[]>(['na1', 'nf2']);
      expect(window.localStorage.getItem('nepal_japan_favorites')).toBe('["na1","nf2"]');
      expect(favoritesStore.get<string[]>([])).toEqual(['na1', 'nf2']);
    });

    it('a corrupt (non-JSON) slot returns the fallback, never throws', () => {
      window.localStorage.setItem('nepal_japan_favorites', '{not json');
      expect(() => favoritesStore.get<string[]>([])).not.toThrow();
      expect(favoritesStore.get<string[]>([])).toEqual([]);
    });

    it('SSR-safe: with no window, get returns the fallback and set is inert', () => {
      const saved = globalThis.window;
      // @ts-expect-error — intentionally remove window for the SSR path.
      delete globalThis.window;
      try {
        expect(() => {
          expect(favoritesStore.get<string[]>([])).toEqual([]);
          favoritesStore.set<string[]>(['x']); // no-op
        }).not.toThrow();
      } finally {
        globalThis.window = saved;
      }
    });
  });

  // ── tourStore (key 17, S155) — first-run tour, exactly-once presence flag ─
  describe('tourStore (key 17, S155)', () => {
    it('the on-disk key string is exactly nepal_japan_first_run_tour_seen (additive, no migration)', () => {
      expect(STORAGE_KEYS.firstRunTour).toBe('nepal_japan_first_run_tour_seen');
      expect(STORAGE_KEYS.firstRunTour).not.toBe(STORAGE_KEYS.itinerary);
    });

    it('hasSeenTour is false when unset (fresh browser)', () => {
      expect(tourStore.hasSeenTour()).toBe(false);
    });

    it('markTourSeen sets the presence flag and hasSeenTour reads it true', () => {
      tourStore.markTourSeen();
      expect(window.localStorage.getItem('nepal_japan_first_run_tour_seen')).toBe('1');
      expect(tourStore.hasSeenTour()).toBe(true);
    });

    it('EXACTLY-ONCE: once marked, a fresh tourStore read (simulating reload / a new module instance) still reports seen', () => {
      tourStore.markTourSeen();
      // Simulate "reload": nothing but the persisted localStorage bytes carries state across a
      // reload (no in-memory cache in this slot) — re-reading via the same accessor after the
      // mark is the reload-proof, since the accessor has no module-level cache to reset.
      expect(tourStore.hasSeenTour()).toBe(true);
      expect(hasKey('local', STORAGE_KEYS.firstRunTour)).toBe(true);
    });

    it('is on the LOCAL store, not session (must survive a reload, unlike chunkReloadGuard)', () => {
      tourStore.markTourSeen();
      expect(window.sessionStorage.getItem('nepal_japan_first_run_tour_seen')).toBeNull();
    });

    it('SSR-safe: with no window, hasSeenTour returns false and markTourSeen is inert, never throws', () => {
      const saved = globalThis.window;
      // @ts-expect-error — intentionally remove window for the SSR path.
      delete globalThis.window;
      try {
        expect(() => {
          expect(tourStore.hasSeenTour()).toBe(false);
          tourStore.markTourSeen(); // no-op
        }).not.toThrow();
      } finally {
        globalThis.window = saved;
      }
    });

    it('never throws when storage is disabled/throwing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(() => tourStore.hasSeenTour()).not.toThrow();
      expect(tourStore.hasSeenTour()).toBe(false);
    });
  });

  // ── legibilityPrefs (key 18, S189) — Travel Mode outdoor high-legibility toggle,
  //    mirrors uiPrefs (RISK 3 shape) exactly: String(boolean), NOT JSON ──────────
  describe('legibilityPrefs (key 18, S189) — TM outdoor toggle, mirrors uiPrefs exactly', () => {
    it('the on-disk key string is exactly nepal_japan_travel_legibility (additive, no migration)', () => {
      expect(STORAGE_KEYS.travelLegibility).toBe('nepal_japan_travel_legibility');
      expect(STORAGE_KEYS.travelLegibility).not.toBe(STORAGE_KEYS.itinerary);
      expect(STORAGE_KEYS.travelLegibility).not.toBe(STORAGE_KEYS.nightlifeVisible);
    });

    it('get() returns null when the key is ABSENT (fresh browser default)', () => {
      expect(legibilityPrefs.get()).toBeNull();
    });

    it('set writes String(boolean) — "true"/"false", not JSON', () => {
      legibilityPrefs.set(true);
      expect(window.localStorage.getItem('nepal_japan_travel_legibility')).toBe('true');
      legibilityPrefs.set(false);
      expect(window.localStorage.getItem('nepal_japan_travel_legibility')).toBe('false');
    });

    it('get parses leniently with `=== "true"` (round-trip both bools)', () => {
      legibilityPrefs.set(true);
      expect(legibilityPrefs.get()).toBe(true);
      legibilityPrefs.set(false);
      expect(legibilityPrefs.get()).toBe(false);
    });

    it('any non-"true" stored string reads as false (lenient, never JSON.parse)', () => {
      window.localStorage.setItem('nepal_japan_travel_legibility', 'yes');
      expect(legibilityPrefs.get()).toBe(false);
    });

    it('is on the LOCAL store (survives a reload, unlike clockOverride)', () => {
      legibilityPrefs.set(true);
      expect(window.sessionStorage.getItem('nepal_japan_travel_legibility')).toBeNull();
      expect(window.localStorage.getItem('nepal_japan_travel_legibility')).toBe('true');
    });

    it('SSR-safe: with no window, get returns null and set is inert, never throws', () => {
      const saved = globalThis.window;
      // @ts-expect-error — intentionally remove window for the SSR path.
      delete globalThis.window;
      try {
        expect(() => {
          expect(legibilityPrefs.get()).toBeNull();
          legibilityPrefs.set(true); // no-op
        }).not.toThrow();
      } finally {
        globalThis.window = saved;
      }
    });

    it('never throws when storage is disabled/throwing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(() => legibilityPrefs.get()).not.toThrow();
      expect(legibilityPrefs.get()).toBeNull();
    });
  });

  // ── installHintStore (key 30, S272) — install-to-Home hint, exactly-once presence flag,
  //    mirrors tourStore (key 17) exactly ─────────────────────────────────────
  describe('installHintStore (key 30, S272)', () => {
    it('the on-disk key string is exactly nepal_japan_install_hint_dismissed (additive, no migration)', () => {
      expect(STORAGE_KEYS.installHintDismissed).toBe('nepal_japan_install_hint_dismissed');
      expect(STORAGE_KEYS.installHintDismissed).not.toBe(STORAGE_KEYS.firstRunTour);
    });

    it('hasBeenDismissed is false when unset (fresh browser)', () => {
      expect(installHintStore.hasBeenDismissed()).toBe(false);
    });

    it('markDismissed sets the presence flag and hasBeenDismissed reads it true', () => {
      installHintStore.markDismissed();
      expect(window.localStorage.getItem('nepal_japan_install_hint_dismissed')).toBe('1');
      expect(installHintStore.hasBeenDismissed()).toBe(true);
    });

    it('is on the LOCAL store, not session (must survive a reload)', () => {
      installHintStore.markDismissed();
      expect(window.sessionStorage.getItem('nepal_japan_install_hint_dismissed')).toBeNull();
    });

    it('SSR-safe: with no window, hasBeenDismissed returns false and markDismissed is inert, never throws', () => {
      const saved = globalThis.window;
      // @ts-expect-error — intentionally remove window for the SSR path.
      delete globalThis.window;
      try {
        expect(() => {
          expect(installHintStore.hasBeenDismissed()).toBe(false);
          installHintStore.markDismissed(); // no-op
        }).not.toThrow();
      } finally {
        globalThis.window = saved;
      }
    });

    it('never throws when storage is disabled/throwing', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('disabled');
      });
      expect(() => installHintStore.hasBeenDismissed()).not.toThrow();
      expect(installHintStore.hasBeenDismissed()).toBe(false);
    });
  });

  // ── On-disk-unchanged proof: the session key ───────────────────────────────
  describe('on-disk value is byte-identical to the pre-gateway inline code', () => {
    it('today-override (session): gateway writes the SAME raw string the old inline setItem did', () => {
      // What trip-now.ts used to write: sessionStorage.setItem(key, param) — the raw date string.
      const param = '2026-12-31';
      clockOverride.set(param);
      expect(window.sessionStorage.getItem('tripPlannerTodayOverride')).toBe(param);
    });
  });
});
