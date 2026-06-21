'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import {
  Landmark,
  UtensilsCrossed,
  Hotel,
  Camera,
  Bus,
  ShoppingBag,
  Sparkles,
  MapPin,
  X,
  type LucideIcon,
} from 'lucide-react';
import {
  MAP_MARKERS,
  MARKER_CATEGORIES,
  type MapMarker,
  type MarkerCategory,
} from '@/lib/map-data';
import { withBasePath } from '@/lib/utils';
import AddToPlanButton from '@/components/add-to-plan-button';

// Consistent marker palette keyed to the app's category vocabulary.
// Each entry carries the icon plus the Tailwind classes used for the pin, the
// category badge, and the active filter chip — kept together so a pin and its
// legend/filter stay visually in sync.
const CATEGORY_STYLES: Record<
  MarkerCategory,
  { icon: LucideIcon; pin: string; ring: string; badge: string; dot: string }
> = {
  Attraction: {
    icon: Landmark,
    pin: 'bg-gold-500 text-navy-900',
    ring: 'ring-gold-400/60',
    badge: 'bg-gold-500/20 text-gold-400 border-gold-500/30',
    dot: 'bg-gold-500',
  },
  Restaurant: {
    icon: UtensilsCrossed,
    pin: 'bg-himalaya-500 text-white',
    ring: 'ring-himalaya-400/60',
    badge: 'bg-himalaya-500/20 text-himalaya-400 border-himalaya-500/30',
    dot: 'bg-himalaya-500',
  },
  Hotel: {
    icon: Hotel,
    pin: 'bg-indigo-500 text-white',
    ring: 'ring-indigo-400/60',
    badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
    dot: 'bg-indigo-500',
  },
  'Photo Spot': {
    icon: Camera,
    pin: 'bg-purple-500 text-white',
    ring: 'ring-purple-400/60',
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    dot: 'bg-purple-500',
  },
  'Day Trip': {
    icon: Bus,
    pin: 'bg-cyan-500 text-navy-900',
    ring: 'ring-cyan-400/60',
    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    dot: 'bg-cyan-500',
  },
  Shopping: {
    icon: ShoppingBag,
    pin: 'bg-sakura-500 text-white',
    ring: 'ring-sakura-400/60',
    badge: 'bg-sakura-500/20 text-sakura-300 border-sakura-500/30',
    dot: 'bg-sakura-500',
  },
  Cultural: {
    icon: Sparkles,
    pin: 'bg-amber-500 text-navy-900',
    ring: 'ring-amber-400/60',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    dot: 'bg-amber-500',
  },
};

type FilterValue = MarkerCategory | 'All';

// Photo header for the selected-marker popup. Owns its own error state so a
// missing/broken bundled image silently collapses (popup shows text only).
function MarkerThumb({ src, alt }: { src: string; alt: string }) {
  const [imgError, setImgError] = useState(false);
  if (imgError) return null;
  return (
    <div className="relative -mx-4 -mt-4 sm:-mx-5 sm:-mt-5 mb-4 aspect-[16/9] overflow-hidden rounded-t-2xl bg-navy-800">
      <Image
        src={withBasePath(src)}
        alt={alt}
        fill
        className="object-cover"
        unoptimized
        onError={() => setImgError(true)}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-navy-900/80 to-transparent" />
    </div>
  );
}

interface CountryPanelProps {
  country: 'Nepal' | 'Japan';
  label: string;
  markers: MapMarker[];
  selectedId: string | null;
  onSelect: (marker: MapMarker) => void;
}

