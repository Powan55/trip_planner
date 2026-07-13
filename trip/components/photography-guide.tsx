'use client';

import { useMemo, useRef, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { SectionHeading } from '@/components/section-heading';
import { Camera, Clock, Aperture, Search, X, SlidersHorizontal, SearchX, Star } from 'lucide-react';
import { PHOTO_SPOTS, PHOTO_CATEGORIES, PhotoSpot } from '@/lib/photography-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';
import PlaceDetailSheet, { type PlaceDetailData } from '@/components/place-detail-sheet';

type SortKey = 'mustSee' | 'name';

function PhotoCard({ spot, onOpen }: { spot: PhotoSpot; onOpen: () => void }) {
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
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View details for ${spot.name}`}
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded-xl"
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
            {spot.mustSee && (
              <span className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded-full bg-gold-500/90 text-navy-900 text-[10px] font-bold uppercase tracking-wide">
                <Star className="w-3 h-3 fill-navy-900" />
                Must-see
              </span>
            )}
          </div>
        )}

        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-2 rounded-xl ${isNepal ? 'bg-himalaya-400/10' : 'bg-sakura-400/10'}`}>
              <Camera className={`w-4 h-4 ${isNepal ? 'text-himalaya-400' : 'text-sakura-400'}`} />
            </div>
            <div>
              <h3 className="font-display font-bold text-white text-sm flex items-center gap-1.5">
                {spot.name}
                {spot.mustSee && !spot.image && <Star className="w-3 h-3 fill-gold-400 text-gold-400" />}
              </h3>
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
      </button>

      {/* Add-to-plan affordance — additive; a sibling of the details button. */}
      <AddToPlanButton
        source={spot}
        sourceType="photo"
        accentColor={isNepal ? 'text-himalaya-400' : 'text-sakura-400'}
      />
    </m.div>
  );
}

/**
 * Optional `country` filter prop. No prop = every spot (whole-page
 * behavior); on the /nepal/ and /japan/ pages the guide shows only that country's
 * spots. Also includes city + category chips with live counts, a search box, sort, an
 * empty state, must-see badges, and a tap-to-open detail sheet. Category/city chips
 * derive from the country-filtered set so a page never renders a dead filter.
 */
export default function PhotographyGuide({ country }: { country?: 'Nepal' | 'Japan' }) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeCity, setActiveCity] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('mustSee');

  const spots = useMemo(
    () => (country ? PHOTO_SPOTS.filter((s) => s.country === country) : PHOTO_SPOTS),
    [country],
  );

  const categories = useMemo(
    () => PHOTO_CATEGORIES.filter((cat) => cat === 'All' || spots.some((s) => s.category === cat)),
    [spots],
  );

  const cities = useMemo(() => {
    const set = new Set<string>();
    spots.forEach((s) => set.add(s.city));
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [spots]);

  const q = query.trim().toLowerCase();
  const matchesSearch = (s: PhotoSpot) =>
    !q ||
    s.name.toLowerCase().includes(q) ||
    s.tip.toLowerCase().includes(q) ||
    s.style.toLowerCase().includes(q);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    categories.forEach((cat) => {
      counts[cat] = spots.filter(
        (s) =>
          (cat === 'All' || s.category === cat) &&
          (activeCity === 'All' || s.city === activeCity) &&
          matchesSearch(s),
      ).length;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, categories, activeCity, q]);

  const cityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    cities.forEach((city) => {
      counts[city] = spots.filter(
        (s) =>
          (city === 'All' || s.city === city) &&
          (activeCategory === 'All' || s.category === activeCategory) &&
          matchesSearch(s),
      ).length;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, cities, activeCategory, q]);

  const filtered = useMemo(() => {
    const out = spots.filter(
      (s) =>
        (activeCategory === 'All' || s.category === activeCategory) &&
        (activeCity === 'All' || s.city === activeCity) &&
        matchesSearch(s),
    );
    out.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      // must-see first, then name
      const am = a.mustSee ? 0 : 1;
      const bm = b.mustSee ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spots, activeCategory, activeCity, q, sort]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<PhotoSpot | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const openDetail = (spot: PhotoSpot) => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setSelected(spot);
    setDetailOpen(true);
  };

  const selectedDetail: PlaceDetailData | null = selected
    ? {
        id: selected.id,
        name: selected.name,
        category: selected.category,
        location: `${selected.city}, ${selected.country}`,
        country: selected.country,
        image: selected.image,
        description: selected.tip,
        longDescription: selected.longDescription,
        bestTime: selected.bestTime,
        priceHint: undefined,
        mustSee: selected.mustSee,
      }
    : null;

  const resetFilters = () => {
    setActiveCategory('All');
    setActiveCity('All');
    setQuery('');
  };

  return (
    <section id="photography" aria-labelledby="photography-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="photography-heading"
          className="mb-10"
          title={<>Photography <span className="text-gradient-gold">Guide</span></>}
          subtitle="Capture the perfect shot at every destination with expert shooting tips and gear suggestions."
        />

        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search spots, styles, tips…"
              aria-label="Search photography guide"
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-white/40 hover:text-white/70 hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SlidersHorizontal className="w-4 h-4 text-white/30" />
            <label htmlFor="photo-sort" className="sr-only">Sort</label>
            <select
              id="photo-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
            >
              <option value="mustSee" className="bg-navy-900">Sort: Must-see first</option>
              <option value="name" className="bg-navy-900">Sort: Name (A–Z)</option>
            </select>
          </div>
        </div>

        {/* City filter chips (only when more than one city is present) */}
        {cities.length > 2 && (
          <div className="flex flex-wrap justify-center gap-2 mb-3">
            {cities.map((city) => (
              <button
                key={city}
                onClick={() => setActiveCity(city)}
                aria-pressed={activeCity === city}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                  activeCity === city
                    ? 'text-gold-400 bg-gold-400/10 ring-1 ring-gold-400/30'
                    : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                {city === 'All' ? 'All cities' : city}
                <span className="ml-1.5 text-white/50 font-mono">{cityCounts[city] ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {/* Category filter chips with live counts */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                activeCategory === cat
                  ? 'text-gold-400 bg-gold-400/10 ring-1 ring-gold-400/30'
                  : 'text-white/55 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              {cat}
              <span className="ml-1.5 text-white/50 font-mono">{categoryCounts[cat] ?? 0}</span>
            </button>
          ))}
        </div>

        {filtered.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((spot) => (
              <PhotoCard key={spot.id} spot={spot} onOpen={() => openDetail(spot)} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 px-6 rounded-2xl glass-card">
            <SearchX className="w-10 h-10 mx-auto mb-4 text-white/20" />
            <p className="text-white/60 font-medium mb-1">No spots match your filters</p>
            <p className="text-white/35 text-sm mb-5">Try a different search, city, or category.</p>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-gold-400 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <PlaceDetailSheet
        open={detailOpen}
        place={selectedDetail}
        onClose={() => setDetailOpen(false)}
        onExitComplete={() => triggerRef.current?.focus?.()}
        addSource={selected ?? undefined}
        addSourceType={selected ? 'photo' : undefined}
      />
    </section>
  );
}
