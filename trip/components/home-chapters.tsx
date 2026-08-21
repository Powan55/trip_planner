'use client';

import { type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import OptimizedImage from '@/components/optimized-image';
import { SectionHeading } from '@/components/section-heading';
import { entranceFor } from '@/lib/motion';

/**
 * Home's numbered chapters (issue #92) — `01` Nepal / `02` Japan as full-bleed photographic
 * bands, giving Home the editorial spine the front door already has.
 *
 * A PORT, NOT A NEW TREATMENT. The band is `.photo-header` (globals.css) used element for
 * element the way `components/landing-page.tsx` uses it: same media stack, same duotone
 * pair, same two-ramp scrim, same 92px-padding/68px-ramp contract that makes "every text
 * pixel lands at floor alpha >= .62" a measured number rather than a layout hope. That is
 * also why this section adds ZERO rows to `scripts/contrast-tokens.mjs`: the composites it
 * puts text on are `npHdrMin` / `jpHdrMin`, which are already measured there, and the
 * foregrounds are the same four the front door's chapters already pin — the marigold and
 * pink numerals at the 3:1 large-text bar, the title at --text-hi and the eyebrow/body at
 * --text-mid at 4.5:1. Reaching for a different treatment here would mean measuring a new
 * composite; that is the signal to come back to the port.
 *
 * --text-lo IS NOT USED. It does not clear AA over the hero photograph and it is not spent
 * on a photograph anywhere on this surface.
 *
 * NO AMBIENT MOTION. `.photo-header` carries none by design and none is added: the surface's
 * one loop allowance (D-293 R1/R2) is not spent here. The only animation is the one-shot
 * `.animate-reveal-up` entrance on each text block, claimed through `entranceFor()` (D-293
 * R7), which rests at opacity 1 and is collapsed by the reduced-motion block in globals.css.
 *
 * The band sits BELOW `section#hero`, outside the hero's `min-h-[100svh]` column, so it
 * costs the D-311 fold budget nothing.
 */

/**
 * `focus` is the crop knob `.photo-header__media img` reads. A full-bleed band is a much
 * wider crop than either source and each puts its subject somewhere different, so it is
 * per-photograph and not a constant. Both values are carried over from the front door's
 * chapters, where they were set against these exact rasters.
 */
const CHAPTERS = [
  {
    no: '01',
    country: 'np',
    accent: 'var(--marigold)',
    src: '/images/nepal/na2.jpg',
    focus: 'center 42%',
    eyebrow: 'Leg one',
    title: 'Nepal',
    body: 'Kathmandu valley mornings, momo stops, and the long drive out to the foothills.',
  },
  {
    no: '02',
    country: 'jp',
    accent: 'var(--pink)',
    src: '/images/map/jp-fushimi.jpg',
    focus: 'center 50%',
    eyebrow: 'Leg two',
    title: 'Japan',
    body: 'New Year in the cities, early trains, and a fortnight of cold, bright light.',
  },
] as const;

export default function HomeChapters() {
  // `.animate-reveal-up` rests at opacity 1 (the keyframe supplies the entrance FROM 0), so
  // the 'present' branch is simply the class left off — nothing can be stranded half-drawn.
  const reveal = entranceFor(usePathname()) === 'animate' ? 'animate-reveal-up' : '';

  return (
    <section
      id="chapters"
      aria-labelledby="chapters-heading"
      data-testid="home-chapters"
      className="bg-surface py-10 sm:py-14"
    >
      <SectionHeading
        id="chapters-heading"
        className="mb-8 px-4 sm:px-6"
        title={
          <>
            Two <span className="text-display-emphasis">chapters</span>
          </>
        }
        subtitle="One trip, two countries — and a different kind of cold in each."
      />
      {/* Full-bleed, radius 0: these touch the viewport edge, so there is nothing to round.
          A 1px gap over the border fill draws the divider between them at sm and up — the
          "border" is the background showing through, so no edge can drift from the surface
          it sits on. */}
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
        {CHAPTERS.map(({ no, country, accent, src, focus, eyebrow, title, body }) => (
          <div
            key={no}
            className="photo-header"
            data-country={country}
            data-testid={`home-chapter-${country}`}
            style={{ ['--photo-focus']: focus } as CSSProperties}
          >
            <div className="photo-header__media" aria-hidden="true">
              <OptimizedImage src={src} alt="" fill sizes="(min-width: 640px) 50vw, 100vw" />
              <span className="photo-header__duo-lo" />
              <span className="photo-header__duo-hi" />
              <span className="photo-header__scrim" />
            </div>
            <div className="photo-header__body">
              <div className={`px-gutter ${reveal}`}>
                <p className="text-eyebrow uppercase text-ink-mid">{eyebrow}</p>
                {/* The numeral is the chapter's identity mark, carries nothing the title
                    beside it does not, and is large display text — so it is hidden from
                    assistive tech rather than read out as a stray number, and its bar is
                    1.4.3's 3:1 rather than 4.5:1. */}
                <p
                  aria-hidden="true"
                  className="mt-1 font-display text-editorial-lg leading-none"
                  style={{ color: accent }}
                >
                  {no}
                </p>
                <h3 className="text-display-lg text-ink-hi">{title}</h3>
                <p className="mt-2 max-w-[42ch] text-sm leading-relaxed text-ink-mid">{body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
