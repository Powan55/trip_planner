/**
 * `core/trips/custom.ts` — synthesize a TripConfig for a CUSTOM (non-default-pack) trip from the
 * per-trip config block stored on its TripMeta. Framework-free: plain TS,
 * no React/Next/`window`. Import arrow stays one-way — this imports only `./model` (the
 * pack shape + `legForDate`) and the `DayPlan` / `TripMeta` TYPES (erased at runtime, no cycle).
 *
 * A custom trip is a SINGLE-leg pack: `id: 'main'`, `countryLabel` = destinations joined with
 * ' × ', currency from the config (default 'USD'), `utcOffsetMin: 0`, `fallbackCity` =
 * destinations[0], `contentRef: 'empty'` (so it inherits NO Nepal×Japan guide content — the
 * 'empty' content pack, `core/content/registry.ts`). Its itinerary is EMPTY: `buildDayShells`
 * produces one blank `DayPlan` per date in range (the vault fallback for a custom trip — no writes).
 */
import type { DayPlan } from '@/lib/trip-data';
import type { TripMeta } from './registry';
import { legForDate, type TripConfig } from './model';

/**
 * Vibe presets — CSS-only visual identity for a custom trip (gradient + accent, no images).
 * Consumed by the vibe hero; declared here so the config model and the UI share one source.
 * Each `gradient` is 2–3 HSL stops; `accent` is a single HSL; `tagline` is a short hero line.
 */
export interface Vibe {
  label: string;
  gradient: string[];
  accent: string;
  tagline: string;
}

export const VIBES: Record<string, Vibe> = {
  beach: {
    label: 'Beach & Coast',
    gradient: ['hsl(190 85% 55%)', 'hsl(170 70% 60%)', 'hsl(45 95% 70%)'],
    accent: 'hsl(190 90% 45%)',
    tagline: 'Salt air, slow days, endless horizon.',
  },
  city: {
    label: 'City & Culture',
    gradient: ['hsl(255 70% 60%)', 'hsl(300 65% 55%)', 'hsl(220 75% 50%)'],
    accent: 'hsl(280 80% 58%)',
    tagline: 'Neon nights and side-street discoveries.',
  },
  mountain: {
    label: 'Mountain & Trek',
    gradient: ['hsl(210 45% 55%)', 'hsl(200 30% 40%)', 'hsl(150 35% 55%)'],
    accent: 'hsl(155 55% 42%)',
    tagline: 'Thin air, big views, hard-earned peaks.',
  },
  culture: {
    label: 'Heritage & Wonder',
    gradient: ['hsl(30 85% 60%)', 'hsl(15 80% 55%)', 'hsl(45 90% 65%)'],
    accent: 'hsl(25 85% 52%)',
    tagline: 'Ancient stones and living traditions.',
  },
  roadtrip: {
    label: 'Road Trip',
    gradient: ['hsl(345 80% 60%)', 'hsl(20 85% 60%)', 'hsl(50 90% 65%)'],
    accent: 'hsl(355 82% 55%)',
    tagline: 'Open road, no fixed plans, just go.',
  },
};

/** The fallback vibe when a config carries an unknown key (TOTAL — never returns undefined). */
export const DEFAULT_VIBE = 'city';

/** Resolve a vibe preset by key, falling back to the default. TOTAL. */
export function vibeFor(key: string | undefined): Vibe {
  return VIBES[key ?? ''] ?? VIBES[DEFAULT_VIBE];
}

/**
 * Synthesize a single-leg `TripConfig` from a TripMeta's config block, or a PLACEHOLDER
 * single-leg config when the meta is registered but carries no config yet, or `null` when the
 * id isn't a known trip at all (⇒ the caller falls through to the default pack). PURE + TOTAL.
 *
 * A-2 (SB-6): join-by-Trip-Token / the `?trip=` handshake register a `TripMeta` with NO
 * `config` block — that is the NORMAL state for a joiner, not an edge case (`TripMeta.config`'s
 * own doc comment: "Absent for … join-by-key"). The old code returned `null` here for that case,
 * so `getTripConfig` fell through to `NEPAL_JAPAN_2026` — the joiner's own trip silently became a
 * 32-day Nepal×Japan itinerary, and `reconcileFirstSnapshot`'s seed branch (`lib/itinerary-remote.ts`)
 * then wrote those 32 Nepal/Japan day shells into the joiner's OWN (empty) Firestore trip. A
 * genuinely unknown id (`meta` itself absent — never joined) still returns `null` so an unrelated
 * lookup keeps falling to the default pack (unchanged, pinned by `trips-pack.test.ts`).
 */
