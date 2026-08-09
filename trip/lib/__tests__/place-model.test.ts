import { describe, it, expect } from 'vitest';

/**
 * S284 — pure my-places core (D-016/D-099). `core/places/model.ts` is framework-free; these tests
 * pin the Zod read boundary (`sanitizePlace`/`sanitizePlaces` — total, id/name/legId/addedAt-required,
 * drops bad coords, dedupe by id, cap-200 drop-oldest, empty on non-array/all-corrupt), the pure
 * mutators (`addPlace`/`removePlace`), the leg inference (`inferLegId` — custom single-leg, default-pack
 * bbox Nepal-hit / Japan-hit / miss / no-coords), and the Google-host gate (`isGooglePlaceUrl`).
 */

import {
  sanitizePlace,
  sanitizePlaces,
  addPlace,
  removePlace,
  inferLegId,
  isGooglePlaceUrl,
  PLACES_CAP,
  type MyPlace,
} from '@/core/places/model';
import type { TripConfig } from '@/core/trips/model';

const base: MyPlace = { id: 'a', name: 'Fushimi Inari', legId: 'japan', addedAt: '2026-07-24T10:00:00.000Z' };

// Minimal configs — inferLegId only reads `config.legs` (id + length).
const DEFAULT_CFG = { legs: [{ id: 'nepal' }, { id: 'japan' }] } as unknown as TripConfig;
const CUSTOM_CFG = { legs: [{ id: 'main' }] } as unknown as TripConfig;

describe('sanitizePlace — parse-don\'t-validate', () => {
  it('accepts a valid place verbatim (all fields preserved)', () => {
    const full: MyPlace = { ...base, sourceUrl: 'https://maps.app.goo.gl/x', resolvedUrl: 'https://www.google.com/maps/place/y', lat: 34.96, lng: 135.77, note: 'torii gates' };
    expect(sanitizePlace(full)).toEqual(full);
  });

  it('trims name/legId and drops blank note/url + non-finite coords', () => {
    // Infinity passes Zod's `z.number()` (only `.finite()` rejects it) — `cleanNum` drops it.
    expect(sanitizePlace({ id: ' a ', name: '  Temple  ', legId: ' nepal ', addedAt: ' t ', note: '   ', sourceUrl: '', lat: Infinity, lng: -Infinity }))
      .toEqual({ id: 'a', name: 'Temple', legId: 'nepal', addedAt: 't' });
  });

  it('rejects missing id / name / legId / addedAt', () => {
    expect(sanitizePlace({ name: 'x', legId: 'japan', addedAt: 't' })).toBeNull();
    expect(sanitizePlace({ id: 'a', legId: 'japan', addedAt: 't' })).toBeNull();
    expect(sanitizePlace({ id: 'a', name: 'x', addedAt: 't' })).toBeNull();
    expect(sanitizePlace({ id: 'a', name: 'x', legId: 'japan' })).toBeNull();
    expect(sanitizePlace(null)).toBeNull();
    expect(sanitizePlace('nope')).toBeNull();
  });
});

describe('sanitizePlaces — dedupe, cap, empty', () => {
  it('dedupes by id (first/newest wins) and keeps order', () => {
    const list = [base, { ...base, name: 'dupe' }, { ...base, id: 'b', name: 'B' }];
    const out = sanitizePlaces(list);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('Fushimi Inari'); // first occurrence wins
    expect(out[1].id).toBe('b');
  });

  it('caps to the newest PLACES_CAP and returns [] on non-array / all-corrupt', () => {
    const many = Array.from({ length: PLACES_CAP + 10 }, (_, i) => ({ ...base, id: `id-${i}` }));
    expect(sanitizePlaces(many)).toHaveLength(PLACES_CAP);
    expect(sanitizePlaces('not-array')).toEqual([]);
    expect(sanitizePlaces([{ bad: 1 }, null])).toEqual([]);
  });
});

