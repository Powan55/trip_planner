'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { Thermometer, Cloud, Shirt, CheckCircle, Circle, AlertTriangle, Heart, Utensils, BookOpen, MapPin } from 'lucide-react';
import { FEATURED_DESTINATIONS, LOCAL_FOODS, ETIQUETTE_TIPS, PACKING_LIST, WEATHER_INFO } from '@/lib/travel-tips-data';
import { withBasePath } from '@/lib/utils';
import AddToPlanButton from '@/components/add-to-plan-button';

function FeaturedCard({ destination }: { destination: typeof FEATURED_DESTINATIONS[0] }) {
  const isNepal = destination.country === 'Nepal';
  const [imgError, setImgError] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -4 }}
      className={`group relative overflow-hidden rounded-2xl p-5 transition-all duration-300 ${
        isNepal ? 'glass-nepal' : 'glass-japan'
      }`}
    >
      {destination.image && !imgError && (
        <div className="relative -mx-5 -mt-5 mb-3 aspect-[16/9] overflow-hidden rounded-t-2xl bg-navy-800">
          <Image
            src={withBasePath(destination.image)}
            alt={destination.name}
            fill
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            unoptimized
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
            it (not food/etiquette/packing/weather). Featured has no id/category;
            the adapter derives sourceId from the name and uses 'sightseeing'. */}
        <AddToPlanButton
          source={destination}
          sourceType="featured"
          accentColor={isNepal ? 'text-himalaya-400' : 'text-sakura-400'}
        />
      </div>
    </motion.div>
  );
}

function FoodCard({ food }: { food: typeof LOCAL_FOODS[0] }) {
  const isNepal = food.country === 'Nepal';
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={{ y: -3 }}
      className={`rounded-xl p-4 transition-all duration-300 ${
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
    </motion.div>
  );
}

function PackingChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem('packing_checklist');
      if (saved) setChecked(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const toggle = (item: string) => {
    const next = { ...(checked ?? {}), [item]: !checked?.[item] };
    setChecked(next);
    try { localStorage.setItem('packing_checklist', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const categories = [...new Set(PACKING_LIST.map((p) => p.category))];
  const totalChecked = Object.values(checked ?? {}).filter(Boolean).length;

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
          <Shirt className="w-5 h-5 text-gold-400" /> Packing List
        </h3>
        <span className="text-xs text-white/40 font-mono">{totalChecked}/{PACKING_LIST.length}</span>
      </div>
      <div className="space-y-4">
        {categories.map((cat) => (
          <div key={cat}>
            <h4 className="text-xs font-medium text-white/30 uppercase tracking-wider mb-2">{cat}</h4>
            <div className="space-y-1">
              {PACKING_LIST.filter((p) => p.category === cat).map((p) => (
                <button
                  key={p.item}
                  onClick={() => toggle(p.item)}
                  aria-pressed={!!checked?.[p.item]}
                  aria-label={`${p.item}${p.essential ? ' (essential)' : ''}`}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                    checked?.[p.item] ? 'text-white/30 line-through' : 'text-white/70 hover:bg-white/5'
                  }`}
                >
                  {checked?.[p.item] ? (
                    <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-white/20 shrink-0" />
                  )}
                  <span className="flex-1">{p.item}</span>
                  {p.essential && !checked?.[p.item] && (
                    <AlertTriangle className="w-3.5 h-3.5 text-gold-400 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TravelInspiration() {
  return (
    <section id="inspiration" aria-labelledby="inspiration-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 id="inspiration-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Travel <span className="text-gradient-gold">Inspiration</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">Essential tips, local flavors, and packing essentials for the journey.</p>
        </motion.div>

        {/* Featured Destinations */}
        <div className="mb-12">
          <h3 className="font-display text-xl font-bold text-white mb-6 flex items-center gap-2 justify-center">
            <MapPin className="w-5 h-5 text-gold-400" /> Featured Destinations
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURED_DESTINATIONS.map((destination) => (
              <FeaturedCard key={destination.name} destination={destination} />
            ))}
          </div>
        </div>

        {/* Weather Section */}
        <div className="grid md:grid-cols-2 gap-5 mb-12">
          {[{ key: 'nepal' as const, label: 'Kathmandu, Nepal', data: WEATHER_INFO.nepal }, { key: 'japan' as const, label: 'Japan (Tokyo/Kyoto)', data: WEATHER_INFO.japan }].map(({ key, label, data }) => (
            <motion.div
              key={key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className={key === 'nepal' ? 'glass-nepal rounded-2xl p-5' : 'glass-japan rounded-2xl p-5'}
            >
              <div className="flex items-center gap-2 mb-3">
                <Cloud className={`w-5 h-5 ${key === 'nepal' ? 'text-himalaya-400' : 'text-sakura-400'}`} />
                <h3 className="font-display font-bold text-white">{label}</h3>
              </div>
              <div className="flex gap-4 mb-3">
                <div className="text-center">
                  <Thermometer className="w-4 h-4 text-red-400 mx-auto mb-1" />
                  <span className="text-lg font-mono font-bold text-white">{data.tempHigh}</span>
                  <p className="text-[10px] text-white/30">High</p>
                </div>
                <div className="text-center">
                  <Thermometer className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <span className="text-lg font-mono font-bold text-white">{data.tempLow}</span>
                  <p className="text-[10px] text-white/30">Low</p>
                </div>
              </div>
              <p className="text-xs text-white/40 mb-2">{data.description}</p>
              <p className="text-xs text-white/30 italic">🧥 {data.whatToWear}</p>
            </motion.div>
          ))}
        </div>

        {/* Foods to Try */}
        <div className="mb-12">
          <h3 className="font-display text-xl font-bold text-white mb-6 flex items-center gap-2 justify-center">
            <Utensils className="w-5 h-5 text-gold-400" /> Local Foods to Try
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {LOCAL_FOODS.map((food) => (
              <FoodCard key={food.name} food={food} />
            ))}
          </div>
        </div>

        {/* Etiquette + Packing */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Etiquette */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="font-display text-lg font-bold text-white mb-4 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-gold-400" /> Cultural Etiquette
            </h3>
            <div className="space-y-3">
              {ETIQUETTE_TIPS.map((tip) => (
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

          {/* Packing */}
          <PackingChecklist />
        </div>
      </div>
    </section>
  );
}
