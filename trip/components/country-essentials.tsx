'use client';

import { useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { SectionHeading } from '@/components/section-heading';
import { Heart, Utensils, BookOpen, MapPin } from 'lucide-react';
import { FEATURED_DESTINATIONS, LOCAL_FOODS, ETIQUETTE_TIPS } from '@/lib/travel-tips-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';

/**
 * Country Essentials — the country-parameterized half of the v1
 * inspiration split: featured destinations, local foods, and cultural etiquette,
 * filtered to ONE country for the /nepal/ and /japan/ pages (etiquette
 * additionally includes the 'Both' tips). Home's own `#inspiration` slot is the
 * photo gallery in `travel-inspiration.tsx`; the two are separate content
 * domains (`FEATURED_DESTINATIONS` here, `INSPIRATION_HIGHLIGHTS` there).
 *
 * FeaturedCard / FoodCard moved here VERBATIM ( micro-interaction recipe,
 * add-to-plan affordance on Featured only). All Tailwind classes stay
 * static whole-string literals.
 */

function FeaturedCard({ destination }: { destination: typeof FEATURED_DESTINATIONS[0] }) {
  const isNepal = destination.country === 'Nepal';
  const [imgError, setImgError] = useState(false);
  const reduce = useReducedMotion();
  return (
    // No entrance and no scroll-reveal: the card is present when you arrive.
    <m.div
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      data-leg={isNepal ? 'nepal' : 'japan'}
      className="plate group relative overflow-hidden rounded-r1 p-gut border-hair border-[color:hsl(var(--border))] transition-colors duration-300 hover:border-[color:var(--border-ui)] focus-within:border-[color:var(--border-ui)]"
    >
      {/* The ratio lives on the frame as `--plate-ar`, which is what the recipe reads, and
          the grid is what gives the ramp a row to span. */}
      {destination.image && !imgError && (
        <div className="frame [--plate-ar:16_/_9] -mx-gut -mt-gut mb-3">
          <div className="fig bg-surface-raised motion-reduce:[&_img]:!transform-none">
            <OptimizedImage
              src={destination.image}
              alt={destination.name}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-500 group-hover:scale-105"
              onError={() => setImgError(true)}
            />
          </div>
          <div className="ramp" aria-hidden="true" />
        </div>
      )}
      <div className="relative">
        <span className="text-n-sm" aria-hidden="true">{destination.emoji}</span>
        <div className="mt-3 flex items-center gap-2">
          <h4 className="text-t-body font-semibold text-ink-hi">{destination.name}</h4>
          <span className="chip border-[color:var(--now)] text-now">
            <MapPin className="w-2.5 h-2.5" aria-hidden="true" />
            {destination.country}
          </span>
        </div>
        <p className="mt-2 text-t-sm text-ink-mid leading-relaxed">{destination.blurb}</p>
        {/* Add-to-plan affordance — additive; only Featured cards get
            it (not food/etiquette/weather). Featured has no id/category;
            the adapter derives sourceId from the name and uses 'sightseeing'. */}
        <AddToPlanButton source={destination} sourceType="featured" accentColor="text-now" />
      </div>
    </m.div>
  );
}

function FoodCard({ food }: { food: typeof LOCAL_FOODS[0] }) {
  const isNepal = food.country === 'Nepal';
  const reduce = useReducedMotion();
  return (
    <m.div
      whileHover={reduce ? undefined : { y: -5 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      data-leg={isNepal ? 'nepal' : 'japan'}
      className="group rounded-r1 p-gut border-hair border-[color:hsl(var(--border))] bg-surface-low transition-colors duration-300 hover:border-[color:var(--border-ui)] focus-within:border-[color:var(--border-ui)]"
    >
      <div className="flex items-start gap-3">
        <span className="text-n-sm" aria-hidden="true">{food.emoji}</span>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="text-t-body font-semibold text-ink-hi">{food.name}</h4>
            <span className="chip border-[color:var(--now)] text-now">{food.country}</span>
          </div>
          <p className="text-t-sm text-ink-mid mt-1">{food.description}</p>
        </div>
      </div>
    </m.div>
  );
}

export default function CountryEssentials({ country }: { country: 'Nepal' | 'Japan' }) {
  const featured = FEATURED_DESTINATIONS.filter((d) => d.country === country);
  const foods = LOCAL_FOODS.filter((f) => f.country === country);
  const etiquette = ETIQUETTE_TIPS.filter((t) => t.country === country || t.country === 'Both');

  return (
    <section id="essentials" aria-labelledby="essentials-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="essentials-heading"
          className="mb-12"
          title={`${country} Essentials`}
          subtitle={`Featured spots, local flavors, and cultural know-how for ${country}.`}
        />

        {/* Featured Destinations */}
        <div className="mb-12">
          <h3 className="pr pr--l text-ink-hi mb-6 flex items-center gap-2 justify-center">
            <MapPin className="w-4 h-4 text-ink-lo" aria-hidden="true" /> Featured Destinations
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featured.map((destination) => (
              <FeaturedCard key={destination.name} destination={destination} />
            ))}
          </div>
        </div>

        {/* Foods to Try */}
        <div className="mb-12">
          <h3 className="pr pr--l text-ink-hi mb-6 flex items-center gap-2 justify-center">
            <Utensils className="w-4 h-4 text-ink-lo" aria-hidden="true" /> Local Foods to Try
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {foods.map((food) => (
              <FoodCard key={food.name} food={food} />
            ))}
          </div>
        </div>

        {/* Etiquette */}
        {/* A ruled list, not a card of cards: a row is a border-bottom and text. A tip
            that applies to BOTH legs takes the neutral rule rather than a third colour. */}
        <div className="max-w-3xl mx-auto rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low">
          <h3 className="pr pr--l text-ink-hi p-gut py-3 flex items-center gap-2 border-b-2 border-[color:hsl(var(--border))]">
            <BookOpen className="w-4 h-4 text-ink-lo" aria-hidden="true" /> Cultural Etiquette
          </h3>
          <div className="list">
            {etiquette.map((tip) => (
              <div
                key={tip.title}
                data-leg={tip.country === 'Japan' ? 'japan' : 'nepal'}
                className="r [--lead:auto]"
              >
                <Heart
                  className={`w-4 h-4 mt-0.5 shrink-0 ${tip.country === 'Both' ? 'text-ink-lo' : 'text-now'}`}
                  aria-hidden="true"
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-t-body font-semibold text-ink-hi">{tip.title}</h4>
                    <span className="chip">{tip.country}</span>
                  </div>
                  <p className="text-t-sm text-ink-mid mt-0.5">{tip.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