describe('addPlace / removePlace — pure mutators', () => {
  it('addPlace prepends newest-first, dedupes, caps', () => {
    const out = addPlace([base], { ...base, id: 'b', name: 'B' });
    expect(out.map((p) => p.id)).toEqual(['b', 'a']);
    // re-adding same id moves it to the head (dedupe)
    const out2 = addPlace(out, { ...base, id: 'a', name: 'A2' });
    expect(out2.map((p) => p.id)).toEqual(['a', 'b']);
    expect(out2[0].name).toBe('A2');
  });

  it('removePlace drops by id; a non-match is a no-op', () => {
    expect(removePlace([base], 'a')).toEqual([]);
    expect(removePlace([base], 'zzz')).toEqual([base]);
  });
});

describe('inferLegId — leg assignment', () => {
  it('a single-leg custom trip always returns that leg (coords ignored)', () => {
    expect(inferLegId(CUSTOM_CFG)).toBe('main');
    expect(inferLegId(CUSTOM_CFG, 34.9, 135.7)).toBe('main');
  });

  it('default pack: Kathmandu ⇒ nepal, Kyoto ⇒ japan, Bangkok ⇒ undefined, no-coords ⇒ undefined', () => {
    expect(inferLegId(DEFAULT_CFG, 27.7172, 85.324)).toBe('nepal'); // Kathmandu
    expect(inferLegId(DEFAULT_CFG, 35.0116, 135.7681)).toBe('japan'); // Kyoto
    expect(inferLegId(DEFAULT_CFG, 13.7563, 100.5018)).toBeUndefined(); // Bangkok
    expect(inferLegId(DEFAULT_CFG)).toBeUndefined();
  });
});

describe('isGooglePlaceUrl — host allow/deny', () => {
  it('allows the https Google place hosts', () => {
    expect(isGooglePlaceUrl('https://share.google/abc')).toBe(true);
    expect(isGooglePlaceUrl('https://maps.app.goo.gl/xyz')).toBe(true);
    expect(isGooglePlaceUrl('https://goo.gl/maps/xyz')).toBe(true);
    expect(isGooglePlaceUrl('https://www.google.com/maps/place/Foo')).toBe(true);
    expect(isGooglePlaceUrl('https://maps.google.com/?q=1')).toBe(true);
  });

  it('denies http, foreign hosts, and non-URLs', () => {
    expect(isGooglePlaceUrl('http://google.com/maps')).toBe(false); // not https
    expect(isGooglePlaceUrl('https://example.com/maps')).toBe(false);
    expect(isGooglePlaceUrl('https://evilgoogle.com')).toBe(false); // no suffix matching
    expect(isGooglePlaceUrl('not a url')).toBe(false);
    expect(isGooglePlaceUrl(42)).toBe(false);
  });

  // S349 — widened to the same anchored ccTLD regex as the Worker's `isAllowedGoogleHost`
  // (worker/src/resolve.ts): a share link copied on a phone abroad carries the local Google
  // domain, and the old exact-match set silently rejected it (disabled "Look up" for no reason).
  it('S349: widens to Google ccTLD hosts (google.co.jp, google.de, maps.google.co.jp)', () => {
    expect(isGooglePlaceUrl('https://www.google.co.jp/maps/place/Foo')).toBe(true);
    expect(isGooglePlaceUrl('https://google.co.jp/maps/place/Foo')).toBe(true);
    expect(isGooglePlaceUrl('https://www.google.de/maps/place/Foo')).toBe(true);
    expect(isGooglePlaceUrl('https://maps.google.co.jp/?q=1')).toBe(true);
  });

  // S349 — anchored both ends, matching the Worker's own attacker-host cases verbatim so the two
  // allow-lists agree on the exact boundary, not just the happy path.
  it('S349: rejects anchor-bypass attacker hosts (evil-google.com, google.com.attacker.net)', () => {
    expect(isGooglePlaceUrl('https://evil-google.com/maps')).toBe(false);
    expect(isGooglePlaceUrl('https://google.com.attacker.net/maps')).toBe(false);
    expect(isGooglePlaceUrl('https://notgoogle.com')).toBe(false);
  });
});