function CountryPanel({
  country,
  label,
  markers,
  selectedId,
  onSelect,
}: CountryPanelProps) {
  const isNepal = country === 'Nepal';
  // CSS/gradient "terrain" backdrop — no real map tiles, no external images.
  const surface = isNepal
    ? 'from-himalaya-600/25 via-navy-800/70 to-navy-900'
    : 'from-sakura-500/20 via-navy-800/70 to-navy-900';

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <MapPin
          className={`w-4 h-4 ${isNepal ? 'text-himalaya-400' : 'text-sakura-400'}`}
        />
        <h3 className="font-display font-bold text-white text-sm sm:text-base">
          {label}
        </h3>
        <span className="ml-auto text-[11px] font-mono text-white/30">
          {markers.length} {markers.length === 1 ? 'place' : 'places'}
        </span>
      </div>

      <div
        className={`relative w-full aspect-[4/3] rounded-2xl overflow-hidden border border-white/10 bg-gradient-to-br ${surface}`}
      >
        {/* Decorative SVG "terrain" — contour-like strokes for a map feel. */}
        <svg
          className="absolute inset-0 w-full h-full opacity-[0.18]"
          viewBox="0 0 100 75"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <pattern
              id={`grid-${country}`}
              width="10"
              height="10"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 10 0 L 0 0 0 10"
                fill="none"
                stroke="white"
                strokeWidth="0.3"
              />
            </pattern>
          </defs>
          <rect width="100" height="75" fill={`url(#grid-${country})`} />
          <path
            d="M0 55 Q 25 38 50 50 T 100 42"
            fill="none"
            stroke="white"
            strokeWidth="0.6"
          />
          <path
            d="M0 30 Q 30 48 55 35 T 100 28"
            fill="none"
            stroke="white"
            strokeWidth="0.6"
          />
          <path
            d="M0 68 Q 35 60 60 70 T 100 62"
            fill="none"
            stroke="white"
            strokeWidth="0.6"
          />
        </svg>

        {markers.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
            <MapPin className="w-6 h-6 text-white/20 mb-2" />
            <p className="text-xs text-white/40">
              No places match this filter in {country}.
            </p>
          </div>
        ) : (
          markers.map((marker) => {
            const style = CATEGORY_STYLES[marker.category];
            const Icon = style.icon;
            const active = marker.id === selectedId;
            return (
              <button
                key={marker.id}
                type="button"
                onClick={() => onSelect(marker)}
                aria-label={`${marker.name} — ${marker.category} in ${marker.area}`}
                aria-pressed={active}
                style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-full shadow-lg shadow-black/40 ring-2 ring-white/20 outline-none transition-transform duration-200 hover:scale-125 focus-visible:scale-125 focus-visible:ring-4 focus-visible:ring-white/80 ${
                  style.pin
                } ${active ? `scale-125 ring-4 ${style.ring} z-20` : 'z-10'}`}
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function MapSection() {
  const [filter, setFilter] = useState<FilterValue>('All');
  const [selected, setSelected] = useState<MapMarker | null>(null);

  const visibleMarkers = useMemo(
    () =>
      filter === 'All'
        ? MAP_MARKERS
        : MAP_MARKERS.filter((m) => m.category === filter),
    [filter],
  );

  const nepalMarkers = visibleMarkers.filter((m) => m.country === 'Nepal');
  const japanMarkers = visibleMarkers.filter((m) => m.country === 'Japan');

  const handleFilter = (value: FilterValue) => {
    setFilter(value);
    // If the currently open card was filtered out, close it so the popup never
    // points at a pin that's no longer rendered.
    setSelected((prev) =>
      prev && value !== 'All' && prev.category !== value ? null : prev,
    );
  };

  const handleSelect = (marker: MapMarker) => {
    setSelected((prev) => (prev?.id === marker.id ? null : marker));
  };

  const filters: FilterValue[] = ['All', ...MARKER_CATEGORIES];

  return (
    <section id="map" aria-labelledby="map-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="map-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Interactive <span className="text-gradient-gold">Map</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">
            A stylized look at where things sit across the Kathmandu Valley and
            Japan. Filter by category and tap any pin to see the details.
          </p>
        </motion.div>

        {/* Category filter chips — toggling visibly changes which pins render. */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {filters.map((value) => {
            const isActive = filter === value;
            const style =
              value === 'All' ? null : CATEGORY_STYLES[value as MarkerCategory];
            const Icon = style?.icon;
            return (
              <button
                key={value}
                type="button"
                onClick={() => handleFilter(value)}
                aria-pressed={isActive}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
                  isActive
                    ? value === 'All'
                      ? 'bg-white/10 text-white border-white/20'
                      : `${style!.badge}`
                    : 'text-white/40 border-transparent hover:bg-white/5 hover:text-white/60'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {value}
              </button>
            );
          })}
        </div>

        <div className="glass-card rounded-3xl p-4 sm:p-6">
          {/* Mock map surface — two regional panels stack on mobile. */}
          <div className="flex flex-col lg:flex-row gap-6">
            <CountryPanel
              country="Nepal"
              label="Nepal — Kathmandu Valley"
              markers={nepalMarkers}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
            />
            <CountryPanel
              country="Japan"
              label="Japan — Tokyo · Kyoto · Osaka"
              markers={japanMarkers}
              selectedId={selected?.id ?? null}
              onSelect={handleSelect}
            />
          </div>

          {/* Detail / popup card — updates as you click different pins. */}
          <AnimatePresence mode="wait">
            {selected && (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.2 }}
                className="glass-card-dark rounded-2xl p-4 sm:p-5 mt-6 relative"
              >
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close details"
                  className="absolute top-3 right-3 p-1 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  <X className="w-4 h-4" />
                </button>
                {selected.image && (
                  <MarkerThumb src={selected.image} alt={selected.name} />
                )}
                <div className="flex items-start gap-3 pr-8">
                  <div
                    className={`shrink-0 grid place-items-center w-10 h-10 rounded-xl ${CATEGORY_STYLES[selected.category].pin}`}
                  >
                    {(() => {
                      const Icon = CATEGORY_STYLES[selected.category].icon;
                      return <Icon className="w-5 h-5" strokeWidth={2.5} />;
                    })()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h4 className="font-display font-bold text-white text-base leading-tight">
                        {selected.name}
                      </h4>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${CATEGORY_STYLES[selected.category].badge}`}
                      >
                        {selected.category}
                      </span>
                    </div>
                    <p className="flex items-center gap-1 text-xs text-white/40 mb-2">
                      <MapPin className="w-3 h-3" />
                      {selected.area} · {selected.country}
                    </p>
                    <p className="text-sm text-white/60 leading-relaxed">
                      {selected.description}
                    </p>
                  </div>
                </div>

                {/* Add-to-plan affordance — additive; lives in the
                    selected-marker popup so the picked place is addable to a day. */}
                <AddToPlanButton
                  source={selected}
                  sourceType="map"
                  accentColor={selected.country === 'Nepal' ? 'text-himalaya-400' : 'text-sakura-400'}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Legend — color/icon → category. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-6 pt-5 border-t border-white/5">
            <span className="text-[11px] uppercase tracking-wider text-white/30 font-mono">
              Legend
            </span>
            {MARKER_CATEGORIES.map((cat) => {
              const style = CATEGORY_STYLES[cat];
              const Icon = style.icon;
              return (
                <span
                  key={cat}
                  className="flex items-center gap-1.5 text-xs text-white/50"
                >
                  <span
                    className={`grid place-items-center w-5 h-5 rounded-full ${style.pin}`}
                  >
                    <Icon className="w-3 h-3" strokeWidth={2.5} />
                  </span>
                  {cat}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
