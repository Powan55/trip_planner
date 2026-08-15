'use client';

import { m, useReducedMotion } from 'framer-motion';
import { MapPin } from 'lucide-react';
import { SectionHeading } from '@/components/section-heading';
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
 * - hover lift and the image zoom are suppressed under `prefers-reduced-motion` (the
 *   `useReducedMotion` guard plus the `motion-reduce:` transform reset on the frame).
 * - the raster failing to load falls back to the card's country gradient, so a broken
 *   image never leaves a hole.
 *
 * Tailwind classes stay static whole-string literals (a concatenated
 * `bg-${x}` is invisible to the compiler and silently ships colourless).
 */

function HighlightCard({ highlight }: { highlight: InspirationHighlight }) {
  const isNepal = highlight.country === 'Nepal';
  const reduce = useReducedMotion();

  // `initial` FORKS on reduced motion, and that is not decoration. The app-wide
  // `<MotionConfig reducedMotion="user">` neutralises the `y` TRANSFORM but does NOT hold
  // opacity at 1, and `whileInView` never fires for a card still below the fold — so an
  // un-forked entrance rests at its initial opacity indefinitely for exactly the users who
  // asked for less motion. `components/reveal.tsx` measured that and documents it; same rule.
  //
  // There is deliberately no `focus-within:` twin of the hover treatment: nothing inside a
  // card is focusable (it is a picture and three lines of text, not a control), so a focus
  // ring here would advertise an interaction that does not exist.
  return (
    <m.article
      initial={reduce ? { opacity: 1 } : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={`group relative flex flex-col overflow-hidden rounded-2xl transition-[box-shadow,border-color] duration-300 hover:![box-shadow:var(--shadow-lg),var(--shadow-glow)] hover:border-[hsl(var(--accent-scroll)/0.55)] ${
        isNepal ? 'glass-nepal' : 'glass-japan'
      }`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-raised motion-reduce:[&_img]:!transform-none">
        <OptimizedImage
          src={highlight.image}
          alt={highlight.alt}
          fill
          sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
          fallback={
            <div
              aria-hidden="true"
              className={`absolute inset-0 ${
                isNepal
                  ? 'bg-gradient-to-br from-himalaya-400/30 to-himalaya-600/10'
                  : 'bg-gradient-to-br from-sakura-300/30 to-sakura-500/10'
              }`}
            />
          }
        />
        {/* Scrim so the card body reads as one surface with the photo above it. */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-surface/80 to-transparent"
        />
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-white/60">
            {highlight.when}
          </p>
          <span
            className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ${
              isNepal
                ? 'bg-himalaya-400/10 text-himalaya-400'
                : 'bg-sakura-400/10 text-sakura-400'
            }`}
          >
            <MapPin className="h-2.5 w-2.5" aria-hidden="true" />
            {highlight.country}
          </span>
        </div>
        <h3 className="mt-2 font-display font-bold text-white">{highlight.title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-white/60">{highlight.blurb}</p>
      </div>
    </m.article>
  );
}

export default function TravelInspiration() {
  return (
    <section id="inspiration" aria-labelledby="inspiration-heading" className="px-4 py-20 sm:px-6">
      <div className="mx-auto max-w-[1200px]">
        <SectionHeading
          id="inspiration-heading"
          className="mb-12"
          title={
            <>
              Travel <span className="text-display-emphasis">Inspiration</span>
            </>
          }
          subtitle="Thirty-two days across two countries — the moments worth the flight."
        />

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {INSPIRATION_HIGHLIGHTS.map((highlight) => (
            <HighlightCard key={highlight.id} highlight={highlight} />
          ))}
        </div>
      </div>
    </section>
  );
}
