'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
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
  CalendarPlus,
  MapPin,
} from 'lucide-react';
import {
  MAP_MARKERS,
  MARKER_CATEGORIES,
  type MapMarker,
  type MarkerCategory,
} from '@/lib/map-data';
import {
  buildItineraryPlacements,
  placementStops,
  MARKER_BY_ID,
  type DayStop,
  type PlacementRow,
} from '@/lib/itinerary-map';
import TripMap, {
  CATEGORY_STYLES,
  type TripMapHandle,
  type AssignDayOption,
} from '@/components/trip-map';
import { useItineraryContext } from '@/components/itinerary-provider';
import { cityCoord } from '@/lib/city-coords';
import { useFavorites } from '@/hooks/use-favorites';
import { useOnline } from '@/hooks/use-online';
import { TRIP_DATES, formatDate } from '@/lib/trip-data';
import { generateItemId } from '@/lib/item-id';
import { toItineraryDraft } from '@/lib/itinerary-adapter';
import { haversineKm, MAP_PIN_DND_TYPE, type LatLng } from '@/lib/day-anchor';
import { dayAnchorStore } from '@/core/storage/gateway';

type FilterValue = MarkerCategory | 'All';

// ── MapSection: the /map page chrome that re-composes <TripMap> ─────────
// Owns the category filter UI, the itinerary overlay toggle, the fullscreen
// slot-swap, the geolocate note banner, and the
// masthead. ( deleted the legend: it re-rendered the same 7 categories,
// icons and CATEGORY_STYLES the filter chips above the map already carry.)
// The map engine itself (init, style, markers, route, popups,
// reduced-motion) lives in <TripMap>; this component just feeds it the visible
// marker set + the whole-trip route and hosts its surface.
// build the trip-day options offered by the popup's "Anchor to a day" control
// and the day strip below the map. "Day 1 · Tue, Dec 9" — one per TRIP_DATE.
const ASSIGN_DAYS: AssignDayOption[] = TRIP_DATES.map((date, i) => ({
  date,
  label: `Day ${i + 1} · ${formatDate(date)}`,
}));

// ──: what the map search can resolve ───────────────────────────────────────────────────
// One row shape for THREE in-bundle sources — the 27 curated places, the cities the trip
// actually visits, and the user's own planned stops. `marker` is what the camera flies to, so
// each source is ADAPTED here, at the call site, rather than widening `MapMarker` (which is the
// curated-content type: 27 authored records with images and descriptions, consumed by the
// popup, the favourites store and the guide cards — a city or a plan is none of those things,
// and widening it would push an "is this real content?" branch into every one of them).
//
// 🔴: every source is data already in the bundle. There is NO geocoder, no provider, no
// network call anywhere in this path — which is exactly why a place that is NOT in the trip
// does not resolve. That ceiling is deliberate, was chosen by the owner over adding a geocoding
// service, and is pinned by `e2e/map-trip-mode.spec.ts`'s "never reaches the network" test.
interface SearchHit {
  /** Stable row identity (react key + testid). */
  id: string;
  /** The first line: what the user typed at. NOT necessarily `marker.name` — several plans can
   * share one drawn pin, and each of them is its own searchable row. */
  name: string;
  /** The plain-language second line: where this result came from. */
  source: string;
  /** Lowercased text the query is matched against. */
  haystack: string;
  /** The camera target. Curated markers are passed through; cities and stops are adapted. */
  marker: MapMarker;
  /** A planned stop is only DRAWN while the itinerary overlay is on — see focusStop. */
  needsOverlay?: boolean;
}

const CURATED_HITS: SearchHit[] = MAP_MARKERS.map((mk) => ({
  id: mk.id,
  name: mk.name,
  marker: mk,
  source: `${mk.area} · ${mk.country}`,
  haystack: `${mk.name} ${mk.area} ${mk.country}`.toLowerCase(),
}));

/** Dedupe guard: a trip city that IS a curated place (e.g. "Hakone") must not list twice. */
const CURATED_NAMES = new Set(MAP_MARKERS.map((mk) => mk.name.toLowerCase()));

