'use client';

import { useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { SectionHeading } from '@/components/section-heading';
import { Heart, Utensils, BookOpen, MapPin } from 'lucide-react';
import { FEATURED_DESTINATIONS, LOCAL_FOODS, ETIQUETTE_TIPS } from '@/lib/travel-tips-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';

/**
 * Country Essentials — the country-parameterized half of the old
 * `travel-inspiration.tsx` split: featured destinations, local foods, and
 * cultural etiquette, filtered to ONE country for the /nepal/ and /japan/ pages
 * (etiquette additionally includes the 'Both' tips). The Home half (weather
 * outlook) lives in `travel-essentials.tsx`.
 *
 * FeaturedCard / FoodCard moved here VERBATIM (shared micro-interaction recipe,
 * add-to-plan affordance on Featured only). All Tailwind classes stay
 * static whole-string literals.
 */

function FeaturedCard({ destination }: { destination: typeof FEATURED_DESTINATIONS[0] }) {
  const isNepal = destination.country === 'Nepal';
  const [imgError, setImgError] = useState(false);
  const reduce = useReducedMotion();
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={`group relative overflow-hidden rounded-2xl p-5 transition-[box-shadow,border-color] duration-300 hover:![box-shadow:var(--shadow-lg),var(--shadow-glow)] focus-within:![box-shadow:var(--shadow-lg),var(--shadow-glow)] hover:border-[hsl(var(--accent-scroll)/0.55)] focus-within:border-[hsl(var(--accent-scroll)/0.55)] ${
        isNepal ? 'glass-nepal' : 'glass-japan'
      }`}
    >
      {destination.image && !imgError && (
        <div className="relative -mx-5 -mt-5 mb-3 aspect-[16/9] overflow-hidden rounded-t-2xl bg-navy-800 motion-reduce:[&_img]:!transform-none">
          <OptimizedImage
            src={destination.image}
            alt={destination.name}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-900/80 to-transparent" />
        </div>
      )}
      <div
        className={`absolute -right-6 -top-6 h-24 w-24 rounded-full blur-2xl opacity-40 transition-opacity duration-300 group-hover:opacity-60 ${
          isNepal ? 'bg-himalaya-400/30' : 'bg-sakura-400/30'
        }`}
        aria-hidden="true"
      />
      <div className="relative">
        <span className="text-3xl">{destination.emoji}</span>
        <div className="mt-3 flex items-center gap-2">
          <h4 className="font-display font-bold text-white">{destination.name}</h4>
          <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${isNepal ? 'text-himalaya-400 bg-himalaya-400/10' : 'text-sakura-400 bg-sakura-400/10'}`}>
            <MapPin className="w-2.5 h-2.5" />
            {destination.country}
          </span>
        </div>
        <p className="mt-2 text-xs text-white/40 leading-relaxed">{destination.blurb}</p>
        {/* Add-to-plan affordance — additive; only Featured cards get
            it (not food/etiquette/weather). Featured has no id/category;
            the adapter derives sourceId from the name and uses 'sightseeing'. */}
        <AddToPlanButton
          source={destination}
          sourceType="featured"
          accentColor={isNepal ? 'text-himalaya-400' : 'text-sakura-400'}
        />
      </div>
    </m.div>
  );
}

function FoodCard({ food }: { food: typeof LOCAL_FOODS[0] }) {
  const isNepal = food.country === 'Nepal';
  const reduce = useReducedMotion();
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={reduce ? undefined : { y: -5 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={`group rounded-xl p-4 transition-[box-shadow,border-color] duration-300 hover:![box-shadow:var(--shadow-lg),var(--shadow-glow)] focus-within:![box-shadow:var(--shadow-lg),var(--shadow-glow)] hover:border-[hsl(var(--accent-scroll)/0.55)] focus-within:border-[hsl(var(--accent-scroll)/0.55)] ${
        isNepal ? 'glass-nepal' : 'glass-japan'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">{food.emoji}</span>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-display font-bold text-white text-sm">{food.name}</h4>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isNepal ? 'text-himalaya-400 bg-himalaya-400/10' : 'text-sakura-400 bg-sakura-400/10'}`}>
              {food.country}
            </span>
          </div>
          <p className="text-xs text-white/40 mt-1">{food.description}</p>
        </div>
      </div>
    </m.div>
  );
}

export default function CountryEssentials({ country }: { country: 'Nepal' | 'Japan' }) {
  const isNepal = country === 'Nepal';
  const featured = FEATURED_DESTINATIONS.filter((d) => d.country === country);
  const foods = LOCAL_FOODS.filter((f) => f.country === country);
  const etiquette = ETIQUETTE_TIPS.filter((t) => t.country === country || t.country === 'Both');

  return (
    <section id="essentials" aria-labelledby="essentials-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="essentials-heading"
          className="mb-12"
          title={<>{country}{' '}<span className={isNepal ? 'text-gradient-himalaya' : 'text-gradient-sakura'}>Essentials</span></>}
          subtitle={`Featured spots, local flavors, and cultural know-how for ${country}.`}
        />

        {/* Featured Destinations */}
        <div className="mb-12">
          <h3 className="font-display text-xl font-bold text-white mb-6 flex items-center gap-2 justify-center">
            <MapPin className="w-5 h-5 text-gold-400" /> Featured Destinations
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {featured.map((destination) => (
              <FeaturedCard key={destination.name} destination={destination} />
            ))}
          </div>
        </div>

        {/* Foods to Try */}
        <div className="mb-12">
          <h3 className="font-display text-xl font-bold text-white mb-6 flex items-center gap-2 justify-center">
            <Utensils className="w-5 h-5 text-gold-400" /> Local Foods to Try
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {foods.map((food) => (
              <FoodCard key={food.name} food={food} />
            ))}
          </div>
        </div>

        {/* Etiquette */}
        <div className="glass-card rounded-2xl p-5 max-w-3xl mx-auto">
          <h3 className="font-display text-lg font-bold text-white mb-4 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-gold-400" /> Cultural Etiquette
          </h3>
          <div className="space-y-3">
            {etiquette.map((tip) => (
              <div key={tip.title} className="flex items-start gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                <Heart className={`w-4 h-4 mt-0.5 shrink-0 ${
                  tip.country === 'Nepal' ? 'text-himalaya-400' : tip.country === 'Japan' ? 'text-sakura-400' : 'text-gold-400'
                }`} />
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-white">{tip.title}</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/30">{tip.country}</span>
                  </div>
                  <p className="text-xs text-white/40 mt-0.5">{tip.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
