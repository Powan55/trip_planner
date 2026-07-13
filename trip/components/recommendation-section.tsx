'use client';

import { useMemo, useRef, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { SectionHeading } from '@/components/section-heading';
import { Star, Clock, MapPin, Camera, Search, X, SlidersHorizontal, SearchX, Heart } from 'lucide-react';
import { Recommendation } from '@/lib/nepal-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';
import PlaceDetailSheet, { type PlaceDetailData } from '@/components/place-detail-sheet';
import { useFavorites } from '@/hooks/use-favorites';

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

type SortKey = 'rating' | 'name';

/**
 * Derive a display city from a Recommendation's free-text `location`. Locations read
 * like "Boudha, Kathmandu" or "Lalitpur" — the LAST comma segment is the city/town.
 * Undefined when the record has no location.
 */
function cityOf(loc: string | undefined): string | undefined {
  if (!loc) return undefined;
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : undefined;
}

function RecommendationCard({
  item,
  accentColor,
  onOpen,
  favorited,
  onToggleFavorite,
  favoritesReady,
}: {
  item: Recommendation;
  accentColor: string;
  onOpen: () => void;
  favorited: boolean;
  onToggleFavorite: () => void;
  /** Gate the favorite toggle's render on hook hydration (no SSR/first-paint mismatch). */
  favoritesReady: boolean;
}) {
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
      {/* The image + text (down to notes) is a single button that opens the detail
          sheet. The AddToPlanButton stays a sibling so it isn't nested in a button. */}
      <button
        type="button"
        onClick={onOpen}
        data-testid={`guide-card-${item.id}`}
        aria-label={`View details for ${item.name}`}
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded-2xl"
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
            {item.mustSee && (
              <span className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded-full bg-gold-500/90 text-navy-900 text-[10px] font-bold uppercase tracking-wide">
                <Star className="w-3 h-3 fill-navy-900" />
                Must-see
              </span>
            )}
          </div>
        ) : (
          <div className="aspect-[16/10] bg-gradient-to-br from-navy-800 to-navy-700 flex items-center justify-center relative">
            <MapPin className={`w-8 h-8 ${accentColor} opacity-30`} />
            {item.mustSee && (
              <span className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded-full bg-gold-500/90 text-navy-900 text-[10px] font-bold uppercase tracking-wide">
                <Star className="w-3 h-3 fill-navy-900" />
                Must-see
              </span>
            )}
          </div>
        )}
        <div className="p-4 pb-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-display font-bold text-white text-sm leading-tight">{item.name}</h3>
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
        </div>
      </button>
      <div className="px-4 pb-4 flex items-start gap-2">
        {/* Add-to-plan affordance — additive; a sibling of the details button. */}
        <div className="flex-1 min-w-0">
          <AddToPlanButton source={item} sourceType="recommendation" accentColor={accentColor} />
        </div>
        {/* Favorite/bookmark toggle — a sibling of AddToPlanButton, real <button>, and
            gated on the favorites hook's hydration so server/first-client-paint always match
            (starts unfavorited on both, avoiding a hydration mismatch). */}
        {favoritesReady && (
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-pressed={favorited}
            aria-label={favorited ? `Remove ${item.name} from saved` : `Save ${item.name}`}
            data-testid={`guide-favorite-${item.id}`}
            className={`mt-3 shrink-0 p-2 rounded-xl border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
              favorited
                ? 'bg-gold-500/15 border-gold-400/40 text-gold-300 hover:bg-gold-500/25'
                : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorited ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
    </m.div>
  );
}

export default function RecommendationSection({
  id, title, titleGradient, subtitle, items, categories, accentColor, glassClass,
}: RecommendationSectionProps) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeCity, setActiveCity] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('rating');
  const [savedOnly, setSavedOnly] = useState(false);
  const { favorites, toggle: toggleFavorite, hydrated: favoritesReady } = useFavorites();

  // How many of THIS section's items are favorited — the "Saved" chip only renders once this
  // is >= 1 (it cuts across categories, so it isn't folded into the `categories` chip row).
  const savedCount = useMemo(
    () => items.filter((i) => favorites.includes(i.id)).length,
    [items, favorites],
  );

  // Cities present in this data set (from location), sorted, with an "All" head.
  const cities = useMemo(() => {
    const set = new Set<string>();
    items.forEach((i) => {
      const c = cityOf(i.location);
      if (c) set.add(c);
    });
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  // Live counts per category and per city, computed over the OTHER active filters +
  // search so the numbers reflect what a chip would actually yield.
  const q = query.trim().toLowerCase();
  const matchesSearch = (i: Recommendation) =>
    !q ||
    i.name.toLowerCase().includes(q) ||
    i.description.toLowerCase().includes(q);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    categories.forEach((cat) => {
      counts[cat] = items.filter(
        (i) =>
          (cat === 'All' || i.category === cat) &&
          (activeCity === 'All' || cityOf(i.location) === activeCity) &&
          matchesSearch(i),
      ).length;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, categories, activeCity, q]);

  const cityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    cities.forEach((city) => {
      counts[city] = items.filter(
        (i) =>
          (city === 'All' || cityOf(i.location) === city) &&
          (activeCategory === 'All' || i.category === activeCategory) &&
          matchesSearch(i),
      ).length;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cities, activeCategory, q]);

  const filtered = useMemo(() => {
    const out = items.filter(
      (i) =>
        (activeCategory === 'All' || i.category === activeCategory) &&
        (activeCity === 'All' || cityOf(i.location) === activeCity) &&
        (!savedOnly || favorites.includes(i.id)) &&
        matchesSearch(i),
    );
    out.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.photoRating - a.photoRating || a.name.localeCompare(b.name),
    );
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, activeCategory, activeCity, q, sort, savedOnly, favorites]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<Recommendation | null>(null);
  // Parent-owned focus-return: capture the card trigger on open, refocus on
  // the sheet's exit-complete.
  const triggerRef = useRef<HTMLElement | null>(null);

  const openDetail = (item: Recommendation) => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setSelected(item);
    setDetailOpen(true);
  };

  const selectedDetail: PlaceDetailData | null = selected
    ? {
        id: selected.id,
        name: selected.name,
        category: selected.category,
        location: selected.location,
        country: id === 'nepal' ? 'Nepal' : 'Japan',
        image: selected.image,
        description: selected.description,
        longDescription: selected.longDescription,
        bestTime: selected.bestTime,
        duration: selected.duration,
        priceHint: selected.priceHint,
        rating: selected.photoRating,
        mustSee: selected.mustSee,
      }
    : null;

  const resetFilters = () => {
    setActiveCategory('All');
    setActiveCity('All');
    setQuery('');
    setSavedOnly(false);
  };

  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id={`${id}-heading`}
          className="mb-10"
          title={<>{title} <span className={titleGradient}>Guide</span></>}
          subtitle={subtitle}
        />

        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or description…"
              aria-label={`Search ${title} guide`}
              data-testid="guide-search-input"
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
            <label htmlFor={`${id}-sort`} className="sr-only">Sort</label>
            <select
              id={`${id}-sort`}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              data-testid="guide-sort-select"
              className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
            >
              <option value="rating" className="bg-navy-900">Sort: Top rated</option>
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
                data-testid={`guide-filter-city-${city.toLowerCase()}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                  activeCity === city
                    ? `${accentColor} bg-white/10 ring-1 ring-current/30`
                    : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                {city === 'All' ? 'All cities' : city}
                <span className="ml-1.5 text-white/50 font-mono">{cityCounts[city] ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {/* "Saved" filter chip — cuts across categories, so it's a separate boolean
            toggle rather than folded into the `categories` chip row. Only rendered once
            favorites have hydrated AND this section has >=1 favorited item. */}
        {favoritesReady && savedCount > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setSavedOnly((v) => !v)}
              aria-pressed={savedOnly}
              data-testid="guide-filter-saved"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                savedOnly
                  ? `${accentColor} bg-white/10 ring-1 ring-current/30`
                  : 'text-white/55 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              <Heart className={`w-3 h-3 ${savedOnly ? 'fill-current' : ''}`} />
              Saved
              <span className="ml-0.5 text-white/50 font-mono">{savedCount}</span>
            </button>
          </div>
        )}

        {/* Category filter chips with live counts */}
        <div className="flex flex-wrap justify-center gap-2 mb-8">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              aria-pressed={activeCategory === cat}
              data-testid={`guide-filter-category-${cat.toLowerCase()}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                activeCategory === cat
                  ? `${accentColor} bg-white/10 ring-1 ring-current/30`
                  : 'text-white/55 hover:bg-white/5 hover:text-white/80'
              }`}
            >
              {cat}
              <span className="ml-1.5 text-white/50 font-mono">{categoryCounts[cat] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Cards Grid or empty state */}
        {filtered.length > 0 ? (
          <div data-testid="guide-results" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((item) => (
              <RecommendationCard
                key={item.id}
                item={item}
                accentColor={accentColor}
                onOpen={() => openDetail(item)}
                favorited={favorites.includes(item.id)}
                onToggleFavorite={() => toggleFavorite(item.id)}
                favoritesReady={favoritesReady}
              />
            ))}
          </div>
        ) : (
          <div data-testid="guide-empty-state" className={`text-center py-16 px-6 rounded-2xl ${glassClass}`}>
            <SearchX className="w-10 h-10 mx-auto mb-4 text-white/20" />
            <p className="text-white/60 font-medium mb-1">No places match your filters</p>
            <p className="text-white/35 text-sm mb-5">Try a different search, city, or category.</p>
            <button
              type="button"
              onClick={resetFilters}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${accentColor}`}
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
        addSourceType={selected ? 'recommendation' : undefined}
      />
    </section>
  );
}