export default function MapSection() {
  const { plans, addItem, findPlacements } = useItineraryContext();

  const [filter, setFilter] = useState<FilterValue>('All');
  const [showItinerary, setShowItinerary] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  // "Saved" filter — mirrors the guide "Saved" chip idiom
  // (components/recommendation-section.tsx). Same flat gateway-key-14
  // favorites store; map marker ids (`np-*`/`jp-*`) are provably
  // disjoint from guide rec ids (`na#`/`ja#`) so raw ids are reused as-is.
  const { favorites, hydrated: favoritesReady } = useFavorites();
  const [savedOnly, setSavedOnly] = useState(false);
  const online = useOnline();

  // ──: map-linked day planning ───────────────────────────────────────────
  // `anchors`: date → the marker id that day is "anchored" to. LOCAL-ONLY presentation
  // state.: the anchor no longer re-orders anything —
  // the day list sorts by TIME like every other surface — it is the day's BASE POINT, the
  // origin of the per-row distance label. The assigned pin itself still rides the existing
  // itinerary CRUD (`addItem`, the ONE synced write). Hydrated once on mount, persisted on
  // every change. `selectedDay` is the day whose stop-list the panel shows; `dragOverDate`
  // highlights a drop target.
  const [anchors, setAnchors] = useState<Record<string, string>>({});
  const [anchorsReady, setAnchorsReady] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  useEffect(() => {
    setAnchors(dayAnchorStore.get<Record<string, string>>({}));
    setAnchorsReady(true);
  }, []);

  // Assign a map pin to a trip day: add it as a stop via the
  // EXISTING itinerary CRUD when it isn't already on that day (ONE vault commit; idempotent
  // re-anchor writes nothing to the vault), then record the local anchor as that day's base
  // point. Both survive reload (the stop in the Vault, the anchor in key 22).
  const assignPinToDay = useCallback(
    (marker: MapMarker, date: string) => {
      const already = findPlacements(marker.id).some((p) => p.date === date);
      if (!already) {
        const draft = toItineraryDraft(marker, 'map');
        addItem(date, {
          id: generateItemId(),
          title: draft.title,
          category: draft.category,
          location: draft.location,
          notes: draft.notes,
          sourceId: draft.sourceId,
          sourceType: draft.sourceType,
        });
      }
      setAnchors((prev) => {
        const next = { ...prev, [date]: marker.id };
        dayAnchorStore.set(next);
        return next;
      });
      setSelectedDay(date);
      const dayNo = TRIP_DATES.indexOf(date) + 1;
      // the old toast promised "stops re-ordered by distance", a behaviour this
      // code no longer has. The anchor now sets the day's base point (the distance labels).
      toast.success(
        already
          ? `Day ${dayNo} re-anchored around ${marker.name}`
          : `Added ${marker.name} to Day ${dayNo} · distances now from here`,
      );
    },
    [addItem, findPlacements],
  );

  // Drop handler for the day strip: read the dragged marker id and assign it.
  const handleDayDrop = useCallback(
    (date: string, markerId: string | null) => {
      setDragOverDate(null);
      if (!markerId) return;
      const marker = MARKER_BY_ID.get(markerId);
      if (marker) assignPinToDay(marker, date);
    },
    [assignPinToDay],
  );

  // search-within-map: client-side filter over ALL curated markers (not just
  // the currently-visible/filtered set) — a plain case-insensitive `includes` over
  // name/area/country, no search library.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // the camera, reflected into the DOM as "lng,lat,zoom" — the same `onViewChange` →
  // `data-map-view` reflection `components/plan-day-map.tsx` already uses, so an E2E can assert
  // that a search result MOVED the camera and moved it to the right place (there is no other
  // observable signal that the camera went anywhere). The string de-dupes its own state, so the
  // moveend stream does not re-render this section on every camera tick.
  const [mapView, setMapView] = useState('');

  // Portal mount guard: createPortal(…, document.body) must never
  // run during the static-export prerender (output:'export' has no document).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // TripMap's imperative handle — we call resize() after relocating the host node.
  const tripMapRef = useRef<TripMapHandle | null>(null);

  // The GL map lives inside a single, persistent host div (`mapHostRef`) that we
  // physically relocate between an inline slot and the portaled fullscreen slot
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

  // /: EVERY itinerary item, in time order, each with its resolved placement —
  // exact (a pin / a curated marker) or approximate (a district or the day's city) or, on a
  // custom trip whose city we don't know, none. Derived from the shared store, so it
  // live-updates on any itinerary:changed fan-out. `allRows` drives the day panel (one row
  // per plan, always); `overlayStops` is the deduped PIN set fed to the map.
  const allRows = useMemo(() => buildItineraryPlacements(plans), [plans]);
  const overlayStops = useMemo(() => placementStops(allRows), [allRows]);
  // Which pin a row flies to: items sharing one coordinate collapse to ONE pin,
  // so a row must fly to its GROUP's pin, not to a marker that was never drawn.
  const stopByItemId = useMemo(() => {
    const m = new Map<string, DayStop>();
    for (const s of overlayStops) for (const it of s.items) m.set(it.id, s);
    return m;
  }, [overlayStops]);

  // Resolve an anchored day's anchor COORD (the marker's lat/lng). Self-healing: a stale
  // anchor id not in the curated marker table yields null → that day is left un-reordered.
  const anchorCoordFor = useCallback(
    (date: string): LatLng | null => {
      const id = anchors[date];
      if (!id) return null;
      const mk = MARKER_BY_ID.get(id);
      return mk ? { lat: mk.lat, lng: mk.lng } : null;
    },
    [anchors],
  );

  // Itinerary route stops fed to TripMap — in TIME order (: one ordering on every
  // surface; `buildItineraryPlacements` sorts, so the drawn day line is chronological),
  // empty when the overlay is off.
  const stops = useMemo(
    () => (showItinerary ? overlayStops : []),
    [showItinerary, overlayStops],
  );

  // The selected day's rows shown in the day-order panel below the strip — EVERY plan of
  // that day, time-ordered, including the ones whose position was derived.
  const selectedDayRows = useMemo<PlacementRow[]>(
    () => (selectedDay ? allRows.filter((r) => r.date === selectedDay) : []),
    [selectedDay, allRows],
  );

  // Per-day EXACT counts — how many of a day's plans sit at a coordinate somebody actually
  // asserted (a pin, or a curated marker), as opposed to one this app derived for them.
  // 🔴: this used to count "mapped" items, which under ladder is now every
  // item — a ratio of N === M always, a number that can no longer fail. Exact-vs-total stays
  // falsifiable and says the honest thing: how much of your plan is really located.
  const exactCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) {
      if (r.placement.kind === 'exact') m.set(r.date, (m.get(r.date) ?? 0) + 1);
    }
    return m;
  }, [allRows]);

  // per-day TOTAL planned items — the honest headline number for the day-strip
  // badge and the day-order empty state. The badge used to render `stopCountByDate`
  // alone, so a day holding 3-6 real plans that the coordinate join could not place
  // read "0 stops" — which a user reads
  // as "I planned nothing", not "the map could not place these". Total is the headline;
  // "N mapped" is the qualifier.
  const itemCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plans) m.set(p.date, (m.get(p.date) ?? 0) + (p.items?.length ?? 0));
    return m;
  }, [plans]);

  // — the cities this trip actually visits, read off the days themselves so a custom trip
  // searches ITS cities, not the default pack's. Coordinates come from the ONE hand-authored
  // city table — exact-key, deliberately not fuzzy. A city the table
  // does not know (a custom trip's free-text city) yields no coordinate, so there is nothing to
  // fly to and it is honestly left out rather than guessed at.
  const cityHits = useMemo<SearchHit[]>(() => {
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const day of plans) {
      const key = (day.city ?? '').toLowerCase();
      if (!key || seen.has(key) || CURATED_NAMES.has(key)) continue;
      const coord = cityCoord(day.city);
      if (!coord) continue;
      seen.add(key);
      const id = `city-${key.replace(/\s+/g, '-')}`;
      hits.push({
        id,
        name: day.city,
        marker: {
          id,
          name: day.city,
          category: 'Attraction',
          // The trip LEG the day belongs to (the same value the rest of the app reads),
          // not a geographic claim — see core/content/itinerary.ts on Dec 9 / Syracuse.
          country: day.country === 'nepal' ? 'Nepal' : 'Japan',
          area: 'A city on your trip',
          description:
            'One of the cities on your itinerary. The map centres on the city itself, not on a single address.',
          lat: coord.latitude,
          lng: coord.longitude,
          x: 0,
          y: 0,
        },
        source: 'A city on your trip',
        haystack: key,
      });
    }
    return hits;
  }, [plans]);

  // — the user's own planned stops, straight off the SAME placement ladder the overlay
  // draws: a runtime projection, never persisted, nothing written back to the
  // item. One row PER PLAN, flying to that plan's GROUP pin (the same `stopByItemId` indirection
  // flyToRow uses) — plans that share a coordinate collapse to one drawn pin, so a row keyed on
  // the pin would have made every plan but the first unsearchable.
  // Matched on the plan's TITLE only: matching a derived stop on its `area` too would return
  // every plan in the city on a one-word query. Plans that resolve to a CURATED marker are
  // skipped — that place is already row 1 of the results, under its real name.
  const stopHits = useMemo<SearchHit[]>(() => {
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const row of allRows) {
      const stop = stopByItemId.get(row.item.id);
      if (!stop || MARKER_BY_ID.has(stop.marker.id)) continue;
      // The same plan title repeated across days at one coordinate ("Breakfast", a nightly
      // hotel check-in) is ONE place to a searcher, so title+coordinate is the identity.
      const key = `${row.item.title.toLowerCase()}|${stop.marker.lat.toFixed(4)},${stop.marker.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        id: `stop-${row.item.id}`,
        name: row.item.title,
        marker: stop.marker,
        // an approximate stop is never presented as an exact location, and it quotes
        // the verbatim text its coordinate came from — the same wording the stop popup uses.
        source:
          row.placement.kind === 'approximate'
            ? `A stop you planned · Approximate — placed from “${row.placement.derivedFrom}”.`
            : 'A stop you planned',
        haystack: row.item.title.toLowerCase(),
        needsOverlay: true,
      });
    }
    return hits;
  }, [allRows, stopByItemId]);

  // + search results — a plain case-insensitive `includes` over the three in-bundle
  // sources (curated places, trip cities, planned stops), never the category-filtered set;
  // empty query = no results shown.
  const searchResults = useMemo<SearchHit[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return [...CURATED_HITS, ...cityHits, ...stopHits].filter((h) => h.haystack.includes(q));
  }, [searchQuery, cityHits, stopHits]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
  };

  // ── Flying to a PLANNED STOP (the one path both callers route through) ──────────────────
  // A stop is drawn by the itinerary overlay, not by the marker layer, so the overlay must be
  // ON: with it off the camera lands a popup over an empty basemap, and TripMap's stop-popup
  // lookup misses (`routeStops` is empty), so a derived pin would render the CURATED popup —
  // Directions to a city centroid, which(b) exists to prevent.
  //
  // 🔴: turning the overlay on ALSO makes TripMap refit the camera to the whole route,
  // which would immediately override a camera move issued in the same tick. So when the
  // overlay has to be switched on, the focus is QUEUED and fired from the effect below:
  // a child's effects flush before its parent's, so TripMap's route fit has already been
  // issued by the time this runs, and the focus wins. (The day-order rows have gone through
  // this same path since and had the same race — one fix, both callers.)
  const pendingFocusRef = useRef<MapMarker | null>(null);
  const focusStop = (marker: MapMarker) => {
    setFilter('All');
    if (showItinerary) {
      tripMapRef.current?.focusMarker(marker);
      return;
    }
    pendingFocusRef.current = marker;
    setShowItinerary(true);
  };
  useEffect(() => {
    const marker = pendingFocusRef.current;
    if (!marker) return;
    pendingFocusRef.current = null;
    tripMapRef.current?.focusMarker(marker);
  }, [stops]);

  // Reset the category filter to 'All' first — the marker must be reachable for
  // the popup to make visual sense — then fly + open via TripMap's
  // imperative handle (ONE camera engine, already reduced-motion aware).
  const selectSearchResult = (hit: SearchHit) => {
    if (hit.needsOverlay) {
      focusStop(hit.marker);
    } else {
      setFilter('All');
      tripMapRef.current?.focusMarker(hit.marker);
    }
    closeSearch();
  };

  // (INTAKE-05): a day-order row flies the camera to that stop and opens its popup —
  // the SAME gesture as a search result, via the same imperative handle.
  // a row addresses its GROUP's pin — several plans can share one coordinate and are
  // drawn as a single pin whose popup lists them, so flying to the row's own
  // synthesized marker would land the popup on a pin that was never drawn.
  const flyToRow = (row: PlacementRow) => {
    const stop = stopByItemId.get(row.item.id);
    if (stop) focusStop(stop.marker);
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
  // the badge counts EXACTLY-placed plans against all plans. "N of M stops shown"
  // died with — every plan is shown now, so that ratio could never fail again.
  const exactCount = useMemo(
    () => allRows.filter((r) => r.placement.kind === 'exact').length,
    [allRows],
  );
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
          title={<>Interactive <span className="text-display-emphasis">Map</span></>}
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
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
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
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                savedOnly
                  ? 'bg-primary/20 text-primary border-primary/40'
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
          {/* search-within-map: an icon toggle that reveals a small
              client-side search over MAP_MARKERS (name/area/country). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-label={searchOpen ? 'Close map search' : 'Search places on map'}
              aria-expanded={searchOpen}
              data-testid="map-search-toggle"
              className="flex items-center justify-center w-8 h-8 rounded-lg text-white/50 border border-white/10 hover:bg-white/5 hover:text-white/70 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
                  className="w-full px-2.5 py-1.5 rounded-lg bg-surface/60 border border-white/10 text-xs text-white placeholder:text-white/30 outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                />
                {searchQuery.trim() && (
                  <ul data-testid="map-search-results" className="mt-1.5 max-h-56 overflow-y-auto">
                    {searchResults.length === 0 ? (
                      <li className="px-2.5 py-1.5 text-xs text-white/35">
                        No places match &ldquo;{searchQuery.trim()}&rdquo;.
                      </li>
                    ) : (
                      searchResults.map((hit) => (
                        <li key={hit.id}>
                          <button
                            type="button"
                            onClick={() => selectSearchResult(hit)}
                            data-testid={`map-search-result-${hit.id}`}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-white/75 hover:bg-white/5 hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                          >
                            <span className="block font-medium">{hit.name}</span>
                            {/* says WHAT this result is — a curated place ("Boudha,
                                Kathmandu · Nepal"), a city on the trip, or one of the user's
                                own plans — so three different kinds of thing don't read as
                                one undifferentiated list. */}
                            <span className="block text-white/55 text-[11px]">{hit.source}</span>
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
            data-stop-count={exactCount}
            data-total-count={totalItineraryItems}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
              showItinerary
                ? 'bg-primary/20 text-primary border-primary/40'
                : 'text-white/50 border-white/10 hover:bg-white/5 hover:text-white/70'
            }`}
          >
            <RouteIcon className="w-3.5 h-3.5" />
            My itinerary
            {showItinerary && totalItineraryItems > 0 && (
              <span
                data-testid="map-itinerary-count"
                className="text-muted-foreground"
                aria-hidden="true"
              >
                · {exactCount} of {totalItineraryItems} {totalItineraryItems === 1 ? 'plan' : 'plans'} exactly placed
              </span>
            )}
          </button>
        </div>

        {/* schematic-line caveat — an honest passive note, only while the
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

        {/* offline connectivity hint — passive, connectivity-only (useOnline()),
            matching the geoNote banner's calm styling. It reports CONNECTIVITY, never
            tile or map availability.
            the engine is precached now, so offline the canvas, the marker circles
            and the day route DO render — what is missing is the basemap imagery, because
            basemaps.cartocdn.com is cross-origin and hits the SW's untouched
            cross-origin passthrough. The wording says exactly that and no more; the old
            "the map needs a connection" now overstates the loss the same way v5.9.2's
            "showing cached map tiles" overstated the win. */}
        {!online && (
          <div
            role="status"
            data-testid="map-offline-hint"
            className="max-w-md mx-auto mb-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60"
          >
            <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/40" />
            <span>
              You&apos;re offline — your pins and route still show, but the map background
              needs a connection.
            </span>
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
          {/* the Legend that used to sit here was deleted. It rendered the same 7
              categories, the same icons and the same CATEGORY_STYLES as the filter chips
              directly above the map — a second row of noise carrying nothing new. */}
        </div>

        {/* ──: day-target strip — assign a pin to a trip day ──────────────
            The map becomes an INPUT to planning: drag a pin's popup handle onto a
            day (desktop pointer) OR use the popup's day <select> + Anchor button
            (keyboard/touch). The dropped/selected pin is added to that day via the
            existing itinerary CRUD and becomes the day's ANCHOR — the day's stops
            then re-order by client-side haversine distance. */}
        <div className="mt-6" data-testid="map-day-strip">
          <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-white/60">
            <CalendarPlus className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            <span>Plan a day around a pin</span>
            <span className="text-white/55 font-normal">
              — drag a pin here, or use a pin&apos;s “Anchor” menu
            </span>
          </div>
          <ul
            className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x"
            aria-label="Trip days — drop a map pin onto a day to anchor it"
          >
            {ASSIGN_DAYS.map(({ date, label }, i) => {
              const exact = exactCountByDate.get(date) ?? 0;
              const planned = itemCountByDate.get(date) ?? 0;
              const anchored = anchorsReady && Boolean(anchors[date]);
              const isSelected = selectedDay === date;
              const isDropTarget = dragOverDate === date;
              return (
                <li key={date} className="snap-start shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedDay(isSelected ? null : date)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                      if (dragOverDate !== date) setDragOverDate(date);
                    }}
                    onDragLeave={() => setDragOverDate((d) => (d === date ? null : d))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id =
                        e.dataTransfer.getData(MAP_PIN_DND_TYPE) ||
                        e.dataTransfer.getData('text/plain');
                      handleDayDrop(date, id || null);
                    }}
                    aria-pressed={isSelected}
                    data-testid={`map-day-target-${date}`}
                    data-anchored={anchored ? 'true' : 'false'}
                    // `data-stop-count` is the day's TOTAL planned items (what the
                    // badge shows).: `data-mapped-count` was "how many the map
                    // could place" — under that is now every one of them, so it now
                    // counts the EXACTLY-placed ones, which is still able to fail.
                    data-stop-count={planned}
                    data-mapped-count={exact}
                    aria-label={`${label}, ${
                      planned === 0
                        ? 'nothing planned yet'
                        : `${planned} ${planned === 1 ? 'plan' : 'plans'}, ${exact} exact`
                    }${
                      anchored ? ', anchored' : ''
                    }. Drop a pin to anchor this day, or view its stops.`}
                    className={`flex flex-col items-start gap-0.5 min-w-[92px] min-h-[44px] px-3 py-2 rounded-xl border text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                      isDropTarget
                        ? 'border-ring bg-primary/20 ring-2 ring-ring/50'
                        : isSelected
                          ? 'border-ring/50 bg-primary/10 text-primary'
                          : 'border-white/10 bg-white/5 text-white/70 hover:bg-white/10'
                    }`}
                  >
                    <span className="flex items-center gap-1 text-[11px] font-semibold">
                      Day {i + 1}
                      {anchored && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="text-[10px] text-white/60">
                      {formatDate(date).replace(/^[A-Za-z]+,\s*/, '')}
                    </span>
                    <span className="text-[10px] text-white/55 font-mono">
                      {planned === 0 ? (
                        'no plans'
                      ) : (
                        <>
                          {planned} {planned === 1 ? 'plan' : 'plans'}
                          <span className="text-white/40"> · {exact} exact</span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Day panel for the selected day.: rows are in TIME order, always —
              the anchor no longer re-orders anything, it is the origin of the distance
              labels. Every plan gets a row; an approximate one says so. */}
          {selectedDay && (
            <div
              data-testid="map-day-order"
              data-anchored={anchorsReady && anchors[selectedDay] ? 'true' : 'false'}
              className="mt-2 glass-card rounded-2xl p-3 border border-white/10"
            >
              {(() => {
                const anchorId = anchorsReady ? anchors[selectedDay] : undefined;
                const anchorMarker = anchorId ? MARKER_BY_ID.get(anchorId) : undefined;
                const dayNo = TRIP_DATES.indexOf(selectedDay) + 1;
                const coord = anchorCoordFor(selectedDay);
                return (
                  <>
                    <p className="text-xs font-medium text-white/70 mb-2 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                      Day {dayNo}
                      {anchorMarker ? (
                        // was "ordered by distance from X" — a claim the code no
                        // longer honours. The anchor is the day's base point now.
                        <span className="text-white/60 font-normal">
                          · distances from{' '}
                          <span className="text-foreground">{anchorMarker.name}</span>
                        </span>
                      ) : (
                        <span className="text-white/55 font-normal">· plans in time order</span>
                      )}
                    </p>
                    {selectedDayRows.length === 0 ? (
                      // Only one honest empty case is left: a day with no plans at all. The
                      // old second branch ("none of this day's N items have a map location")
                      // is now false by construction — under every plan has a position.
                      <p data-testid="map-day-order-empty" className="text-[11px] text-white/55 py-1">
                        Nothing planned for this day yet — drop a pin here to start.
                      </p>
                    ) : (
                      <ol className="space-y-1">
                        {selectedDayRows.map((row, idx) => {
                          const p = row.placement;
                          const km =
                            coord && p.kind !== 'none'
                              ? haversineKm(coord, { lat: p.lat, lng: p.lng })
                              : null;
                          const position = `stop ${idx + 1} of ${selectedDayRows.length}, Day ${dayNo}`;

                          // no position at all (custom trips only — the default
                          // pack's cities are all in the one city table). Never dropped: the
                          // row stays and offers the fix instead of a fly-to that would lie.
                          if (p.kind === 'none') {
                            return (
                              <li key={row.item.id}>
                                <div
                                  data-testid={`map-day-order-stop-${row.item.id}`}
                                  data-placement="none"
                                  className="w-full flex items-center gap-2 min-h-[44px] -mx-1 px-1 text-[11px] text-white/70"
                                >
                                  <span
                                    className="grid place-items-center w-5 h-5 shrink-0 rounded-full border border-dashed border-white/35 text-white/50 font-mono text-[10px]"
                                    aria-hidden="true"
                                  >
                                    ?
                                  </span>
                                  <span className="min-w-0 truncate text-white/80">
                                    {row.item.title}
                                  </span>
                                  <a
                                    href="/plan/"
                                    data-testid={`map-day-order-locate-${row.item.id}`}
                                    className="ml-auto shrink-0 rounded text-white/60 underline underline-offset-2 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                  >
                                    No location yet — set one
                                  </a>
                                </div>
                              </li>
                            );
                          }

                          const approx = p.kind === 'approximate';
                          return (
                            <li key={row.item.id}>
                              {/* (INTAKE-05): a real <button>, not a click handler on the
                                  <li> — native Enter/Space, native focus, 44px tap target. The
                                  fly/zoom/popup engine is TripMap's existing focusMarker (which
                                  already branches on prefers-reduced-motion); this only calls it.
                                  keyed and testid'd by the ITEM id — two plans can share a
                                  marker, and a marker-keyed row duplicated both. */}
                              <button
                                type="button"
                                onClick={() => flyToRow(row)}
                                data-testid={`map-day-order-stop-${row.item.id}`}
                                data-placement={p.kind}
                                data-via={p.via}
                                data-marker-id={p.marker.id}
                                data-derived-from={approx ? p.derivedFrom : ''}
                                aria-label={
                                  approx
                                    ? `Show ${row.item.title} on the map — approximate, placed from ${p.derivedFrom} — ${position}`
                                    : `Show ${row.item.title} on the map — ${position}`
                                }
                                className="w-full flex items-center gap-2 min-h-[44px] -mx-1 px-1 rounded-lg text-left text-[11px] text-white/70 hover:bg-white/5 hover:text-white transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                              >
                                {/* the approximate marker must survive GREYSCALE, so
                                    it is a SHAPE (hollow ring, no solid core) plus TEXT (the
                                    verbatim source of the coordinate) — never colour alone. */}
                                <span
                                  className={`grid place-items-center w-5 h-5 shrink-0 rounded-full font-mono text-[10px] ${
                                    approx
                                      ? 'border border-white/45 text-white/70'
                                      : 'bg-muted text-foreground'
                                  }`}
                                  aria-hidden="true"
                                >
                                  {idx + 1}
                                </span>
                                <span className="min-w-0 truncate text-white/80">
                                  {row.item.title}
                                </span>
                                {approx && (
                                  <span
                                    className="shrink-0 max-w-[45%] truncate font-normal text-white/55"
                                    aria-hidden="true"
                                  >
                                    ≈ {p.derivedFrom}
                                  </span>
                                )}
                                {km !== null && (
                                  <span className="ml-auto shrink-0 font-mono text-white/55">
                                    {km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}
                                  </span>
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </>
                );
              })()}
            </div>
          )}
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
        data-map-view={mapView}
        className={
          isFullscreen
            ? 'fixed inset-0 z-[65] bg-surface'
            : 'absolute inset-0'
        }
      >
        <TripMap
          ref={tripMapRef}
          markers={visibleMarkers}
          routeStops={stops}
          onGeoNote={setGeoNote}
          onViewChange={(v) =>
            setMapView(`${v.lng.toFixed(4)},${v.lat.toFixed(4)},${v.zoom.toFixed(2)}`)
          }
          enablePopupFavorite
          enableDayAssign
          enableStopPopup
          assignDays={ASSIGN_DAYS}
          onAssignDay={assignPinToDay}
        />

        {/* Fullscreen toggle (visible on the map, keyboard-accessible). Travels
            with the host, so it stays clickable inline and in fullscreen. */}
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          aria-label={isFullscreen ? 'Exit fullscreen map' : 'Open map fullscreen'}
          aria-pressed={isFullscreen}
          data-testid="map-fullscreen-toggle"
          className="absolute top-3 left-3 z-10 grid place-items-center w-9 h-9 rounded-lg bg-surface/80 backdrop-blur border border-white/10 text-white/80 hover:text-white hover:bg-surface-raised transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            // was `top-3 right-3`, which put it ON TOP of MapLibre's top-right
            // control group and won on z-index — MEASURED in a real fullscreen browser:
            // a 27×27 overlap of the 29×29 zoom-in button, and elementFromPoint at that
            // button's centre returned this Close button, i.e. zoom-in was unclickable.
            // Moved beside the fullscreen toggle (top-3 left-3, w-9 → ends at ~51px) so the
            // app's own chrome sits together on the left and MapLibre keeps its conventional
            // top-right corner untouched.
            className="absolute top-3 left-14 z-10 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface/80 backdrop-blur border border-white/10 text-white/80 text-xs hover:text-white hover:bg-surface-raised transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
