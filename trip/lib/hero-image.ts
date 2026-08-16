// Which hero photograph belongs to which trip leg. Pure — the caller supplies the leg (see
// `getTodayInTrip()?.country` in lib/trip-now.ts, which resolves the `?today=` override); this
// module reads no clock and touches no DOM, so the mapping is unit-testable on its own.
//
// The default (Himalaya) hero deliberately covers MORE than the Nepal leg: it is also what every
// pre-trip day shows, and every post-trip day, because `getTodayInTrip()` returns `null` outside
// the trip window. That is the intent — the Himalaya shot is the app's identity photo, and Tokyo
// is the one that takes over, not the other way round. Both files are Wikimedia-sourced and
// credited in public/images/CREDITS.md; they are fetched by `scripts/fetch-images.mjs` (see the
// MANIFEST note there about why asking for a PAGE named after a mountain RANGE gives you a
// satellite map instead of a photograph).

/** Default hero — the Himalaya peak. Nepal leg, plus every day outside the trip window. */
export const HERO_DEFAULT = '/images/hero/hero.jpg';
/** Japan leg hero — the Shinjuku skyline with Fuji behind it. */
export const HERO_JAPAN = '/images/hero/hero-japan.jpg';

/**
 * Hero photograph for a trip leg. `leg` is `TripToday['country']` (`'nepal'` | `'japan'` for the
 * default pack), or `undefined`/`null` when the clock is outside the trip window.
 *
 * Anything that is not explicitly the Japan leg falls back to the default rather than throwing or
 * rendering nothing: a hero with no photograph is a blank front page, so an unrecognised leg id
 * (a custom pack's `'main'`, say, or a future third leg) must still paint something.
 */
export function heroImageForLeg(leg: string | null | undefined): string {
  return leg === 'japan' ? HERO_JAPAN : HERO_DEFAULT;
}
