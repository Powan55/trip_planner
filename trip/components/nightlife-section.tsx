'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import {
  Music, Eye, EyeOff, MapPin, DollarSign, Calendar, Headphones,
  Search, X, SlidersHorizontal, SearchX, Star, Check, CalendarDays,
} from 'lucide-react';
import { NIGHTLIFE_VENUES, NightlifeVenue } from '@/lib/nightlife-data';
import PlaceDetailSheet, { type PlaceDetailData } from '@/components/place-detail-sheet';
import { nightlifeSourceId, formatPlacementSummary, type ItineraryDraft } from '@/lib/itinerary-adapter';
import type { ItineraryStore } from '@/hooks/use-itinerary';
import { uiPrefs } from '@/core/storage/gateway';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { useItineraryContext } from '@/components/itinerary-provider';

type SortKey = 'mustSee' | 'name';

// Shared control shapes. A facet chip is `.chip`: STRUCK when it is on, a plain rule when
// it is off — the mark carries the state, so no --accent fill is spent on a filter.
const CTRL =
  'rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low text-t-sm text-ink-hi transition-colors hover:border-[color:var(--border-ui)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const FACET =
  'chip min-h-tap px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';
const FACET_OFF = 'hover:border-[color:var(--border-ui)] hover:text-ink-hi';

/** City = last comma segment of `location` ("Thamel, Kathmandu" → "Kathmandu"). */
function cityOf(loc: string): string {
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : loc;
}

function VenueCard({
  venue,
  onOpen,
  placements,
}: {
  venue: NightlifeVenue;
  onOpen: () => void;
  placements: ReturnType<ItineraryStore['findPlacements']>;
}) {
  const isNepal = venue.country === 'Nepal';
  const isAdded = placements.length > 0;
  const summary = formatPlacementSummary(placements);
  return (
    // No entrance and no scroll-reveal: the card is present when you arrive.
    <m.div
      whileHover={{ y: -4 }}
      data-leg={isNepal ? 'nepal' : 'japan'}
      className="relative p-gut rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low transition-colors duration-300 hover:border-[color:var(--border-ui)] focus-within:border-[color:var(--border-ui)] overflow-hidden"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-r1 border-hair border-[color:var(--now)]">
            <Music className="w-4 h-4 text-now" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-t-body font-semibold text-ink-hi flex items-center gap-1.5">
              {/* V6-10: the details control is the TITLE, not the card body — a button
                  cannot legally wrap flow content, and its children-presentational ARIA
                  role hid this <h3> from the heading outline entirely. The `::after`
                  restores the whole-card hit area against the `relative` root above, and
                  dropping the old aria-label lets the visible name serve as BOTH the
                  heading text and the button's accessible name. */}
              <button
                type="button"
                onClick={onOpen}
                data-testid={`nightlife-add-${venue.id}`}
                className="block text-left outline-none after:absolute after:inset-0 after:content-[''] after:rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {venue.name}
              </button>
              {/* same content-semantic "must-see" label as the gold ribbon. */}
              {venue.mustSee && <Star className="w-3 h-3 fill-current text-now" aria-hidden="true" />}
            </h3>
            <p className="pr pr--lo flex items-center gap-1">
              <MapPin className="w-3 h-3" aria-hidden="true" />
              {venue.location}
            </p>
          </div>
        </div>
        <span className="chip border-[color:var(--now)] text-now">{venue.country}</span>
      </div>

      <p className="text-t-sm text-ink-mid mb-3">{venue.description}</p>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-1.5 pr pr--lo">
          <Headphones className="w-3 h-3" aria-hidden="true" />
          <span>{venue.musicType}</span>
        </div>
        <div className="flex items-center gap-1.5 pr pr--lo">
          <DollarSign className="w-3 h-3" aria-hidden="true" />
          <span>{venue.priceRange}</span>
        </div>
        <div className="flex items-center gap-1.5 pr pr--lo">
          <Music className="w-3 h-3" aria-hidden="true" />
          <span>{venue.vibe}</span>
        </div>
        <div className="flex items-center gap-1.5 pr pr--lo">
          <Calendar className="w-3 h-3" aria-hidden="true" />
          <span>{venue.bestDays}</span>
        </div>
      </div>

      {/* passive planned-state indicator — decorative only (still NOT interactive:
          add/modify/remove lives in the detail sheet the title opens), so it needs no
          `z-10` lift above the stretched `::after`. Reactive to the shared itinerary
          store. */}
      {isAdded && (
        <span
          data-testid={`nightlife-added-${venue.id}`}
          className="chip chip--struck mt-3 flex w-full justify-center"
        >
          <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Added</span>
          <span aria-hidden="true">·</span>
          <span className="flex items-center gap-1">
            <CalendarDays className="w-3 h-3 shrink-0" aria-hidden="true" />
            {summary}
          </span>
        </span>
      )}
    </m.div>
  );
}

