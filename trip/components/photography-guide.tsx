'use client';

import { useMemo, useRef, useState } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import { SectionHeading } from '@/components/section-heading';
import { Camera, Clock, Aperture, Search, X, SlidersHorizontal, SearchX, Star } from 'lucide-react';
import { PHOTO_SPOTS, PHOTO_CATEGORIES, PhotoSpot } from '@/lib/photography-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';
import AddedBadge from '@/components/added-badge';
import PlaceDetailSheet, { type PlaceDetailData } from '@/components/place-detail-sheet';
import { useItineraryContext } from '@/components/itinerary-provider';

type SortKey = 'mustSee' | 'name';

// Shared control shapes. A facet chip is `.chip`: STRUCK when it is on, a plain rule when
// it is off — the mark carries the state, so no --accent fill is spent on a filter.
const CTRL =
  'rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low text-t-sm text-ink-hi transition-colors hover:border-[color:var(--border-ui)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const FACET =
  'chip min-h-tap px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const FACET_OFF = 'hover:border-[color:var(--border-ui)] hover:text-ink-hi';

function PhotoCard({ spot, onOpen, added }: { spot: PhotoSpot; onOpen: () => void; added: boolean }) {
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
      data-leg={isNepal ? 'nepal' : 'japan'}
      className="plate group relative rounded-r1 p-gut border-hair border-[color:hsl(var(--border))] transition-colors duration-300 hover:border-[color:var(--border-ui)] focus-within:border-[color:var(--border-ui)]"
    >
      {/* The ratio lives on the frame as `--plate-ar`, which is what the recipe reads. An
          `aspect-[16/10]` on `.fig` was (0,1,0) under a (0,2,0) recipe, and with no grid
          parent the ramp had no row to span and rendered at height 0. */}
      {spot.image && !imgError && (
        <div className="frame [--plate-ar:16_/_10] -mx-gut -mt-gut mb-4">
          <div className="fig bg-surface-raised motion-safe:group-hover:[&_img]:scale-105 [&_img]:transition-transform [&_img]:duration-500">
            <OptimizedImage
              src={spot.image}
              alt={`${spot.name}, ${spot.city}`}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover"
              onError={() => setImgError(true)}
            />
            <div className="absolute top-3 left-3 z-[3] flex flex-col items-start gap-1.5">
              {spot.mustSee && (
                <span className="stamp border-[color:var(--now)] bg-[rgb(var(--scrim-ink-rgb)/0.72)] text-now">
                  <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                  Must-see
                </span>
              )}
              <AddedBadge added={added} testId={`photo-added-${spot.id}`} />
            </div>
          </div>
          <div className="ramp" aria-hidden="true" />
        </div>
      )}

      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-r1 border-hair border-[color:var(--now)]">
            <Camera className="w-4 h-4 text-now" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-t-body font-semibold text-ink-hi flex items-center gap-1.5">
              {/* V6-10: the details control is the TITLE, not the card body. A button
                  wrapping flow content is non-conforming HTML, and `button` is a
                  children-presentational ARIA role — it swallowed this <h3> so the ~60
                  card titles per page were absent from the heading outline. The `::after`
                  restores the whole-card hit area (it resolves against the `relative` root
                  above). No aria-label: the visible title text IS the accessible name, so
                  heading navigation announces the place, not "View details for …". */}
              <button
                type="button"
                onClick={onOpen}
                className="block text-left outline-none after:absolute after:inset-0 after:content-[''] after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {spot.name}
              </button>
              {/* this is the "Must-see" RIBBON's no-image fallback — the same
                  content-semantic label in icon form — so it keeps the ribbon's gold. */}
              {spot.mustSee && !spot.image && <Star className="w-3 h-3 fill-current text-now" aria-hidden="true" />}
            </h3>
            <p className="pr pr--lo">{spot.city} · {spot.country}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="chip border-[color:var(--now)] text-now">{spot.category}</span>
          {/* No-image cards have no top-left overlay stack, so surface the chip here. */}
          {(!spot.image || imgError) && <AddedBadge added={added} testId={`photo-added-${spot.id}`} />}
        </div>
      </div>

      {/* The shooting facts, as a ruled list. A row is a border and text. */}
      <dl className="list -mx-gut border-t-hair border-[color:hsl(var(--border))]">
        <div className="r [--lead:auto] !items-center">
          <dt className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-ink-lo" aria-hidden="true" />
            <span className="pr pr--lo w-16 shrink-0">Light</span>
          </dt>
          <dd className="text-t-sm text-ink-hi">{spot.bestTime}</dd>
        </div>
        <div className="r [--lead:auto] !items-center">
          <dt className="flex items-center gap-2">
            <Aperture className="w-3.5 h-3.5 text-ink-lo" aria-hidden="true" />
            <span className="pr pr--lo w-16 shrink-0">Style</span>
          </dt>
          <dd className="text-t-sm text-ink-hi">{spot.style}</dd>
        </div>
        <div className="r [--lead:auto] !items-center">
          <dt className="flex items-center gap-2">
            <Camera className="w-3.5 h-3.5 text-ink-lo" aria-hidden="true" />
            <span className="pr pr--lo w-16 shrink-0">Gear</span>
          </dt>
          <dd className="text-t-sm text-ink-hi">{spot.gear}</dd>
        </div>
      </dl>

      <p className="mt-3 text-t-sm text-ink-mid">{spot.tip}</p>

      {/* Add-to-plan affordance — additive; a sibling of the details button. `relative
          z-10` lifts it above the title button's stretched `::after`, which would
          otherwise paint over it (positioned pseudo beats a static sibling) and swallow
          its clicks. */}
      <div className="relative z-10">
        <AddToPlanButton source={spot} sourceType="photo" accentColor="text-now" />
      </div>
    </m.div>
  );
}

