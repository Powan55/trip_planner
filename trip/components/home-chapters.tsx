'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import OptimizedImage from '@/components/optimized-image';
import { formatDate } from '@/core/dates';
import { journeyLegs } from '@/lib/journey-legs';
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
    legId: 'nepal',
    accent: 'var(--marigold)',
    src: '/images/nepal/na2.jpg',
    /* Whole static class strings, never a template: a concatenated `object-[${x}]` is
       invisible to the compiler and ships with no rule at all. */
    focus: 'object-[center_42%]',
    eyebrow: 'Leg one',
    title: 'Nepal',
    body: 'Kathmandu valley mornings, momo stops, and the long drive out to the foothills.',
  },
  {
    no: '02',
    country: 'jp',
    legId: 'japan',
    accent: 'var(--pink)',
    src: '/images/map/jp-fushimi.jpg',
    focus: 'object-[center_50%]',
    eyebrow: 'Leg two',
    title: 'Japan',
    body: 'New Year in the cities, early trains, and a fortnight of cold, bright light.',
  },
] as const;

export default function HomeChapters() {
  // `.animate-reveal-up` rests at opacity 1 (the keyframe supplies the entrance FROM 0), so
  // the 'present' branch is simply the class left off — nothing can be stranded half-drawn.
  const reveal = entranceFor(usePathname()) === 'animate' ? 'animate-reveal-up' : '';
  const legs = useMemo(journeyLegs, []);

  return (
    <section
      id="chapters"
      aria-labelledby="chapters-heading"
      data-testid="home-chapters"
      className="bg-surface py-10 sm:py-14"
    >
      <div className="sec mx-auto max-w-[1200px] px-gut">
        <h2 id="chapters-heading">Two chapters</h2>
        <span className="sub">One trip · two countries</span>
      </div>
      {/* Full-bleed, radius 0: these touch the viewport edge, so there is nothing to round.
          A 1px gap over the border fill draws the divider between them at sm and up — the
          "border" is the background showing through, so no edge can drift from the surface
          it sits on. */}
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2">
        {CHAPTERS.map(({ no, country, legId, accent, src, focus, eyebrow, title, body }) => {
          const leg = legs.find((l) => l.id === legId);
          return (
            <div
              key={no}
              className="plate plate--band"
              data-country={country}
              data-testid={`home-chapter-${country}`}
            >
              {/* THE BAND HEIGHT IS THE ONE THIS SECTION ALREADY SHIPPED, not the recipe's
                  3/4 portrait: `CHAPTERS_H` in app/page.tsx is a measured reservation and a
                  taller frame would under-reserve it. A DEFINITE height is also what makes
                  the frame's percentage rows resolve at all — against an auto height those
                  percentages are indefinite and the ramp's legibility line moves.
                  `plate--band` on the article is what clears the recipe's aspect-ratio. An
                  `aspect-auto` utility HERE was inert (0,1,0 under a 0,2,0 recipe) and the
                  ratio then drove the WIDTH instead of the height, because a block box with
                  a definite height and `width:auto` takes its width from the ratio: 270px
                  inside a 320px full-bleed band, and 966px inside a 512px column, which is
                  where Home's horizontal scrollbar came from. */}
              <div className="frame h-[clamp(300px,40svh,380px)] min-[900px]:h-[clamp(360px,46svh,460px)]">
                <div className="fig">
                  <OptimizedImage
                    src={src}
                    alt=""
                    fill
                    sizes="(min-width: 640px) 50vw, 100vw"
                    className={`object-cover ${focus}`}
                  />
                </div>
                <div className="ramp" aria-hidden="true" />
                <div className="lay">
                  <div className={reveal}>
                    <p className="pr">{eyebrow}</p>
                    {/* The numeral is the chapter's identity mark, carries nothing the title
                        beside it does not, and is large display text — so it is hidden from
                        assistive tech rather than read out as a stray number, and its bar is
                        1.4.3's 3:1 rather than 4.5:1. --marigold and --pink are the measured
                        pair for the npHdrMin / jpHdrMin composites; do not swap them for the
                        -a stops, which sit lower. */}
                    <p
                      aria-hidden="true"
                      className="mt-1 font-display text-editorial-lg leading-none"
                      style={{ color: accent }}
                    >
                      {no}
                    </p>
                    <h3 className="text-display-lg text-ink-hi">{title}</h3>
                    <p className="mt-2 max-w-[42ch] text-t-sm leading-relaxed text-ink-mid">{body}</p>
                  </div>
                </div>
              </div>
              {/* The caption is a ruled line BENEATH the plate, never over it, and every
                  field on it is read from the trip's own legs rather than written here. */}
              <div className="capline">
                <span className="pr">Plate {no}</span>
                <span className="pr pr--lo">{title}</span>
                {leg && (
                  <>
                    <span className="pr pr--lo">
                      {formatDate(leg.start)} &ndash; {formatDate(leg.end)}
                    </span>
                    <span className="pr pr--lo tabular-nums">
                      {leg.days} days · {leg.cities.length} cities
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
