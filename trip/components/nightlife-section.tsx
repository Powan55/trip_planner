'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import {
  Music, Eye, EyeOff, MapPin, DollarSign, Calendar, Headphones,
  Search, X, SlidersHorizontal, SearchX, Star,
} from 'lucide-react';
import { NIGHTLIFE_VENUES, NightlifeVenue } from '@/lib/nightlife-data';
import PlaceDetailSheet, { type PlaceDetailData } from '@/components/place-detail-sheet';
import type { ItineraryDraft } from '@/lib/itinerary-adapter';
import { uiPrefs } from '@/core/storage/gateway';
import { useActiveTraveler } from '@/hooks/use-active-traveler';

type SortKey = 'mustSee' | 'name';

/** City = last comma segment of `location` ("Thamel, Kathmandu" → "Kathmandu"). */
function cityOf(loc: string): string {
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : loc;
}

function VenueCard({ venue, onOpen }: { venue: NightlifeVenue; onOpen: () => void }) {
  const isNepal = venue.country === 'Nepal';
  return (
    <m.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      whileHover={{ y: -4 }}
      className="rounded-2xl bg-gradient-to-br from-purple-900/20 to-fuchsia-900/20 border border-purple-500/10 hover:border-purple-500/20 hover:shadow-lg hover:shadow-purple-500/5 transition-all duration-300 overflow-hidden"
    >
      <button
        type="button"
        onClick={onOpen}
        data-testid={`nightlife-add-${venue.id}`}
        aria-label={`View details for ${venue.name}`}
        className="block w-full text-left p-5 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none rounded-2xl"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-fuchsia-500/10">
              <Music className="w-4 h-4 text-fuchsia-400" />
            </div>
            <div>
              <h3 className="font-display font-bold text-white text-sm flex items-center gap-1.5">
                {venue.name}
                {venue.mustSee && <Star className="w-3 h-3 fill-gold-400 text-gold-400" />}
              </h3>
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
      </button>
    </m.div>
  );
}

/**
 * Optional `country` filter prop. No prop = both country blocks
 * (default behavior); on /nepal/ and /japan/ only that country's venues show. The
 * show/hide toggle and its `nightlife_section_visible` key/value shape live in the
 * storage gateway (`uiPrefs`).
 *
 * Includes a search box, city + vibe chips with live counts, sort, an empty state,
 * must-see badges, and a tap-to-open detail sheet. Nightlife venues have no adapter
 * source, so the detail sheet's add-to-plan uses the CUSTOM add flow: a plain item
 * prefilled with the venue's title/location, with NO sourceId — it can never trip a
 * false "Added" badge on any curated card.
 */
export default function NightlifeSection({ country }: { country?: 'Nepal' | 'Japan' }) {
  const { traveler } = useActiveTraveler();
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
    // The `nightlife_section_visible` key + access live in the gateway.
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
  // defaults to 'nightlife' since it's the honest category for a venue.
  const customAddDraft: ItineraryDraft | undefined = selected
    ? {
        title: selected.name,
        location: selected.location,
        notes: selected.description,
        category: 'nightlife',
        duration: undefined,
        time: undefined,
        sourceId: '',
        sourceType: 'recommendation',
      }
    : undefined;

  const resetFilters = () => {
    setActiveCity('All');
    setActiveVibe('All');
    setQuery('');
  };

  // Visibility gate (soft/UI-only, NOT real access control — the content
  // still ships in the static bundle either way). Hidden entirely (not a teaser) unless
  // a real Trip Token is signed in; `traveler === null` covers both "not mounted yet" and
  // "guest" (a guest never gets past the token-gate wall without EITHER a token OR the
  // guest flag, so reaching this component with `traveler === null` only happens on the
  // guest path — exactly the case this hides).
  if (!mounted || !traveler) return null;

  return (
    <section id="nightlife" data-testid="nightlife-section" aria-labelledby="nightlife-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Slide-only masthead entrance (opacity pinned to 1) so the axe
            scan (no reduced-motion) can't catch the muted `text-white/50` subtitle
            mid-fade as a transient contrast failure. See RecommendationSection. */}
        <m.div
          initial={{ opacity: 1, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="nightlife-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Nightlife <span className="text-gradient-sakura">& Bars</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto mb-4">
            Discover the best clubs, bars, and late-night experiences {scopeLabel}.
          </p>
          <button
            onClick={toggleVisible}
            aria-expanded={visible}
            aria-controls="nightlife-content"
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
              visible
                ? 'bg-fuchsia-500/20 text-fuchsia-300 ring-1 ring-fuchsia-500/30 hover:bg-fuchsia-500/30'
                : 'bg-white/5 text-white/55 hover:bg-white/10 hover:text-white/80'
            }`}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {visible ? 'Hide Nightlife Section' : 'Show Nightlife Section'}
          </button>
        </m.div>

        {/* `initial={false}` skips the ENTER animation for content already
            present on first render. `visible` defaults to true, so without this the
            whole nightlife panel fades up from opacity:0 on every page load — and
            the (non-reduced-motion) axe scan catches its chips/inputs mid-fade at
            ~0.15 opacity as serious contrast failures. Suppressing only the initial
            mount animation keeps the show/hide toggle transition fully intact. */}
        <AnimatePresence initial={false}>
          {visible && (
            <m.div
              id="nightlife-content"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              {/* Search + sort */}
              <div className="flex flex-col sm:flex-row gap-3 mb-5 max-w-2xl mx-auto">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search bars, clubs, music…"
                    aria-label="Search nightlife venues"
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
                  <label htmlFor="nightlife-sort" className="sr-only">Sort</label>
                  <select
                    id="nightlife-sort"
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
                          ? 'text-fuchsia-300 bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30'
                          : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                      }`}
                    >
                      {city === 'All' ? 'All cities' : city}
                      <span className="ml-1.5 text-white/50 font-mono">{cityCounts[city] ?? 0}</span>
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
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                      activeVibe === vibe
                        ? 'text-fuchsia-300 bg-fuchsia-500/15 ring-1 ring-fuchsia-500/30'
                        : 'text-white/55 hover:bg-white/5 hover:text-white/80'
                    }`}
                  >
                    {vibe === 'All' ? 'All vibes' : vibe}
                    <span className="ml-1.5 text-white/50 font-mono">{vibeCounts[vibe] ?? 0}</span>
                  </button>
                ))}
              </div>

              {filtered.length > 0 ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filtered.map((v) => (
                    <VenueCard key={v.id} venue={v} onOpen={() => openDetail(v)} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-16 px-6 rounded-2xl bg-gradient-to-br from-purple-900/20 to-fuchsia-900/20 border border-purple-500/10">
                  <SearchX className="w-10 h-10 mx-auto mb-4 text-white/20" />
                  <p className="text-white/60 font-medium mb-1">No venues match your filters</p>
                  <p className="text-white/35 text-sm mb-5">Try a different search, city, or vibe.</p>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-fuchsia-300 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                  >
                    Clear filters
                  </button>
                </div>
              )}
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
