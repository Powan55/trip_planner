'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SectionHeading } from '@/components/section-heading';
import {
  X,
  Maximize2,
  Minimize2,
  Route as RouteIcon,
  LocateFixed,
  Search,
  Heart,
  WifiOff,
} from 'lucide-react';
import {
  MAP_MARKERS,
  MARKER_CATEGORIES,
  type MapMarker,
  type MarkerCategory,
} from '@/lib/map-data';
import { buildItineraryStops } from '@/lib/itinerary-map';
import TripMap, {
  CATEGORY_STYLES,
  type TripMapHandle,
} from '@/components/trip-map';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useFavorites } from '@/hooks/use-favorites';
import { useOnline } from '@/hooks/use-online';

type FilterValue = MarkerCategory | 'All';

// ── MapSection: the /map page chrome that re-composes <TripMap> ─────────
// Owns the category filter UI, the itinerary overlay toggle, the fullscreen
// slot-swap (host relocation), the geolocate note banner, the masthead,
// and the legend. The map engine itself (init, style, markers, route, popups,
// reduced-motion) lives in <TripMap>; this component just feeds it the visible
// marker set + the whole-trip route and hosts its surface.
export default function MapSection() {
  const { plans } = useItineraryContext();

  const [filter, setFilter] = useState<FilterValue>('All');
  const [showItinerary, setShowItinerary] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  // "Saved" filter — mirrors the guide "Saved" chip idiom
  // (components/recommendation-section.tsx). Same flat favorites store; map marker
  // ids (`np-*`/`jp-*`) are provably disjoint from guide rec ids (`na#`/`ja#`) so
  // raw ids are reused as-is.
  const { favorites, hydrated: favoritesReady } = useFavorites();
  const [savedOnly, setSavedOnly] = useState(false);
  const online = useOnline();

  // Search-within-map: client-side filter over ALL curated markers (not just
  // the currently-visible/filtered set) — a plain case-insensitive `includes` over
  // name/area/country, no search library.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Portal mount guard: createPortal(…, document.body) must never
  // run during the static-export prerender (output:'export' has no document).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // TripMap's imperative handle — we call resize() after relocating the host node.
  const tripMapRef = useRef<TripMapHandle | null>(null);

  // The GL map lives inside a single, persistent host div (`mapHostRef`) that we
  // physically relocate between an inline slot and the portaled fullscreen slot.
  // React never reparents this node, so the MapLibre instance inside
  // <TripMap> survives fullscreen enter/exit with zero state loss — only its
  // size changes, which tripMapRef.resize() reconciles.
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const inlineSlotRef = useRef<HTMLDivElement | null>(null);
  const fullscreenSlotRef = useRef<HTMLDivElement | null>(null);

  // Saved-favorited count across ALL curated markers (not just the active category —
  // mirrors the guide chip's `savedCount`, which cuts across category filters).
  const savedCount = useMemo(
    () => MAP_MARKERS.filter((mk) => favorites.includes(mk.id)).length,
    [favorites],
  );

  const visibleMarkers = useMemo(() => {
    let list =
      filter === 'All' ? MAP_MARKERS : MAP_MARKERS.filter((mk) => mk.category === filter);
    if (savedOnly) list = list.filter((mk) => favorites.includes(mk.id));
    return list;
  }, [filter, savedOnly, favorites]);

  // Itinerary stops: derived from the shared store, so it live-updates on
  // any itinerary:changed fan-out (the provider re-renders us with new `plans`),
  // and TripMap re-draws its route source when this array changes.
  const stops = useMemo(
    () => (showItinerary ? buildItineraryStops(plans) : []),
    [plans, showItinerary],
  );

  // Search results — a plain case-insensitive `includes` over name/area/
  // country across ALL markers (not the category-filtered set); empty query =
  // no results shown.
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return MAP_MARKERS.filter(
      (mk) =>
        mk.name.toLowerCase().includes(q) ||
        mk.area.toLowerCase().includes(q) ||
        mk.country.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  // Reset the category filter to 'All' first — the marker must be reachable for
  // the popup to make visual sense — then fly + open via TripMap's
  // imperative handle.
  const selectSearchResult = (marker: MapMarker) => {
    setFilter('All');
    tripMapRef.current?.focusMarker(marker);
    closeSearch();
  };

  // ── Map-host relocation ─────────────────────────────────────────────
  // Physically move the persistent map-host node between the inline slot and the
  // portaled fullscreen slot (createPortal only reparents React-managed subtrees;
  // the map-host is moved imperatively so MapLibre's canvas is never destroyed).
  // Runs on mount (host → inline slot) and on every isFullscreen change; asks
  // TripMap to resize() after each move so MapLibre recomputes its canvas size.
  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    const target = isFullscreen ? fullscreenSlotRef.current : inlineSlotRef.current;
    // In fullscreen the portal slot mounts in the same commit; if for any reason
    // it isn't attached yet, bail — the next render re-runs this effect.
    if (!target) return;
    if (host.parentElement !== target) {
      target.appendChild(host);
    }
    // Two resizes: one on the next frame (after layout), one microtask-later, so
    // MapLibre reliably picks up the new box regardless of paint timing.
    const raf = requestAnimationFrame(() => tripMapRef.current?.resize());
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => tripMapRef.current?.resize()),
    );
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
    };
  }, [isFullscreen, mounted]);

  // ── Fullscreen (mobile takeover) — body scroll-lock + Esc ───────────────────
  // Local body-pin — deliberately NOT imported from navbar. The
  // shell itself is portaled + relocated above; this only owns scroll-lock, Esc,
  // and the exit resize.
  useEffect(() => {
    if (typeof document === 'undefined' || !isFullscreen) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
      // Exit resize is handled by the relocation effect (host → inline slot);
      // one more here guards the scroll-restore reflow.
      requestAnimationFrame(() => tripMapRef.current?.resize());
    };
  }, [isFullscreen]);

  const handleFilter = (value: FilterValue) => setFilter(value);

  const filters: FilterValue[] = ['All', ...MARKER_CATEGORIES];
  const plannedCount = stops.length;
  // Total items across the whole itinerary — the honest "of M" denominator, so an
  // item with no pin and no curated-marker match isn't silently missing from the count.
  const totalItineraryItems = useMemo(
    () => plans.reduce((sum, p) => sum + (p.items?.length ?? 0), 0),
    [plans],
  );

  return (
    <section
      id="map"
      aria-labelledby="map-heading"
      className="py-20 px-4 sm:px-6"
    >
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="map-heading"
          className="mb-8"
          title={<>Interactive <span className="text-gradient-gold">Map</span></>}
          subtitle="A real, pannable map of every place across the Kathmandu Valley and Japan. Filter by category, tap a pin for details, or flip on your itinerary to see the plan take shape day by day."
        />

        {/* Category filter chips. */}
        <div className="flex flex-wrap justify-center gap-2 mb-4">
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
                data-testid={`map-filter-${value.toLowerCase().replace(/\s+/g, '-')}`}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
                  isActive
                    ? value === 'All'
                      ? 'bg-white/10 text-white border-white/20'
                      : `${style!.badge}`
                    : 'text-white/55 border-transparent hover:bg-white/5 hover:text-white/80'
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" />}
                {value}
              </button>
            );
          })}

          {/* "Saved" filter chip — mirrors the guide idiom: only rendered once
              favorites have hydrated AND >=1 map marker is favorited; cuts across
              categories (composes as an AND with the active category filter). */}
          {favoritesReady && savedCount > 0 && (
            <button
              type="button"
              onClick={() => setSavedOnly((v) => !v)}
              aria-pressed={savedOnly}
              data-testid="map-filter-saved"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
                savedOnly
                  ? 'bg-gold-500/20 text-gold-300 border-gold-500/40'
                  : 'text-white/55 border-transparent hover:bg-white/5 hover:text-white/80'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${savedOnly ? 'fill-current' : ''}`} />
              Saved
              <span className="text-white/50 font-mono">{savedCount}</span>
            </button>
          )}
        </div>

        {/* Overlay + search + fullscreen controls. */}
        <div className="flex flex-wrap justify-center items-center gap-2 mb-5">
          {/* Search-within-map: an icon toggle that reveals a small
              client-side search over MAP_MARKERS (name/area/country). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-label={searchOpen ? 'Close map search' : 'Search places on map'}
              aria-expanded={searchOpen}
              data-testid="map-search-toggle"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-white/50 border border-white/10 hover:bg-white/5 hover:text-white/70 transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            {searchOpen && (
              <div
                data-testid="map-search-panel"
                className="absolute z-10 top-full mt-2 left-1/2 -translate-x-1/2 w-64 max-w-[85vw] glass-card rounded-xl p-2 border border-white/10 shadow-xl"
              >
                <label htmlFor="map-search-input" className="sr-only">
                  Search places on the map
                </label>
                <input
                  id="map-search-input"
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') closeSearch();
                  }}
                  placeholder="Search places…"
                  data-testid="map-search-input"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-navy-900/60 border border-white/10 text-xs text-white placeholder:text-white/30 outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
                />
                {searchQuery.trim() && (
                  <ul data-testid="map-search-results" className="mt-1.5 max-h-56 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <li className="px-2.5 py-1.5 text-xs text-white/35">
                        No places match &ldquo;{searchQuery.trim()}&rdquo;.
                      </li>
                    ) : (
                      searchResults.map((mk) => (
                        <li key={mk.id}>
                          <button
                            type="button"
                            onClick={() => selectSearchResult(mk)}
                            data-testid={`map-search-result-${mk.id}`}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-white/75 hover:bg-white/5 hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
                          >
                            <span className="block font-medium">{mk.name}</span>
                            <span className="block text-white/40 text-[11px]">
                              {mk.area} · {mk.country}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowItinerary((v) => !v)}
            aria-pressed={showItinerary}
            data-testid="map-itinerary-toggle"
            data-stop-count={plannedCount}
            data-total-count={totalItineraryItems}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
              showItinerary
                ? 'bg-gold-500/20 text-gold-300 border-gold-500/40'
                : 'text-white/50 border-white/10 hover:bg-white/5 hover:text-white/70'
            }`}
          >
            <RouteIcon className="w-3.5 h-3.5" />
            My itinerary
            {showItinerary && totalItineraryItems > 0 && (
              <span
                data-testid="map-itinerary-count"
                className="text-gold-400/80"
                aria-hidden="true"
              >
                · {plannedCount} of {totalItineraryItems} {totalItineraryItems === 1 ? 'stop' : 'stops'} shown
              </span>
            )}
          </button>
        </div>

        {/* Schematic-line caveat — an honest passive note, only while the
            itinerary overlay is on (the drawn line is a schematic day-order
            connection between stops, not a routed driving/transit path). */}
        {showItinerary && (
          <p
            data-testid="map-route-caveat"
            className="max-w-md mx-auto mb-4 text-center text-[11px] text-white/35"
          >
            Lines are schematic connections between stops — not driving or transit routes.
          </p>
        )}

        {geoNote && (
          <div
            role="status"
            className="max-w-md mx-auto mb-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60"
          >
            <LocateFixed className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/40" />
            <span>{geoNote}</span>
          </div>
        )}

        {/* Offline stale-tile hint — passive, connectivity-only (useOnline()),
            matching the geoNote banner's calm styling. The service worker caches the map
            tiles; this only reports connectivity, not real cache state. */}
        {!online && (
          <div
            role="status"
            data-testid="map-offline-hint"
            className="max-w-md mx-auto mb-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60"
          >
            <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/40" />
            <span>You&apos;re offline — showing cached map tiles.</span>
          </div>
        )}

        <div className="glass-card rounded-3xl p-3 sm:p-4">
          {/* Inline map slot. The persistent map-host node (mapHostRef, below)
              lives here in normal mode and is relocated into the portaled
              fullscreen shell on expand — see the relocation effect. This slot
              keeps the layout box (definite height) so the card doesn't collapse
              while the host is away in fullscreen. */}
          <div
            ref={inlineSlotRef}
            className="relative w-full h-[560px] sm:h-[600px] rounded-2xl overflow-hidden border border-white/10"
          />

          {/* Legend — color/icon → category. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-5 pt-4 border-t border-white/5">
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

      {/* Persistent map-host node. Rendered exactly ONCE, here at the section
          root, and relocated imperatively (appendChild) between the inline slot
          and the portaled fullscreen slot — so React never reparents it and the
          MapLibre instance inside <TripMap> survives fullscreen toggles.
          className toggles inline (absolute, fills the relative inline slot) vs
          fullscreen (fixed inset-0 → resolves against the VIEWPORT because its
          parent is the body-portaled shell, escaping the glass-card
          backdrop-filter containing block). The fullscreen buttons are direct
          children so they travel with the host and stay clickable in both modes. */}
      <div
        ref={mapHostRef}
        data-testid="map-shell"
        data-visible-count={visibleMarkers.length}
        className={
          isFullscreen
            ? 'fixed inset-0 z-[65] bg-navy-900'
            : 'absolute inset-0'
        }
      >
        <TripMap
          ref={tripMapRef}
          markers={visibleMarkers}
          routeStops={stops}
          onGeoNote={setGeoNote}
          enablePopupFavorite
        />

        {/* Fullscreen toggle (visible on the map, keyboard-accessible). Travels
            with the host, so it stays clickable inline and in fullscreen. */}
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          aria-label={isFullscreen ? 'Exit fullscreen map' : 'Open map fullscreen'}
          aria-pressed={isFullscreen}
          data-testid="map-fullscreen-toggle"
          className="absolute top-3 left-3 z-10 grid place-items-center w-9 h-9 rounded-lg bg-navy-900/80 backdrop-blur border border-white/10 text-white/80 hover:text-white hover:bg-navy-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          {isFullscreen ? (
            <Minimize2 className="w-4 h-4" />
          ) : (
            <Maximize2 className="w-4 h-4" />
          )}
        </button>

        {isFullscreen && (
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-navy-900/80 backdrop-blur border border-white/10 text-white/80 text-xs hover:text-white hover:bg-navy-800 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            <X className="w-4 h-4" />
            Close
          </button>
        )}
      </div>

      {/* Fullscreen portal target: a bare mount point appended to
          document.body. When fullscreen is active the map-host is relocated INTO
          this slot, so its fixed-inset sizing resolves against the viewport
          instead of the glass-card's backdrop-filter containing block. Rendered
          only after mount so the static-export prerender never touches document.
          Kept mounted for the component's whole lifetime (not gated on
          isFullscreen) so React never tears down a slot while the imperatively-
          moved map-host is still inside it — the host relocates back to the
          inline slot first, then this stays as an empty, harmless mount point. */}
      {mounted
        ? createPortal(
            <div ref={fullscreenSlotRef} data-map-fullscreen-slot="" />,
            document.body,
          )
        : null}
    </section>
  );
}