/**
 * optional `country` filter prop. No prop = both country blocks
 * (v1 behavior); on /nepal/ and /japan/ only that country's venues show. The show/hide
 * toggle and its `nightlife_section_visible` key/value shape are unchanged; as of
 * the key + storage access live in the gateway.
 *
 * adds a search box, city + vibe chips with live counts, sort, an empty state,
 * must-see badges, and a tap-to-open detail sheet. Nightlife venues have no adapter
 * source, so the detail sheet's add-to-plan uses the
 * CUSTOM add flow: a plain item prefilled with the venue's title/location.
 * namespaces the custom draft's sourceId (`nightlife-<id>`) so it CAN
 * show planned-state feedback — the namespace guarantees it still never trips a
 * false "Added" badge on any curated (recommendation/photo/map/featured) card.
 */
export default function NightlifeSection({ country }: { country?: 'Nepal' | 'Japan' }) {
  const { traveler } = useActiveTraveler();
  const { findPlacements } = useItineraryContext();
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);
  const scopeLabel =
    country === 'Nepal' ? 'in Kathmandu' : country === 'Japan' ? 'in Tokyo' : 'in Kathmandu and Tokyo';

  const [activeCity, setActiveCity] = useState('All');
  const [activeVibe, setActiveVibe] = useState('All');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('mustSee');

  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<NightlifeVenue | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
    // the `nightlife_section_visible` key + access moved to the gateway.
    // The pref is `String(boolean)` on disk (NOT JSON); `uiPrefs.getNightlifeVisible()`
    // parses it leniently (`=== 'true'`) and returns null when absent — so the `visible`
    // default of `true` is only overridden when a value was actually stored, byte-identical
    // to the prior `if (saved !== null) setVisible(saved === 'true')`.
    const saved = uiPrefs.getNightlifeVisible();
    if (saved !== null) setVisible(saved);
  }, []);

  const toggleVisible = () => {
    const next = !visible;
    setVisible(next);
    uiPrefs.setNightlifeVisible(next);
  };

  const venues = useMemo(
    () => (country ? NIGHTLIFE_VENUES.filter((v) => v.country === country) : NIGHTLIFE_VENUES),
    [country],
  );

  const cities = useMemo(() => {
    const set = new Set<string>();
    venues.forEach((v) => set.add(cityOf(v.location)));
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [venues]);

  const vibes = useMemo(() => {
    const set = new Set<string>();
    venues.forEach((v) => set.add(v.vibe));
    return ['All', ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [venues]);

  const q = query.trim().toLowerCase();
  const matchesSearch = (v: NightlifeVenue) =>
    !q ||
    v.name.toLowerCase().includes(q) ||
    v.description.toLowerCase().includes(q) ||
    v.musicType.toLowerCase().includes(q);

  const cityCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    cities.forEach((city) => {
      counts[city] = venues.filter(
        (v) =>
          (city === 'All' || cityOf(v.location) === city) &&
          (activeVibe === 'All' || v.vibe === activeVibe) &&
          matchesSearch(v),
      ).length;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, cities, activeVibe, q]);

  const vibeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    vibes.forEach((vibe) => {
      counts[vibe] = venues.filter(
        (v) =>
          (vibe === 'All' || v.vibe === vibe) &&
          (activeCity === 'All' || cityOf(v.location) === activeCity) &&
          matchesSearch(v),
      ).length;
    });
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, vibes, activeCity, q]);

  const filtered = useMemo(() => {
    const out = venues.filter(
      (v) =>
        (activeCity === 'All' || cityOf(v.location) === activeCity) &&
        (activeVibe === 'All' || v.vibe === activeVibe) &&
        matchesSearch(v),
    );
    out.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      const am = a.mustSee ? 0 : 1;
      const bm = b.mustSee ? 0 : 1;
      return am - bm || a.name.localeCompare(b.name);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues, activeCity, activeVibe, q, sort]);

  const openDetail = (venue: NightlifeVenue) => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
    setSelected(venue);
    setDetailOpen(true);
  };

  const selectedDetail: PlaceDetailData | null = selected
    ? {
        id: selected.id,
        name: selected.name,
        category: selected.vibe,
        location: selected.location,
        country: selected.country,
        description: selected.description,
        longDescription: selected.longDescription,
        priceHint: selected.priceRange,
        bestTime: selected.bestDays,
        mustSee: selected.mustSee,
      }
    : null;

  // Custom-add prefill for the detail sheet: nightlife has no adapter source,
  // so we open the custom dialog with the venue title/location prefilled. category
  // defaults to 'nightlife' since it's the honest category for a venue.: sourceId
  // is now the NAMESPACED `nightlife-<id>` (not empty) so this venue can show
  // planned-state feedback; the namespace guarantees no false "Added" elsewhere.
  const customAddDraft: ItineraryDraft | undefined = selected
    ? {
        title: selected.name,
        location: selected.location,
        notes: selected.description,
        category: 'nightlife',
        duration: undefined,
        time: undefined,
        sourceId: nightlifeSourceId(selected.id),
        sourceType: 'recommendation',
      }
    : undefined;

  const resetFilters = () => {
    setActiveCity('All');
    setActiveVibe('All');
    setQuery('');
  };

  // visibility gate ( soft/UI-only, NOT real access control — the content
  // still ships in the static bundle either way). Hidden entirely (not a teaser) unless
  // a real Trip Token is signed in. With no guest mode, `traveler === null` only
  // ever means "not mounted yet" in practice — TokenGate's wall blocks every other case.
  if (!mounted || !traveler) return null;

  return (
    <section id="nightlife" data-testid="nightlife-section" aria-labelledby="nightlife-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* No scroll-reveal on this masthead, and so no wrapper opacity for the axe scan
            to catch mid-fade. Content is present when you arrive. */}
        <div className="text-center mb-10">
          <h2 id="nightlife-heading" className="pr pr--l text-ink-hi mb-3">
            Nightlife &amp; Bars
          </h2>
          <p className="text-t-lead text-ink-mid max-w-xl mx-auto mb-4">
            Discover the best clubs, bars, and late-night experiences {scopeLabel}.
          </p>
          <button
            onClick={toggleVisible}
            aria-expanded={visible}
            aria-controls="nightlife-content"
            className={`${FACET} mx-auto ${visible ? 'chip--struck' : FACET_OFF}`}
          >
            {visible ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
            {visible ? 'Hide Nightlife Section' : 'Show Nightlife Section'}
          </button>
        </div>

        {/* `initial={false}` skips the ENTER animation for content already
            present on first render. `visible` defaults to true, so without this the
            whole nightlife panel fades up from opacity:0 on every page load — and
            the (non-reduced-motion) axe scan catches its chips/inputs mid-fade at
            ~0.15 opacity as serious contrast failures. Suppressing only the initial
            mount animation keeps the show/hide toggle transition fully intact. */}
        {/* the panel below was `height: 0 → 'auto'`, which framer resolves by measuring
            the content and animating a pixel height — a layout pass on EVERY frame of the
            toggle. Swapped to a `grid-template-rows: 0fr → 1fr` transition: the grid track
            interpolates without measurement and still collapses to exactly the content height
            with no magic number. The inner `min-h-0` is required — a grid item's default
            `min-height: auto` refuses to shrink below its content, so the collapse would
            otherwise do nothing. */}
        <AnimatePresence initial={false}>
          {visible && (
            <m.div
              id="nightlife-content"
              initial={{ opacity: 0, gridTemplateRows: '0fr' }}
              animate={{ opacity: 1, gridTemplateRows: '1fr' }}
              exit={{ opacity: 0, gridTemplateRows: '0fr' }}
              className="grid overflow-hidden"
            >
              <div className="min-h-0">
              {/* Search + sort */}
              <div className="flex flex-col sm:flex-row gap-3 mb-5 max-w-2xl mx-auto">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-lo pointer-events-none" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search bars, clubs, music…"
                    aria-label="Search nightlife venues"
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
                <div className="flex items-center gap-2 shrink-0">
                  <SlidersHorizontal className="w-4 h-4 text-ink-lo" aria-hidden="true" />
                  <label htmlFor="nightlife-sort" className="sr-only">Sort</label>
                  <select
                    id="nightlife-sort"
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

              {/* Vibe filter chips with live counts */}
              <div className="flex flex-wrap justify-center gap-2 mb-8">
                {vibes.map((vibe) => (
                  <button
                    key={vibe}
                    onClick={() => setActiveVibe(vibe)}
                    aria-pressed={activeVibe === vibe}
                    className={`${FACET} ${activeVibe === vibe ? 'chip--struck' : FACET_OFF}`}
                  >
                    {vibe === 'All' ? 'All vibes' : vibe}
                    <span className="num ml-1.5 text-ink-lo">{vibeCounts[vibe] ?? 0}</span>
                  </button>
                ))}
              </div>

              {filtered.length > 0 ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filtered.map((v) => (
                    <VenueCard
                      key={v.id}
                      venue={v}
                      onOpen={() => openDetail(v)}
                      placements={findPlacements(nightlifeSourceId(v.id))}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-frame p-gut py-16 text-center">
                  <SearchX className="w-10 h-10 mx-auto mb-4 text-ink-lo" aria-hidden="true" />
                  <p className="empty mb-1">Nothing on file matches these filters</p>
                  <p className="empty mb-5 text-ink-lo">
                    <span className="num">{venues.length}</span> venues are listed here. Widen the
                    search, the city or the vibe to reach them.
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
            </m.div>
          )}
        </AnimatePresence>
      </div>

      <PlaceDetailSheet
        open={detailOpen}
        place={selectedDetail}
        onClose={() => setDetailOpen(false)}
        onExitComplete={() => triggerRef.current?.focus?.()}
        customAddDraft={customAddDraft}
      />
    </section>
  );
}