export function customTripConfig(meta: TripMeta | undefined | null): TripConfig | null {
  if (!meta) return null;
  const c = meta.config;
  if (!c) return placeholderTripConfig(meta);
  const countryLabel = c.destinations.join(' × ');
  const currency = c.currency ?? 'USD';
  return {
    id: meta.id,
    label: meta.name,
    start: c.start,
    end: c.end,
    contentRef: 'empty',
    legs: [
      {
        id: 'main',
        countryLabel,
        currency,
        start: c.start,
        end: c.end,
        contentKey: 'main',
        utcOffsetMin: 0,
        fallbackCity: c.destinations[0],
      },
    ],
  };
}

/** `fallbackCity` for a placeholder trip — no destination is known yet, so this is a generic,
 * honest stand-in rather than guessing a real place (never Kathmandu/Tokyo — that was A-28, a
 * downstream symptom of A-2: `getCityForDate`'s custom-trip branch reads `legForDate(…).fallbackCity`,
 * so a config-less trip that fell through to the Nepal×Japan pack stamped the lifetime visited-city
 * record with whichever of those cities the CURRENT calendar date happened to land on). */
const PLACEHOLDER_CITY = 'Somewhere';

/**
 * A minimal single-day, single-leg `TripConfig` for a KNOWN trip (a registered `TripMeta`) that
 * has no user-authored config yet. Its itinerary Vault fallback (`buildDayShells`, below) then
 * manufactures exactly ONE empty day shell instead of the default pack's 32 — the day
 * `reconcileFirstSnapshot`'s seed branch pushes to Firestore for a config-less joiner. The span is
 * "today" (UTC) both start and end, re-evaluated fresh each call — deliberately not cached at
 * module load like the pack constants, since a placeholder has no fixed dates to freeze. PURE
 * relative to its args (no storage read) but NOT time-pure — `meta` alone can't decide "today",
 * and freezing a stale date here would be worse than a moving one.
 */
function placeholderTripConfig(meta: TripMeta): TripConfig {
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return {
    id: meta.id,
    label: meta.name,
    start: today,
    end: today,
    contentRef: 'empty',
    legs: [
      {
        id: 'main',
        countryLabel: meta.name,
        currency: 'USD',
        start: today,
        end: today,
        contentKey: 'main',
        utcOffsetMin: 0,
        fallbackCity: PLACEHOLDER_CITY,
      },
    ],
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The inclusive `YYYY-MM-DD` day sequence of a config's span, iterated in UTC so the produced
 * strings are TZ-independent (mirrors `core/dates/trip-dates.ts`'s TRIP_DATES iterator — kept
 * local here so `core/trips` imports nothing from `core/dates`, preserving the one-way arrow).
 */
function dateRange(startIso: string, endIso: string): string[] {
  const dates: string[] = [];
  const [ys, ms, ds] = startIso.split('-').map(Number);
  const [ye, me, de] = endIso.split('-').map(Number);
  const d = new Date(Date.UTC(ys, ms - 1, ds));
  const end = new Date(Date.UTC(ye, me - 1, de));
  while (d <= end) {
    dates.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

/**
 * The empty-itinerary vault fallback for a custom trip (Plan D4): one blank `DayPlan` per date in
 * the config's span — `items: []`, `city` = the day's leg fallbackCity, `country` = the leg id.
 * PURE (no storage writes) — `lib/itinerary-storage.ts` uses it only as the load-time fallback.
 */
export function buildDayShells(config: TripConfig): DayPlan[] {
  return dateRange(config.start, config.end).map((date) => {
    const leg = legForDate(config, date);
    return { date, city: leg.fallbackCity, country: leg.id, items: [] };
  });
}
