'use client';

import { useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { Star, Clock, MapPin, Camera } from 'lucide-react';
import { Recommendation } from '@/lib/nepal-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';

interface RecommendationSectionProps {
  id: string;
  title: string;
  titleGradient: string;
  subtitle: string;
  items: Recommendation[];
  categories: string[];
  accentColor: string;
  glassClass: string;
}

function RecommendationCard({ item, accentColor }: { item: Recommendation; accentColor: string }) {
  const [imgError, setImgError] = useState(false);
  const reduce = useReducedMotion();
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="glass-card rounded-2xl overflow-hidden group transition-[box-shadow,border-color] duration-300 hover:![box-shadow:var(--shadow-lg),var(--shadow-glow)] focus-within:![box-shadow:var(--shadow-lg),var(--shadow-glow)] hover:border-[hsl(var(--accent-scroll)/0.55)] focus-within:border-[hsl(var(--accent-scroll)/0.55)]"
    >
      {item.image && !imgError ? (
        <div className="relative aspect-[16/10] bg-navy-800 overflow-hidden motion-reduce:[&_img]:!transform-none">
          <OptimizedImage
            src={item.image}
            alt={item.name}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-900/80 to-transparent" />
          <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-black/40 backdrop-blur-sm">
            <Camera className="w-3 h-3 text-gold-400" />
            <span className="text-xs font-mono text-gold-400">{item.photoRating}/5</span>
          </div>
        </div>
      ) : (
        <div className="aspect-[16/10] bg-gradient-to-br from-navy-800 to-navy-700 flex items-center justify-center">
          <MapPin className={`w-8 h-8 ${accentColor} opacity-30`} />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h4 className="font-display font-bold text-white text-sm leading-tight">{item.name}</h4>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${accentColor} bg-white/5 whitespace-nowrap`}>{item.category}</span>
        </div>
        <p className="text-xs text-white/40 mb-3 line-clamp-2">{item.description}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-white/30">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.bestTime}</span>
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{item.duration}</span>
          <span className="flex items-center gap-1">
            {Array.from({ length: item.photoRating }).map((_, i) => (
              <Star key={i} className="w-2.5 h-2.5 fill-gold-400 text-gold-400" />
            ))}
          </span>
        </div>
        {item.notes && <p className="text-[11px] text-white/25 mt-2 italic">💡 {item.notes}</p>}
        {/* Add-to-plan affordance — additive; doesn't disturb the
            existing image/filtering/layout. Renders for both Nepal and Japan since
            both use this shared card. */}
        <AddToPlanButton source={item} sourceType="recommendation" accentColor={accentColor} />
      </div>
    </m.div>
  );
}

export default function RecommendationSection({
  id, title, titleGradient, subtitle, items, categories, accentColor, glassClass,
}: RecommendationSectionProps) {
  const [activeCategory, setActiveCategory] = useState('All');

  const filtered = activeCategory === 'All' ? items : items.filter((i) => i.category === activeCategory);

  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id={`${id}-heading`} className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            {title} <span className={titleGradient}>Guide</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">{subtitle}</p>
        </m.div>

        {/* Category Filter */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                activeCategory === cat
                  ? `${accentColor} bg-white/10 ring-1 ring-current/30`
                  : 'text-white/40 hover:bg-white/5 hover:text-white/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Cards Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((item) => (
            <RecommendationCard key={item.id} item={item} accentColor={accentColor} />
          ))}
        </div>
      </div>
    </section>
  );
}