/**
 * optional `country` filter prop. No prop = every spot (v1, whole-page
 * behavior); on the /nepal/ and /japan/ pages the guide shows only that country's
 * spots. adds city + category chips with live counts, a search box, sort, an
 * empty state, must-see badges, and a tap-to-open detail sheet. Category/city chips
 * derive from the country-filtered set so a page never renders a dead filter.
 */
export default function PhotographyGuide({ country }: { country?: 'Nepal' | 'Japan' }) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeCity, setActiveCity] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('mustSee');
  const { findPlacements } = useItineraryContext();

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
          title="Photography Guide"
          subtitle="Capture the perfect shot at every destination with expert shooting tips and gear suggestions."
        />

        {/* Search + sort */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-lo pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search spots, styles, tips…"
              aria-label="Search photography guide"
              className={`${CTRL} w-full min-h-tap pl-9 pr-9 py-2 placeholder:text-ink-lo`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 text-ink-lo transition-colors hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <SlidersHorizontal className="w-4 h-4 text-ink-lo" aria-hidden="true" />
            <label htmlFor="photo-sort" className="sr-only">Sort</label>
            <select
              id="photo-sort"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className={`${CTRL} min-h-tap px-3 py-2`}
            >
              <option value="mustSee" className="bg-surface-low">Sort: Must-see first</option>
              <option value="name" className="bg-surface-low">Sort: Name (A–Z)</option>
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
                className={`${FACET} ${activeCity === city ? 'chip--struck' : FACET_OFF}`}
              >
                {city === 'All' ? 'All cities' : city}
                <span className="num ml-1.5 text-ink-lo">{cityCounts[city] ?? 0}</span>
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
              className={`${FACET} ${activeCategory === cat ? 'chip--struck' : FACET_OFF}`}
            >
              {cat}
              <span className="num ml-1.5 text-ink-lo">{categoryCounts[cat] ?? 0}</span>
            </button>
          ))}
        </div>

        {filtered.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((spot) => (
              <PhotoCard key={spot.id} spot={spot} onOpen={() => openDetail(spot)} added={findPlacements(spot.id).length > 0} />
            ))}
          </div>
        ) : (
          <div className="empty-frame p-gut py-16 text-center">
            <SearchX className="w-10 h-10 mx-auto mb-4 text-ink-lo" aria-hidden="true" />
            <p className="empty mb-1">Nothing on file matches these filters</p>
            <p className="empty mb-5 text-ink-lo">
              <span className="num">{spots.length}</span> spots are surveyed here. Widen the
              search, the city or the category to reach them.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="btn btn--2 mx-auto outline-none focus-visible:outline-none"
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
