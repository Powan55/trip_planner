'use client';

/**
 * PageHero — compact per-page hero header.
 *
 * A gradient + type header that gives each route (/plan, /nepal, /japan,
 * /map) an editorial masthead WITHOUT imagery (exact-location-free-photos rule
 * → use none; the design spec forbids new imagery). It consumes the existing
 * design tokens only — it defines no new CSS.
 *
 * Treatment (per the design spec):
 *   - `.glass-panel` shell (top elevation tier: radius-2xl + shadow-2xl,
 *     gradient hairline edge) sitting on the app-wide aurora/grain field.
 *   - `text-eyebrow uppercase` overline in the route accent (`--accent-scroll`,
 *     which the route-accent-engine warms/cools per page — gold/himalaya/sakura).
 *   - `text-display-lg` title using the variant's static brand gradient
 *     (nepal→himalaya, japan→sakura, plan/map→gold).
 *   - `.animate-reveal-up` entrance. The wrapper's BASE opacity is 1 (the
 *     keyframe supplies the entrance from 0), so under reduced motion — where
 *     the CSS collapses the duration — it lands settled/visible, never stuck at
 *     opacity:0.
 *
 * Compact by construction: tight vertical padding + max title size keep it
 * ≤ ~40vh at 390px so it does not push page content below the fold on mobile.
 *
 * Accessibility:
 *   - `as` controls the heading level so hierarchy stays correct per page. On
 *     pages that ALREADY own an <h1> (Home's hero), pass `as="h2"`; on pages
 *     whose lead section starts at <h2>, use the default `as="h1"` so the page
 *     gains its missing document heading.
 *   - `<header>` landmark, the eyebrow is decorative-adjacent text (kept in the
 *     accessible name via the heading, not the eyebrow).
 *   - Gradient text keeps a solid brand-color fallback (via the same hue) so it
 *     never renders invisible if `background-clip:text` is unsupported.
 */

type HeroVariant = 'nepal' | 'japan' | 'plan' | 'map' | 'flights';

interface PageHeroProps {
  variant: HeroVariant;
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** Heading level for the title. Default 'h1'. Use 'h2' on pages that already own an <h1>. */
  as?: 'h1' | 'h2';
  /** Optional extra classes on the outer <header> (e.g. spacing overrides at mount). */
  className?: string;
}

/**
 * Per-variant treatment. `titleGradient` is a STATIC brand gradient (the page's
 * identity color, independent of scroll), while the eyebrow/accents key off the
 * live `--accent-scroll` var so they agree with the route-accent-engine at rest.
 * `wash` is a subtle full-panel tint layered under the glass fill to lean the
 * whole hero warm (nepal) / cool (japan) / neutral (plan, map).
 */
const VARIANTS: Record<
  HeroVariant,
  { titleGradient: string; wash: string }
> = {
  nepal: {
    titleGradient: 'text-gradient-himalaya',
    // himalaya 255,140,66 — warm wash
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(255,140,66,0.14) 0%, transparent 55%)',
  },
  japan: {
    titleGradient: 'text-gradient-sakura',
    // sakura 247,160,179 — cool wash
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(247,160,179,0.14) 0%, transparent 55%)',
  },
  plan: {
    titleGradient: 'text-gradient-gold',
    // gold 240,199,96 — neutral-premium wash
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(240,199,96,0.12) 0%, transparent 55%)',
  },
  map: {
    titleGradient: 'text-gradient-gold',
    // gold, more restrained (per spec: "slightly more restrained")
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(240,199,96,0.08) 0%, transparent 55%)',
  },
  flights: {
    // Reuses the neutral-premium gold treatment (same tier as 'plan') —
    // Flights has no country identity of its own, so a distinct wash isn't warranted.
    titleGradient: 'text-gradient-gold',
    wash: 'radial-gradient(120% 140% at 0% 0%, rgba(240,199,96,0.12) 0%, transparent 55%)',
  },
};

export default function PageHero({
  variant,
  title,
  eyebrow,
  subtitle,
  as = 'h1',
  className = '',
}: PageHeroProps) {
  const { titleGradient, wash } = VARIANTS[variant];
  const Heading = as;

  return (
    <header
      className={`px-gutter pt-24 pb-8 sm:pt-28 sm:pb-10 ${className}`}
    >
      <div
        className="glass-panel animate-reveal-up relative overflow-hidden mx-auto max-w-[1200px] px-6 py-8 sm:px-10 sm:py-12"
      >
        {/* Decorative brand wash — a tint layered over the glass fill. Absolutely
            positioned + pointer-events-none, adds no layout box (0-overflow safe). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: wash }}
        />

        <div className="relative">
          {eyebrow && (
            <p
              className="text-eyebrow uppercase mb-3"
              style={{ color: 'hsl(var(--accent-scroll))' }}
            >
              {eyebrow}
            </p>
          )}

          <Heading
            className={`font-display text-display-lg ${titleGradient}`}
          >
            {title}
          </Heading>

          {subtitle && (
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
