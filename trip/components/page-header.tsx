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
 * SERVER COMPONENT. No hooks, no state, no `'use client'` — the callers are Server Components
 * that export `metadata`, and this must not move that boundary. `/packing` is the one exception
 * and it does not move it either: `packing-header.tsx` is a client wrapper that only picks which
 * strings to pass, the way `plan-hero.tsx` wraps PageHero.
 */

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  /** Set only when something outside this header names the <h1> via `aria-labelledby`. */
  titleId?: string;
  /** A token from globals.css. Never a literal colour. */
  accent?: string;
  /**
   * The one-shot panel entrance. Accepted and IGNORED: there are no entrances on the calm
   * working screens any more. Kept in the signature because eight route files pass it and
   * a prop-signature change breaks them silently.
   */
  reveal?: boolean;
  /**
   * Extra classes on the masthead PANEL — the bordered box, not the outer <header>, because
   * the panel is what carries the width. Merged with `cn`, so a caller's `max-w-*` replaces
   * the 1200px default instead of stacking with it; each route passes the width of the body
   * below it so the two edges line up.
   */
  className?: string;
}

export default function PageHeader({
  eyebrow,
  title,
  description,
  titleId,
  accent = 'hsl(var(--accent-scroll))',
  className,
}: PageHeaderProps) {
  return (
    <header className="px-gutter pt-24 pb-8 sm:pt-28 sm:pb-10">
      {/* Printed stock, not glass, and no entrance — content is present when you arrive.
          `reveal` is kept in the props because eight route files pass it and this bundle
          does not change a public signature; it now selects nothing, which is the honest
          state until those callers are swept. */}
      <div
        className={cn(
          'relative mx-auto max-w-[1200px] overflow-hidden border-2 border-[hsl(var(--border))] bg-[rgb(var(--surface-low))] rounded-r1 px-6 py-8 sm:px-10 sm:py-12',
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'var(--hero-wash)' }}
        />
        <div className="relative">
          <p className="pr mb-3" style={{ color: accent }}>
            {eyebrow}
          </p>
          <h1 id={titleId} className="text-display-lg text-[color:var(--text-hi)]">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-t-lead text-[color:var(--text-mid)]">
            {description}
          </p>
        </div>
      </div>
    </header>
  );
}
