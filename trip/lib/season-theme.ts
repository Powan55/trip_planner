// Pure month -> ambient background tint lookup for the app-shell background (issue #83).
// Framework-free, mirrors the lookup-table shape of lib/city-coords.ts: a plain record plus
// one resolver function, no I/O. The HSL triplet is consumed as `hsl(var(--bg-season) / a)`
// at low alpha by the body::before wash in app/globals.css — the value stored here is a full
// authored colour, and it's the LOW ALPHA at the consumption site (not a muted token) that
// keeps the effect subtle, so these read as normal, distinct hues on their own.

export type SeasonTheme = {
  id: string;
  /** [hue-deg, saturation-%, lightness-%] */
  hsl: readonly [number, number, number];
};

// One tint per calendar month (0 = January), evoking the season without naming a country/
// culture. Deliberately a single hue shift each — this is a background wash, not an
// illustration.
const MONTH_THEMES: readonly SeasonTheme[] = [
  { id: 'jan', hsl: [205, 70, 60] }, // frost blue
  { id: 'feb', hsl: [265, 55, 62] }, // dusk violet
  { id: 'mar', hsl: [150, 55, 55] }, // bloom mint
  { id: 'apr', hsl: [120, 50, 55] }, // fresh green
  { id: 'may', hsl: [75, 60, 58] },  // meadow gold
  { id: 'jun', hsl: [44, 90, 60] },  // sun gold
  { id: 'jul', hsl: [190, 65, 55] }, // ocean teal
  { id: 'aug', hsl: [32, 80, 58] },  // amber haze
  { id: 'sep', hsl: [28, 75, 55] },  // harvest amber
  { id: 'oct', hsl: [18, 80, 55] },  // rust orange
  { id: 'nov', hsl: [25, 60, 45] },  // copper
  { id: 'dec', hsl: [152, 45, 32] }, // evergreen
];

// Special-day override: New Year's Eve/Day (Dec 31 - Jan 1) supersedes both December's
// evergreen and January's frost for those two calendar dates.
const NEW_YEAR_THEME: SeasonTheme = { id: 'new-year', hsl: [44, 85, 65] }; // champagne gold

/** Month/special-day -> ambient theme. Pure — the caller supplies `date` (see lib/trip-now.ts's
 * `getNow()`, which resolves the `?today=` simulation override); this function reads no clock. */
export function seasonThemeFor(date: Date): SeasonTheme {
  const month = date.getMonth(); // 0-11
  const day = date.getDate();
  if ((month === 11 && day === 31) || (month === 0 && day === 1)) return NEW_YEAR_THEME;
  return MONTH_THEMES[month];
}
