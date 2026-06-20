'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music, Eye, EyeOff, MapPin, DollarSign, Calendar, Headphones } from 'lucide-react';
import { NIGHTLIFE_VENUES, NightlifeVenue } from '@/lib/nightlife-data';

const STORAGE_KEY = 'nightlife_section_visible';

function VenueCard({ venue }: { venue: NightlifeVenue }) {
  const isNepal = venue.country === 'Nepal';
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileHover={{ y: -4 }}
      className="rounded-2xl p-5 bg-gradient-to-br from-purple-900/20 to-fuchsia-900/20 border border-purple-500/10 hover:border-purple-500/20 hover:shadow-lg hover:shadow-purple-500/5 transition-all duration-300"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-xl bg-fuchsia-500/10">
            <Music className="w-4 h-4 text-fuchsia-400" />
          </div>
          <div>
            <h4 className="font-display font-bold text-white text-sm">{venue.name}</h4>
            <p className="text-[11px] text-white/40 flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {venue.location}
            </p>
          </div>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${isNepal ? 'text-himalaya-400 bg-himalaya-400/10' : 'text-sakura-400 bg-sakura-400/10'}`}>
          {venue.country}
        </span>
      </div>

      <p className="text-xs text-white/40 mb-3">{venue.description}</p>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-white/40">
          <Headphones className="w-3 h-3 text-purple-400" />
          <span>{venue.musicType}</span>
        </div>
        <div className="flex items-center gap-1.5 text-white/40">
          <DollarSign className="w-3 h-3 text-green-400" />
          <span>{venue.priceRange}</span>
        </div>
        <div className="flex items-center gap-1.5 text-white/40">
          <Music className="w-3 h-3 text-fuchsia-400" />
          <span>{venue.vibe}</span>
        </div>
        <div className="flex items-center gap-1.5 text-white/40">
          <Calendar className="w-3 h-3 text-gold-400" />
          <span>{venue.bestDays}</span>
        </div>
      </div>
    </motion.div>
  );
}

export default function NightlifeSection() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) setVisible(saved === 'true');
    } catch { /* ignore */ }
  }, []);

  const toggleVisible = () => {
    const next = !visible;
    setVisible(next);
    try { localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* ignore */ }
  };

  if (!mounted) return null;

  return (
    <section id="nightlife" aria-labelledby="nightlife-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="nightlife-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Nightlife <span className="text-gradient-sakura">& Bars</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto mb-4">
            Discover the best clubs, bars, and late-night experiences in Kathmandu and Tokyo.
          </p>
          <button
            onClick={toggleVisible}
            aria-expanded={visible}
            aria-controls="nightlife-content"
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
              visible
                ? 'bg-fuchsia-500/20 text-fuchsia-300 ring-1 ring-fuchsia-500/30 hover:bg-fuchsia-500/30'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'
            }`}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {visible ? 'Hide Nightlife Section' : 'Show Nightlife Section'}
          </button>
        </motion.div>

        <AnimatePresence>
          {visible && (
            <motion.div
              id="nightlife-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              {/* Nepal Nightlife */}
              <div className="mb-8">
                <h3 className="font-display text-lg font-bold text-himalaya-400 mb-4 flex items-center gap-2">
                  <Music className="w-5 h-5" /> Kathmandu Nightlife
                </h3>
                <div className="grid sm:grid-cols-2 gap-4">
                  {NIGHTLIFE_VENUES.filter((v) => v.country === 'Nepal').map((v) => (
                    <VenueCard key={v.id} venue={v} />
                  ))}
                </div>
              </div>

              {/* Japan Nightlife */}
              <div>
                <h3 className="font-display text-lg font-bold text-sakura-400 mb-4 flex items-center gap-2">
                  <Music className="w-5 h-5" /> Tokyo Nightlife
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {NIGHTLIFE_VENUES.filter((v) => v.country === 'Japan').map((v) => (
                    <VenueCard key={v.id} venue={v} />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
