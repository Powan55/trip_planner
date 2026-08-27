'use client';

import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { m, useReducedMotion } from 'framer-motion';
import Sheet from '@/components/ui/sheet-dark';
import { SectionHeading } from '@/components/section-heading';
import { Star, Clock, MapPin, Camera, Search, X, SlidersHorizontal, SearchX, Heart, Check } from 'lucide-react';
import { Recommendation } from '@/lib/nepal-data';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';
import AddedBadge from '@/components/added-badge';
import PlaceDetailSheet, {
  SHEET_PANEL,
  SHEET_HEAD,
  SHEET_CLOSE,
  type PlaceDetailData,
} from '@/components/place-detail-sheet';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useFavorites } from '@/hooks/use-favorites';
import { useCardTilt, useGyroOptIn } from '@/hooks/use-card-tilt';

interface RecommendationSectionProps {
  id: string;
  title: string;
  subtitle: string;
  items: Recommendation[];
  categories: string[];
}

type SortKey = 'rating' | 'name';

// The three control shapes this section repeats. A facet chip is `.chip`: STRUCK when it
// is on, plain rule when it is off — the mark carries the state and no fill is spent, so
// the screen's one `--accent` fill stays free for the thing that is actually live.
const CTRL =
  'rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low text-t-sm text-ink-hi transition-colors hover:border-[color:var(--border-ui)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const FACET =
  'chip min-h-tap px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const FACET_OFF = 'hover:border-[color:var(--border-ui)] hover:text-ink-hi';

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
  onOpen,
  favorited,
  onToggleFavorite,
  favoritesReady,
  added,
}: {
  item: Recommendation;
  onOpen: () => void;
  favorited: boolean;
  onToggleFavorite: () => void;
  /** Gate the favorite toggle's render on hook hydration (no SSR/first-paint mismatch). */
  favoritesReady: boolean;
  /** Whether this place is already in the plan — drives the card-corner chip. */
  added: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  const reduce = useReducedMotion();
  // — pointer/gyro 3D tilt (cards only). Fully disabled under reduced motion.
  const tilt = useCardTilt();
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileHover={reduce ? undefined : { y: -6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      style={tilt.style}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
      data-testid={`guide-tilt-${item.id}`}
      data-tilt-enabled={tilt.enabled}
      className="plate relative rounded-r1 overflow-hidden group border-hair border-[color:hsl(var(--border))] transition-colors duration-300 hover:border-[color:var(--border-ui)] focus-within:border-[color:var(--border-ui)]"
    >
      {/* The ratio lives on the frame as `--plate-ar`, which is what the recipe reads, and
          the grid is what gives the ramp a row to span. */}
      {item.image && !imgError ? (
        <div className="frame [--plate-ar:16_/_10]">
          <div
            className="fig vt-shared bg-surface-raised motion-reduce:[&_img]:!transform-none"
            style={{ ['--vt-name']: `place-photo-${item.id}` } as CSSProperties}
          >
            <OptimizedImage
              src={item.image}
              alt={item.name}
              fill
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover group-hover:scale-105 transition-transform duration-500"
              onError={() => setImgError(true)}
            />
            <div className="absolute top-3 right-3 z-[3] flex items-center gap-1">
              <span className="chip chip--struck bg-[rgb(var(--scrim-ink-rgb)/0.72)]">
                <Camera className="w-3 h-3" aria-hidden="true" />
                <span className="num">{item.photoRating}</span>/5
              </span>
            </div>
            <div className="absolute top-3 left-3 z-[3] flex flex-col items-start gap-1.5">
              {item.mustSee && (
                <span className="stamp border-[color:var(--now)] bg-[rgb(var(--scrim-ink-rgb)/0.72)] text-now">
                  <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                  Must-see
                </span>
              )}
              <AddedBadge added={added} testId={`guide-added-${item.id}`} />
            </div>
          </div>
          {/* The ramp reads the scrim-ink channel, so it cannot drift from the measured
              worst-case pixel the way a pasted rgba() does. */}
          <div className="ramp" aria-hidden="true" />
        </div>
      ) : (
        // No photograph: the frame renders at its FULL SIZE, hollow, rather than
        // shrinking, and it is never captioned as absent.
        <div className="empty-frame m-gut aspect-[16/10] flex items-center justify-center relative">
          <MapPin className="w-8 h-8 text-ink-lo" aria-hidden="true" />
          <span className="hollow-tag absolute bottom-2">No plate on file</span>
          <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
            {item.mustSee && (
              <span className="stamp border-[color:var(--now)] text-now">
                <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                Must-see
              </span>
            )}
            <AddedBadge added={added} testId={`guide-added-${item.id}`} />
          </div>
        </div>
      )}
      <div className="p-gut pb-0">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3
            className="vt-shared text-t-body font-semibold text-ink-hi leading-tight"
            style={{ ['--vt-name']: `place-title-${item.id}` } as CSSProperties}
          >
            {/* V6-10: the details control is the TITLE, not the whole card body. A
                button may only contain phrasing content, and its children-presentational
                ARIA role collapsed this <h3> into the button's name — so every card title
                on the page was missing from the heading outline. The `::after` stretches
                the hit area back over the card (it resolves against the `relative` root;
                `vt-shared` sets only `view-transition-name`, which adds no containment
                outside a running transition). No aria-label — the visible name is both
                the heading text and the button's accessible name. */}
            <button
              type="button"
              onClick={onOpen}
              data-testid={`guide-card-${item.id}`}
              className="block text-left outline-none after:absolute after:inset-0 after:content-[''] after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.name}
            </button>
          </h3>
          <span className="chip border-[color:var(--now)] text-now whitespace-nowrap">{item.category}</span>
        </div>
        <p className="text-t-sm text-ink-mid mb-3 line-clamp-2">{item.description}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pr pr--lo">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden="true" />{item.bestTime}</span>
          <span className="flex items-center gap-1"><MapPin className="w-3 h-3" aria-hidden="true" />{item.duration}</span>
          <span className="flex items-center gap-1">
            {Array.from({ length: item.photoRating }).map((_, i) => (
              <Star key={i} className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
            ))}
          </span>
        </div>
        {item.notes && <p className="text-t-sm text-ink-mid mt-2">{item.notes}</p>}
      </div>
      {/* Both controls in this row need `relative z-10`: the title button's stretched
          `::after` is a positioned box and would otherwise paint over these static
          siblings and swallow their clicks. */}
      <div className="p-gut pt-3 flex items-start gap-2">
        {/* Add-to-plan affordance — additive; a sibling of the details button. */}
        <div className="relative z-10 flex-1 min-w-0">
          <AddToPlanButton source={item} sourceType="recommendation" accentColor="text-now" />
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
            className={`relative z-10 mt-3 shrink-0 grid place-items-center h-tap w-tap rounded-r1 border-hair transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
              favorited
                ? 'border-[color:var(--accent)] text-[color:hsl(var(--accent))] bg-[rgb(62_216_255/0.10)]'
                : 'border-[color:hsl(var(--border))] text-ink-lo hover:border-[color:var(--border-ui)] hover:text-ink-hi'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorited ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
    </m.div>
  );
}

/**
 * FilterSheet — the
 * guide-filter facets collapsed behind ONE "Filters · n" trigger. All the
 * plumbing (portal, Esc, Tab-trap, autofocus, focus-return, seam flag) now lives in
 * `components/ui/sheet.tsx`; this just supplies the header + facets as the body.
 * Right-side drawer on desktop, bottom sheet on mobile.
 */
function FilterSheet({
  open,
  onClose,
  onExitComplete,
  titleId,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onExitComplete: () => void;
  titleId: string;
  children: ReactNode;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      onExitComplete={onExitComplete}
      labelledBy={titleId}
      side="right"
      testId="guide-filters-sheet"
      className={`${SHEET_PANEL} w-full sm:w-[440px] sm:max-w-full sm:h-full max-h-[85vh] sm:max-h-none`}
    >
      <div className={SHEET_HEAD}>
        <div className="min-w-0">
          <span className="pr pr--lo block">Guide</span>
          <h3 id={titleId} className="pr pr--l text-ink-hi">Filters</h3>
        </div>
        <button
          type="button"
          data-testid="guide-filters-close"
          onClick={onClose}
          aria-label="Close filters"
          className={SHEET_CLOSE}
        >
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-gut py-5">{children}</div>
    </Sheet>
  );
}

export default function RecommendationSection({
  id, title, subtitle, items, categories,
}: RecommendationSectionProps) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeCity, setActiveCity] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('rating');
  const [savedOnly, setSavedOnly] = useState(false);
  const [plannedOnly, setPlannedOnly] = useState(false);
  const { favorites, toggle: toggleFavorite, hydrated: favoritesReady } = useFavorites();
  // Reactive planned-state lookup — same mechanism AddToPlanButton uses.
  const { findPlacements } = useItineraryContext();
  // — one iOS motion opt-in for the whole section (renders only on iOS, sensor
  // not yet granted, motion allowed). Desktop/Android/reduced-motion → nothing renders.
  const gyro = useGyroOptIn();

  // How many of THIS section's items are favorited — the "Saved" chip only renders once this
  // is >= 1 (it cuts across categories, so it isn't folded into the `categories` chip row).
  const savedCount = useMemo(
    () => items.filter((i) => favorites.includes(i.id)).length,
    [items, favorites],
  );

  // How many of THIS section's items are already in the plan — drives the "Planned"
  // chip's visibility + live count. A plain per-render expression is fine at this scale
  //.
  const plannedCount = items.filter((i) => findPlacements(i.id).length > 0).length;

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
  // `useCallback` rather than a plain closure so it can be a real dependency of the three memos
  // below. All three used to silence exhaustive-deps to hide THIS closure — and the blanket
  // disable also hid a live one: `filtered` reads `findPlacements`, whose identity changes on
  // every itinerary commit, so with the "Planned" chip on the card list went stale while the
  // unmemoized chip count beside it updated, and the screen contradicted itself.
  const matchesSearch = useCallback(
    (i: Recommendation) =>
      !q ||
      i.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q),
    [q],
  );

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
  }, [items, categories, activeCity, matchesSearch]);

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
  }, [items, cities, activeCategory, matchesSearch]);

  const filtered = useMemo(() => {
    const out = items.filter(
      (i) =>
        (activeCategory === 'All' || i.category === activeCategory) &&
        (activeCity === 'All' || cityOf(i.location) === activeCity) &&
        (!savedOnly || favorites.includes(i.id)) &&
        (!plannedOnly || findPlacements(i.id).length > 0) &&
        matchesSearch(i),
    );
    out.sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : b.photoRating - a.photoRating || a.name.localeCompare(b.name),
    );
    return out;
  }, [items, activeCategory, activeCity, sort, savedOnly, favorites, plannedOnly, findPlacements, matchesSearch]);

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
    setPlannedOnly(false);
  };

  // — the filter facets (sort + city + Saved/Planned + category chips) collapse
  // behind ONE "Filters · n" trigger + sheet; search stays pinned above the grid (a query,
  // not a facet). `n` counts the active SHEET facets only — category≠All, city≠All,
  // savedOnly, plannedOnly, and a non-default sort — so the trigger's badge/aria mirror what
  // the user has narrowed by inside the sheet (search has its own visible clear affordance).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filtersTitleId = `${id}-filters-title`;
  const activeFilterCount =
    (activeCategory !== 'All' ? 1 : 0) +
    (activeCity !== 'All' ? 1 : 0) +
    (savedOnly ? 1 : 0) +
    (plannedOnly ? 1 : 0) +
    (sort !== 'rating' ? 1 : 0);
  // "Clear all" inside the sheet resets the facets AND sort (kept out of resetFilters so the
  // empty-state "Clear filters" path stays byte-identical to its prior behavior).
  const clearAllFilters = () => {
    resetFilters();
    setSort('rating');
  };

  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id={`${id}-heading`}
          className="mb-10"
          title={`${title} Guide`}
          subtitle={subtitle}
        />

        {/* Pinned search + the single "Filters · n" trigger. Search stays visible
            (a query, not a facet); every facet (sort + city + Saved/Planned + category) lives
            one tap away in the sheet so the grid is content-first. */}
        <div className="flex gap-3 mb-8 max-w-2xl mx-auto">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-lo pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or description…"
              aria-label={`Search ${title} guide`}
              data-testid="guide-search-input"
              className={`${CTRL} w-full min-h-tap pl-9 pr-9 py-2 placeholder:text-ink-lo`}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-r1 text-ink-lo transition-colors hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            ref={filtersTriggerRef}
            type="button"
            onClick={() => setFiltersOpen(true)}
            data-testid="guide-filters-trigger"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            aria-label={activeFilterCount > 0 ? `Filters, ${activeFilterCount} active` : 'Filters'}
            className={`${CTRL} shrink-0 inline-flex min-h-tap items-center gap-2 px-3`}
          >
            <SlidersHorizontal className="w-4 h-4 text-ink-lo" aria-hidden="true" />
            <span className="pr pr--l text-ink-hi">Filters</span>
            {activeFilterCount > 0 && (
              <span className="chip chip--struck num ml-0.5">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* The facets, collapsed into the sheet. Every testid + live count + the
            aria-pressed semantics are unchanged — only their location moved from a permanent
            stack above the grid into this one-tap sheet. */}
        <FilterSheet
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          onExitComplete={() => filtersTriggerRef.current?.focus?.()}
          titleId={filtersTitleId}
        >
          <div className="space-y-6">
            {/* Sort */}
            <div>
              <label htmlFor={`${id}-sort`} className="pr pr--lo mb-2 block">Sort</label>
              <select
                id={`${id}-sort`}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                data-testid="guide-sort-select"
                className={`${CTRL} w-full min-h-tap px-3 py-2`}
              >
                <option value="rating" className="bg-surface-low">Sort: Top rated</option>
                <option value="name" className="bg-surface-low">Sort: Name (A–Z)</option>
              </select>
            </div>

            {/* City filter chips (only when more than one city is present) */}
            {cities.length > 2 && (
              <div>
                <span className="pr pr--lo mb-2 block">City</span>
                <div className="flex flex-wrap gap-2">
                  {cities.map((city) => (
                    <button
                      key={city}
                      onClick={() => setActiveCity(city)}
                      aria-pressed={activeCity === city}
                      data-testid={`guide-filter-city-${city.toLowerCase()}`}
                      className={`${FACET} ${activeCity === city ? 'chip--struck' : FACET_OFF}`}
                    >
                      {city === 'All' ? 'All cities' : city}
                      <span className="num ml-1.5 text-ink-lo">{cityCounts[city] ?? 0}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Cross-cutting boolean filter chips (Saved / Planned) — separate toggles rather
                than folded into the `categories` chip row since each cuts across categories.
                Each renders only when it has >=1 matching item ("Saved" also waits for
                favorites to hydrate). */}
            {((favoritesReady && savedCount > 0) || plannedCount > 0) && (
              <div>
                <span className="pr pr--lo mb-2 block">Status</span>
                <div className="flex flex-wrap gap-2">
                  {favoritesReady && savedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setSavedOnly((v) => !v)}
                      aria-pressed={savedOnly}
                      data-testid="guide-filter-saved"
                      className={`${FACET} ${savedOnly ? 'chip--struck' : FACET_OFF}`}
                    >
                      <Heart className={`w-3 h-3 ${savedOnly ? 'fill-current' : ''}`} />
                      Saved
                      <span className="num ml-0.5 text-ink-lo">{savedCount}</span>
                    </button>
                  )}
                  {plannedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setPlannedOnly((v) => !v)}
                      aria-pressed={plannedOnly}
                      data-testid="guide-filter-planned"
                      className={`${FACET} ${plannedOnly ? 'chip--struck' : FACET_OFF}`}
                    >
                      <Check className="w-3 h-3" />
                      Planned
                      <span className="num ml-0.5 text-ink-lo">{plannedCount}</span>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Category filter chips with live counts */}
            <div>
              <span className="pr pr--lo mb-2 block">Category</span>
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    aria-pressed={activeCategory === cat}
                    data-testid={`guide-filter-category-${cat.toLowerCase()}`}
                    className={`${FACET} ${activeCategory === cat ? 'chip--struck' : FACET_OFF}`}
                  >
                    {cat}
                    <span className="num ml-1.5 text-ink-lo">{categoryCounts[cat] ?? 0}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Sheet actions — clear every facet (incl. sort) or apply + close. */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={clearAllFilters}
                disabled={activeFilterCount === 0}
                data-testid="guide-filters-clear"
                className="btn btn--2 max-w-none flex-1 outline-none focus-visible:outline-none"
              >
                Clear all
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(false)}
                data-testid="guide-filters-apply"
                className="btn max-w-none flex-1 outline-none focus-visible:outline-none"
              >
                Show {filtered.length} {filtered.length === 1 ? 'result' : 'results'}
              </button>
            </div>
          </div>
        </FilterSheet>

        {/* iOS motion-tilt opt-in — unobtrusive, one per section, iOS-only. */}
        {gyro.show && (
          <div className="flex justify-center mb-6">
            <button
              type="button"
              onClick={gyro.request}
              data-testid="guide-tilt-optin"
              className={`${FACET} ${FACET_OFF}`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              Enable motion tilt
            </button>
          </div>
        )}

        {/* Cards Grid or empty state */}
        {filtered.length > 0 ? (
          <div data-testid="guide-results" className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {filtered.map((item) => (
              <RecommendationCard
                key={item.id}
                item={item}
                onOpen={() => openDetail(item)}
                favorited={favorites.includes(item.id)}
                onToggleFavorite={() => toggleFavorite(item.id)}
                favoritesReady={favoritesReady}
                added={findPlacements(item.id).length > 0}
              />
            ))}
          </div>
        ) : (
          <div data-testid="guide-empty-state" className="empty-frame p-gut py-16 text-center">
            <SearchX className="w-10 h-10 mx-auto mb-4 text-ink-lo" />
            <p className="empty mb-1">Nothing on file matches these filters</p>
            <p className="empty mb-5 text-ink-lo">
              <span className="num">{items.length}</span> places are in this guide. Widen the
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
        addSourceType={selected ? 'recommendation' : undefined}
      />
    </section>
  );
}
