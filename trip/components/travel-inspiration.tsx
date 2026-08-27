'use client';

import { MapPin } from 'lucide-react';
import OptimizedImage from '@/components/optimized-image';
import { INSPIRATION_HIGHLIGHTS, type InspirationHighlight } from '@/lib/inspiration-data';

/**
 * Travel Inspiration — Home's `#inspiration` section: a photo gallery of the moments
 * worth the flight, four per country, in trip order (Nepal, then Japan).
 *
 * It replaces the two-card December weather panel that had been standing in this slot.
 * That panel's data (`WEATHER_INFO` in `lib/travel-tips-data.ts`) is deliberately left in
 * place and untouched, and so is the live weather layer `lib/weather.ts` — which was
 * grepped before anything moved and has five other consumers (`home-bento`,
 * `today-panel`, `weather-card`, `calendar-planner`, Travel Mode's
 * `travel-essentials-card`) plus the validator's weather-known-city invariant. This
 * change swaps what the inspiration SLOT shows; it removes no weather from the app.
 *
 * The section KEEPS the legacy `inspiration` id and the `inspiration-heading` heading
 * id: every v1 section id is preserved, `/#inspiration` scrolls here via the legacy-hash
 * redirect, the sticky home nav observes `#inspiration`, and the command palette targets
 * it. Renaming either id is a breaking change to all four.
 *
 * Content lives in `lib/inspiration-data.ts` (one file, strict schema, validator case).
 * Imagery is drawn ENTIRELY from assets this repo already bundles and already credits in
 * `public/images/CREDITS.md` — nothing new was added and nothing is fetched remotely.
 *
 * A11y / motion:
 * - each card is an <article> with its own <h3>; the grid is plain document order, so
 *   keyboard and screen-reader traversal need no widget behaviour (there is none).
 * - every photo carries authored, descriptive alt text (never the headline again).
 * - there is no entrance, no hover lift and no image zoom, so there is nothing for
 *   `prefers-reduced-motion` to switch off and no forked initial state to get wrong.
 * - the raster failing to load falls back to the plate's own hollow frame at full size,
 *   so a broken image never leaves a hole.
 *
 * Tailwind classes stay static whole-string literals (a concatenated
 * `bg-${x}` is invisible to the compiler and silently ships colourless).
 */

function HighlightCard({ highlight, plate }: { highlight: InspirationHighlight; plate: number }) {
  const isNepal = highlight.country === 'Nepal';

  // NO ENTRANCE, NO LIFT, NO ZOOM, and that removes a defect rather than only a flourish.
  // The card used to fork `initial` on reduced motion because `whileInView` never fires for
  // a card still below the fold, so an un-forked entrance rested at its initial opacity
  // indefinitely for exactly the users who asked for less motion. Content is present when
  // you arrive, so there is no fork left to get wrong and nothing for reduced motion to
  // neutralise. Nothing inside a card is focusable either — it is a photograph and three
  // lines of text, not a control — so there is still no hover/focus affordance to owe.
  return (
    <article className="plate">
      {/* The plate frame is portrait at every width here — the gallery keeps each plate to a
          317-465px grid cell, and the recipe's landscape option leaves a caption row too
          short for the chip + title + blurb below it. A ONE-UP portrait plate grows with the
          viewport (851px tall at 639, taller than the phone holding it), so the cap stops
          that; from 640 up the cap is also what turns the wider cells landscape. `min-w-full`
          is load-bearing — a max-height on an aspect-ratio box transfers back through the ratio
          and shrinks the WIDTH too (611 -> 300 at 639), pulling the photo off the plate. */}
      <div className="frame max-h-[400px] min-w-full">
        <div className="fig">
          <OptimizedImage
            src={highlight.image}
            alt={highlight.alt}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
            fallback={
              // The plate's own empty frame: the shape stays at full size rather than
              // leaving a hole where a photograph failed.
              <div aria-hidden="true" className="empty-frame absolute inset-0" />
            }
          />
        </div>
        <div className="ramp" aria-hidden="true" />
        <div className="lay">
          <span className={`chip self-start ${isNepal ? 'chip--np' : 'chip--jp'}`}>
            <MapPin className="h-2.5 w-2.5" aria-hidden="true" />
            {highlight.country}
          </span>
          <h3 className="mt-1.5 text-t-lead font-semibold leading-snug text-ink-hi">
            {highlight.title}
          </h3>
          <p className="mt-1 text-t-sm leading-relaxed text-ink-mid">{highlight.blurb}</p>
        </div>
      </div>
      <div className="capline">
        <span className="pr tabular-nums">Plate {String(plate).padStart(2, '0')}</span>
        <span className="pr pr--lo">{highlight.country}</span>
        <span className="pr pr--lo">{highlight.when}</span>
      </div>
    </article>
  );
}

export default function TravelInspiration() {
  return (
    <section id="inspiration" aria-labelledby="inspiration-heading" className="py-20">
      <div className="mx-auto max-w-[1200px]">
        <div className="sec px-gut">
          <h2 id="inspiration-heading">Travel inspiration</h2>
          <span className="sub">
            {INSPIRATION_HIGHLIGHTS.length} plates · two countries
          </span>
        </div>

        <div className="grid gap-4 px-gut sm:grid-cols-2 lg:grid-cols-3">
          {INSPIRATION_HIGHLIGHTS.map((highlight, i) => (
            <HighlightCard key={highlight.id} highlight={highlight} plate={i + 1} />
          ))}
        </div>
      </div>
    </section>
  );
}
