'use client';

import { useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { Camera, Clock, MapPin, Sun, Moon, Aperture } from 'lucide-react';
import { PHOTO_SPOTS, PHOTO_CATEGORIES, PhotoSpot } from '@/lib/photography-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';

function PhotoCard({ spot }: { spot: PhotoSpot }) {
  const isNepal = spot.country === 'Nepal';
  const [imgError, setImgError] = useState(false);
  const reduce = useReducedMotion();
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className={`group rounded-2xl p-5 transition-[box-shadow,border-color] duration-300 hover:![box-shadow:var(--shadow-lg),var(--shadow-glow)] focus-within:![box-shadow:var(--shadow-lg),var(--shadow-glow)] hover:border-[hsl(var(--accent-scroll)/0.55)] focus-within:border-[hsl(var(--accent-scroll)/0.55)] ${
        isNepal ? 'glass-nepal' : 'glass-japan'
      }`}
    >
      {spot.image && !imgError && (
        <div className="relative -mx-5 -mt-5 mb-4 aspect-[16/10] overflow-hidden rounded-t-2xl bg-navy-800 motion-safe:group-hover:[&_img]:scale-105 [&_img]:transition-transform [&_img]:duration-500">
          <OptimizedImage
            src={spot.image}
            alt={`${spot.name}, ${spot.city}`}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-2 rounded-xl ${isNepal ? 'bg-himalaya-400/10' : 'bg-sakura-400/10'}`}>
            <Camera className={`w-4 h-4 ${isNepal ? 'text-himalaya-400' : 'text-sakura-400'}`} />
          </div>
          <div>
            <h4 className="font-display font-bold text-white text-sm">{spot.name}</h4>
            <p className="text-[11px] text-white/40">{spot.city}, {spot.country}</p>
          </div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${isNepal ? 'text-himalaya-400 bg-himalaya-400/10' : 'text-sakura-400 bg-sakura-400/10'}`}>
          {spot.category}
        </span>
      </div>

      <div className="space-y-2 text-xs">
        <div className="flex items-center gap-2 text-white/50">
          <Clock className="w-3.5 h-3.5 text-gold-400" />
          <span>{spot.bestTime}</span>
        </div>
        <div className="flex items-center gap-2 text-white/50">
          <Aperture className="w-3.5 h-3.5 text-purple-400" />
          <span>{spot.style}</span>
        </div>
        <div className="flex items-center gap-2 text-white/50">
          <Camera className="w-3.5 h-3.5 text-blue-400" />
          <span>{spot.gear}</span>
        </div>
      </div>

      <div className="mt-3 p-2.5 rounded-lg bg-white/5">
        <p className="text-[11px] text-white/40 italic">💡 {spot.tip}</p>
      </div>

      {/* Add-to-plan affordance — additive; reuses the shared control.
          accentColor matches the card's country theme. */}
      <AddToPlanButton
        source={spot}
        sourceType="photo"
        accentColor={isNepal ? 'text-himalaya-400' : 'text-sakura-400'}
      />
    </m.div>
  );
}

export default function PhotographyGuide() {
  const [activeCategory, setActiveCategory] = useState('All');
  const filtered = activeCategory === 'All' ? PHOTO_SPOTS : PHOTO_SPOTS.filter((s) => s.category === activeCategory);

  return (
    <section id="photography" aria-labelledby="photography-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="photography-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Photography <span className="text-gradient-gold">Guide</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">Capture the perfect shot at every destination with expert shooting tips and gear suggestions.</p>
        </m.div>

        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {PHOTO_CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                activeCategory === cat
                  ? 'text-gold-400 bg-gold-400/10 ring-1 ring-gold-400/30'
                  : 'text-white/40 hover:bg-white/5'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((spot) => (
            <PhotoCard key={spot.id} spot={spot} />
          ))}
        </div>
      </div>
    </section>
  );
}
