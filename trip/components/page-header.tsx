/**
 * PageHeader — the Tier-3 TEXT masthead: the glass panel, the brand wash, an accent
 * eyebrow, the page's <h1>, and one line of description. Nothing else.
 *
 * WHY IT EXISTS. Eight routes (/checklist /packing /profile /recap /safety /settings
 * /share /trips) hand-copied this markup byte-for-byte, down to the class order, and
 * `2fddaf5` — "the retired gold survived the recolour on ten route headers" — is that
 * duplication having already cost one recolour bug. Eight copies is eight places for the
 * next one to hide.
 *
 * WHAT IT DELIBERATELY IS NOT: `page-hero.tsx`. PageHero's `HeroVariant` union is closed
 * and photographic, and widening it for these routes would buy a longer enum plus a
 * Tier-2 photo code path none of them ever take. Photographic routes take PageHero;
 * text-only routes take this. Do not merge them.
 *
 * THE ACCENT IS A PROP so the NEXT recolour edits one default instead of finding eight
 * copies — that is the whole point of the file. It defaults to the chrome accent, which
 * is a token from globals.css and never a literal colour (PageHero's rule, and this file
 * obeys it too), and it is an inline style because a colour resolved at runtime cannot be
 * a Tailwind class. No caller overrides it yet; the seam is the deliverable.
 *
 * SERVER COMPONENT. No hooks, no state, no `'use client'` — all eight callers are Server
 * Components that export `metadata`, and this must not move that boundary.
 */

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  /** Set only when something outside this header names the <h1> via `aria-labelledby`. */
  titleId?: string;
  /** A token from globals.css. Never a literal colour. */
  accent?: string;
  /** The one-shot panel entrance. False only where a route shipped without it. */
  reveal?: boolean;
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  titleId,
  accent = 'hsl(var(--accent-scroll))',
  reveal = true,
}: PageHeaderProps) {
  return (
    <header className="px-gutter pt-24 pb-8 sm:pt-28 sm:pb-10">
      <div
        className={`glass-panel ${reveal ? 'animate-reveal-up ' : ''}relative mx-auto max-w-[1200px] overflow-hidden px-6 py-8 sm:px-10 sm:py-12`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--hero-wash)' }}
        />
        <div className="relative">
          <p className="text-eyebrow mb-3 uppercase" style={{ color: accent }}>
            {eyebrow}
          </p>
          <h1 id={titleId} className="text-display-lg text-display-emphasis">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </header>
  );
}
