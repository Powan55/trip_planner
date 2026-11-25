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
  Globe,
  Sun,
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
  stopsForDay,
  tripDayNumber,
  segmentKm,
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
import { isDefaultTrip } from '@/core/trips';
import { cityCoord } from '@/lib/city-coords';
import { legLabel } from '@/lib/leg-label';
import { currentLegMarkers } from '@/lib/map-initial-view';
import { visitedCountryFootprints } from '@/lib/visited-footprint';
import { useFavorites } from '@/hooks/use-favorites';
import { useOnline } from '@/hooks/use-online';
import { TRIP_DATES, formatDate } from '@/lib/trip-data';
import { generateItemId } from '@/lib/item-id';
import { toItineraryDraft } from '@/lib/itinerary-adapter';
import { haversineKm, MAP_PIN_DND_TYPE, type LatLng } from '@/lib/day-anchor';
import { dayAnchorStore, mapWakeLockPrefs } from '@/core/storage/gateway';
import { useWakeLock } from '@/lib/use-wake-lock';
import {
  searchWorldPlaces,
  dropTripDuplicates,
  WORLD_SEARCH_MESSAGES,
  type WorldPlace,
  type WorldSearchFailure,
} from '@/lib/world-search';

type FilterValue = MarkerCategory | 'All';

// The chrome around the canvas. A filter is a `.chip`: STRUCK when it is on, a plain rule
// when it is off. No filter spends an --accent fill — that answers one question only, "what
// is now?", which on this screen is the selected day.
const FACET =
  'chip min-h-tap min-w-tap justify-center px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const FACET_OFF = 'hover:border-[color:var(--border-ui)] hover:text-ink-hi';

// The /map page: filters, itinerary overlay, search, fullscreen and day planning around
// TripMap, which owns the map engine itself.
// One "Day 1 · Tue, Dec 9" option per trip date.
const ASSIGN_DAYS: AssignDayOption[] = TRIP_DATES.map((date, i) => ({
  date,
  label: `Day ${i + 1} · ${formatDate(date)}`,
}));

/** "Nepal", "Nepal and Japan", "USA, Nepal and Japan" — a plain English list, no Intl needed. */
function visitedCountryLine(countries: readonly string[]): string {
  if (countries.length <= 1) return countries[0] ?? '';
  return `${countries.slice(0, -1).join(', ')} and ${countries[countries.length - 1]}`;
}

// Search hits from in-bundle data only (curated places, trip cities, the user's plans), so it
// filters live per keystroke. Each source is adapted here rather than widening MapMarker, which
// is the curated-content type.
// World results (lib/world-search.ts, Nominatim) are a separate list fetched only on submit:
// Nominatim forbids search-as-you-type, and e2e/map-trip-mode.spec.ts checks no keystroke hits
// the network. Trip results render first and win duplicates.
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
  /** A planned stop's date; flying to it selects that day so its pin is drawn. */
  date?: string;
}

const curatedHitsOf = (markers: MapMarker[]): SearchHit[] =>
  markers.map((mk) => ({
    id: mk.id,
    name: mk.name,
    marker: mk,
    source: `${mk.area} · ${mk.country}`,
    haystack: `${mk.name} ${mk.area} ${mk.country}`.toLowerCase(),
  }));

/**
 * Curated places for the sample pack, nothing for a custom trip; gating here empties search,
 * saved count and chips too. Waits for mount because the trip pointer is in localStorage.
 */
function curatedFor(mounted: boolean): MapMarker[] {
  return mounted && !isDefaultTrip() ? [] : MAP_MARKERS;
}

export default function MapSection() {
  const { plans, addItem, findPlacements } = useItineraryContext();

  const [filter, setFilter] = useState<FilterValue>('All');
  const [showItinerary, setShowItinerary] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);

  // Same favorites store as the guides; the id spaces don't overlap.
  const { favorites, hydrated: favoritesReady } = useFavorites();
  const [savedOnly, setSavedOnly] = useState(false);
  const online = useOnline();

  // Keep-awake is opt-in here: /map can sit open in a pocket and drain the battery.
  const [wakeLockOn, setWakeLockOn] = useState(false);
  useEffect(() => {
    const saved = mapWakeLockPrefs.get();
    if (saved !== null) setWakeLockOn(saved);
  }, []);
  const wakeLock = useWakeLock(wakeLockOn);
  const toggleWakeLock = () => {
    const next = !wakeLockOn;
    setWakeLockOn(next);
    mapWakeLockPrefs.set(next);
  };

  // Day planning. `anchors` maps a date to its base-point marker, used for distance labels only.
  // Local-only; the pin itself is added through the normal itinerary write.
  const [anchors, setAnchors] = useState<Record<string, string>>({});
  const [anchorsReady, setAnchorsReady] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  useEffect(() => {
    setAnchors(dayAnchorStore.get<Record<string, string>>({}));
    setAnchorsReady(true);
  }, []);

  // Add the pin to the day if it isn't there yet, then make it the day's anchor.
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
      const dayNo = tripDayNumber(date) ?? 0;
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

  // World search: submit only, never on a query change (Nominatim policy).
  const [world, setWorld] = useState<
    | { phase: 'idle' }
    | { phase: 'searching'; query: string }
    | { phase: 'done'; query: string; places: WorldPlace[] }
    | { phase: 'error'; query: string; kind: WorldSearchFailure }
  >({ phase: 'idle' });
  // Monotonic token for the in-flight lookup. Bumped on submit AND on every keystroke, so a
  // response that lands after the query changed is dropped rather than rendered under text it
  // does not describe — the one race an explicit-submit search still has.
  const worldReqRef = useRef(0);
  // Focus lands here when a search settles: a screen-reader user hears the outcome (the count,
  // or the plain-words failure) instead of being left on a button whose page just changed
  // underneath it, and the results are the next thing in tab order.
  const searchStatusRef = useRef<HTMLParagraphElement | null>(null);

  // Camera as "lng,lat,zoom" in data-map-view, for e2e assertions.
  const [mapView, setMapView] = useState('');

  // Portal mount guard: createPortal(…, document.body) must never
  // run during the static-export prerender (output:'export' has no document).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // TripMap's imperative handle — we call resize() after relocating the host node.
  const tripMapRef = useRef<TripMapHandle | null>(null);
  // Holds the frame the fullscreen-exit cleanup schedules, so unmount can cancel it.
  const exitRafRef = useRef(0);
  useEffect(() => () => cancelAnimationFrame(exitRafRef.current), []);

  // The map lives in one host div that's moved by hand between the inline and fullscreen
  // slots, so the MapLibre instance survives fullscreen toggles.
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const inlineSlotRef = useRef<HTMLDivElement | null>(null);
  const fullscreenSlotRef = useRef<HTMLDivElement | null>(null);
  const fullscreenToggleRef = useRef<HTMLButtonElement | null>(null);
  const wasFullscreenRef = useRef(false);

  // The curated pack, gated on the active trip — see `curatedFor`. Empty on a custom trip, which
  // is what empties every derived count/chip/search hit below.
  const curated = useMemo(() => curatedFor(mounted), [mounted]);
  const curatedHits = useMemo(() => curatedHitsOf(curated), [curated]);
  /** Dedupe guard: a trip city that IS a curated place (e.g. "Hakone") must not list twice.
   *  Derived from `curated`, so with no curated pack a trip city by that name is NOT suppressed. */
  const curatedNames = useMemo(
    () => new Set(curated.map((mk) => mk.name.toLowerCase())),
    [curated],
  );

  // Saved-favorited count across ALL curated markers (not just the active category —
  // mirrors the guide chip's `savedCount`, which cuts across category filters).
  const savedCount = useMemo(
    () => curated.filter((mk) => favorites.includes(mk.id)).length,
    [curated, favorites],
  );

  const visibleMarkers = useMemo(() => {
    let list =
      filter === 'All' ? curated : curated.filter((mk) => mk.category === filter);
    // #564: savedOnly can outlive the last unsaved favorite (the chip that
    // toggles it off disappears with savedCount), so gate on savedCount too.
    if (savedOnly && savedCount > 0) list = list.filter((mk) => favorites.includes(mk.id));
    return list;
  }, [curated, filter, savedOnly, savedCount, favorites]);

  const initialFocus = useMemo(() => currentLegMarkers(visibleMarkers), [visibleMarkers]);

  // Read once: nothing on /map can add a visit while it's open.
  const footprints = useMemo(() => visitedCountryFootprints(), []);

  // Every plan in time order with its placement: exact, approximate (district or city), or none.
  // `allRows` feeds the day panel; `overlayStops` is the deduped pin set.
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

  // Route stops in time order, scoped to the selected day (whole trip if none). An empty day
  // yields [] and clears the route. Empty when the overlay is off.
  const stops = useMemo(
    () => (showItinerary ? stopsForDay(overlayStops, selectedDay) : []),
    [showItinerary, overlayStops, selectedDay],
  );

  // The selected day's rows shown in the day-order panel below the strip — EVERY plan of
  // that day, time-ordered, including the ones whose position was derived.
  const selectedDayRows = useMemo<PlacementRow[]>(
    () => (selectedDay ? allRows.filter((r) => r.date === selectedDay) : []),
    [selectedDay, allRows],
  );

  // Plans per day at an exact (not derived) position.
  const exactCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRows) {
      if (r.placement.kind === 'exact') m.set(r.date, (m.get(r.date) ?? 0) + 1);
    }
    return m;
  }, [allRows]);

  // Total plans per day, the day-strip headline number.
  const itemCountByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plans) m.set(p.date, (m.get(p.date) ?? 0) + (p.items?.length ?? 0));
    return m;
  }, [plans]);

  // The trip's own cities. Exact lookup in the city table; unknown cities are left out, not guessed.
  const cityHits = useMemo<SearchHit[]>(() => {
    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const day of plans) {
      const key = (day.city ?? '').toLowerCase();
      if (!key || seen.has(key) || curatedNames.has(key)) continue;
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
          // not a geographic claim — see core/content/itinerary.ts on Dec 9 / New York.
          country: legLabel(day.country),
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
  }, [plans, curatedNames]);

  // One row per plan, flying to its group's pin (plans sharing a spot share a pin). Title match
  // only, since area would match every plan in the city. Curated places are already listed.
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
        date: row.date,
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
    return [...curatedHits, ...cityHits, ...stopHits].filter((h) => h.haystack.includes(q));
  }, [searchQuery, curatedHits, cityHits, stopHits]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    worldReqRef.current += 1;
    setWorld({ phase: 'idle' });
  };

  // Editing the query invalidates whatever the world lookup was about to say: the results below
  // the box must always describe the text IN the box. It does NOT start a new lookup — see the
  // policy note on the `world` state.
  const onQueryChange = (value: string) => {
    setSearchQuery(value);
    worldReqRef.current += 1;
    if (world.phase !== 'idle') setWorld({ phase: 'idle' });
  };

  // The ONLY caller of the world lookup. A real form submit, so Enter in the box works natively
  // and the button is a plain `type="submit"` — no key handling of our own.
  const runWorldSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query || world.phase === 'searching') return;
    const token = (worldReqRef.current += 1);
    setWorld({ phase: 'searching', query });
    // The trip hits for THIS query, captured now: a world row naming a place the trip already
    // returned is dropped, so the local result stays the only one and stays first.
    const tripNames = searchResults.map((h) => h.name);
    const outcome = await searchWorldPlaces(query);
    if (token !== worldReqRef.current) return; // the query moved on; this answer is stale
    setWorld(
      outcome.status === 'ok'
        ? { phase: 'done', query, places: dropTripDuplicates(outcome.places, tripNames) }
        : { phase: 'error', query, kind: outcome.status },
    );
    // After the DOM has the outcome in it.
    requestAnimationFrame(() => searchStatusRef.current?.focus());
  };

  // Flying to a planned stop. The stop is only drawn with the overlay on and its day selected;
  // otherwise the popup misses and falls back to the curated one. Turning either on refits the
  // camera, so the focus is queued and fired from the effect below, which runs after TripMap's
  // fit (child effects flush first).
  const pendingFocusRef = useRef<MapMarker | null>(null);
  const focusStop = (marker: MapMarker, date?: string) => {
    setFilter('All');
    const dayChanging = date !== undefined && date !== selectedDay;
    if (date !== undefined) setSelectedDay(date);
    if (showItinerary && !dayChanging) {
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
      focusStop(hit.marker, hit.date);
    } else {
      setFilter('All');
      tripMapRef.current?.focusMarker(hit.marker);
    }
    closeSearch();
  };

  // World result: fly there and name it in the note. No marker (see flyToPoint).
  const selectWorldPlace = (place: WorldPlace) => {
    tripMapRef.current?.flyToPoint(place.lat, place.lng);
    setGeoNote(
      `Showing ${place.displayName}. It isn't part of your trip, so there's no pin for it — the map is just centred there.`,
    );
    closeSearch();
  };

  // Targets the row's group pin; the row's own marker is never drawn.
  const flyToRow = (row: PlacementRow) => {
    const stop = stopByItemId.get(row.item.id);
    if (stop) focusStop(stop.marker, stop.date);
  };

  // Move the map host into the right slot, then resize the canvas.
  useEffect(() => {
    const host = mapHostRef.current;
    if (!host) return;
    const target = isFullscreen ? fullscreenSlotRef.current : inlineSlotRef.current;
    // In fullscreen the portal slot mounts in the same commit; if for any reason
    // it isn't attached yet, bail — the next render re-runs this effect.
    if (!target) return;
    if (host.parentElement !== target) {
      // Moving a node blurs whatever inside it had focus; hand it back to the toggle.
      target.appendChild(host);
      if (wasFullscreenRef.current !== isFullscreen) fullscreenToggleRef.current?.focus({ preventScroll: true });
    }
    wasFullscreenRef.current = isFullscreen;
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

  // Fullscreen: scroll lock, Esc, and the exit resize.
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

    // Focus trap: everything else in body goes inert, except live regions (the toaster is a
    // permanent body child) and portals opened after this snapshot.
    const slot = fullscreenSlotRef.current;
    const inerted = Array.from(body.children)
      .filter(
        (el): el is HTMLElement =>
          el instanceof HTMLElement &&
          !el.contains(slot) &&
          !el.matches('[aria-live],[data-react-aria-top-layer]'),
      )
      .map((el) => [el, el.inert] as const);
    for (const [el] of inerted) el.inert = true;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsFullscreen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      for (const [el, was] of inerted) el.inert = was;
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      window.scrollTo(0, scrollY);
      // One more resize after the scroll restore. Reads .current late on purpose: it must hit
      // whichever map is live a frame after cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      exitRafRef.current = requestAnimationFrame(() => tripMapRef.current?.resize());
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
  // NOTE: FACET / FACET_OFF are declared at module scope below the imports.
  // item with no pin and no curated-marker match isn't silently missing from the count.
  const totalItineraryItems = useMemo(
    () => plans.reduce((sum, p) => sum + (p.items?.length ?? 0), 0),
    [plans],
  );

  // The search status line (role="status"): result count, or a plain-words failure.
  const tripHitCount = searchResults.length;
  const tripCountText = `${tripHitCount} ${tripHitCount === 1 ? 'place' : 'places'} on your trip`;
  const searchStatusText =
    world.phase === 'searching'
      ? `Searching the world for “${world.query}”…`
      : world.phase === 'error'
        ? `${tripCountText}. ${WORLD_SEARCH_MESSAGES[world.kind]}`
        : world.phase === 'done'
          ? `${tripCountText}, ${world.places.length} ${
              world.places.length === 1 ? 'place' : 'places'
            } elsewhere in the world.`
          : `${tripCountText}. Search the world for anywhere else.`;

  return (
    <section
      id="map"
      aria-labelledby="map-heading"
      className="py-20 px-4 sm:px-6 max-sm:pt-3 max-sm:pb-10"
    >
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="map-heading"
          className="mb-8 max-sm:sr-only"
          title="Interactive Map"
          subtitle={
            curated.length > 0
              ? 'A real, pannable map of every place across the Kathmandu Valley and Japan. Filter by category, tap a pin for details, or flip on your itinerary to see the plan take shape day by day.'
              : 'A real, pannable map of your trip. Search for anywhere in the world, or flip on your itinerary to see the plan take shape day by day.'
          }
        />

        {/* Category chips, only when there are curated places. */}
        {curated.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2 mb-4 max-sm:mb-2 max-sm:flex-nowrap max-sm:justify-start max-sm:overflow-x-auto max-sm:-mx-4 max-sm:px-4 max-sm:pb-1 max-sm:[&>*]:shrink-0">
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
                // The seven category hexes are frozen, so an ACTIVE category chip keeps its
                // own badge colour and an inactive one is a plain rule.
                className={`${FACET} ${
                  isActive
                    ? value === 'All'
                      ? 'chip--struck'
                      : style!.badge
                    : FACET_OFF
                }`}
              >
                {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
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
              className={`${FACET} ${savedOnly ? 'chip--struck' : FACET_OFF}`}
            >
              <Heart className={`w-3.5 h-3.5 ${savedOnly ? 'fill-current' : ''}`} aria-hidden="true" />
              Saved
              <span className="num text-ink-lo">{savedCount}</span>
            </button>
          )}
        </div>
        )}

        {/* Overlay + search + fullscreen controls. */}
        <div className="flex flex-wrap justify-center items-center gap-2 mb-5 max-sm:mb-3">
          {/* search-within-map: an icon toggle that reveals a small
              client-side search over MAP_MARKERS (name/area/country). */}
          <div className="relative">
            <button
              type="button"
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
              aria-label={searchOpen ? 'Close map search' : 'Search places on map'}
              aria-expanded={searchOpen}
              data-testid="map-search-toggle"
              className="grid h-tap w-tap place-items-center rounded-r1 border-hair border-[color:hsl(var(--border))] text-ink-mid transition-colors hover:border-[color:var(--border-ui)] hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {searchOpen && (
              <div
                data-testid="map-search-panel"
                className="absolute z-10 top-full mt-2 left-1/2 -translate-x-1/2 w-72 max-w-[85vw] rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low p-2 shadow-lg"
              >
                {/* Typing filters the trip; only submit queries the world. */}
                <form onSubmit={runWorldSearch}>
                  <label htmlFor="map-search-input" className="sr-only">
                    Search places on the map
                  </label>
                  <input
                    id="map-search-input"
                    ref={searchInputRef}
                    // Deliberately `text`, not `search`: `type="search"` adds a UA-styled clear
                    // button that does not follow the dark palette, for no behaviour we don't
                    // already have (Escape closes, and the panel clears itself on close).
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closeSearch();
                    }}
                    placeholder="Search places…"
                    data-testid="map-search-input"
                    className="w-full min-h-tap px-2.5 py-1.5 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface text-t-sm text-ink-hi placeholder:text-ink-lo outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  />
                  <button
                    type="submit"
                    // Not disabled in flight: that would blur focus. runWorldSearch guards instead.
                    disabled={!searchQuery.trim()}
                    aria-busy={world.phase === 'searching'}
                    data-testid="map-search-world-submit"
                    className="btn btn--2 max-w-none mt-1.5 w-full outline-none focus-visible:outline-none"
                  >
                    <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                    {world.phase === 'searching' ? 'Searching…' : 'Search the world'}
                  </button>
                </form>

                {searchQuery.trim() && (
                  <>
                    {/* The announced count + the failure sentence, in one node. `role="status"`
                        speaks it as the trip list filters; focus is moved here when a world
                        search settles, so the outcome is heard either way. */}
                    <p
                      ref={searchStatusRef}
                      tabIndex={-1}
                      role="status"
                      data-testid="map-search-status"
                      className="mt-2 px-0.5 text-t-sm text-ink-mid outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-r1"
                    >
                      {searchStatusText}
                    </p>

                    <div className="mt-1.5 max-h-64 overflow-y-auto">
                      {/* TRIP PLACES FIRST, ALWAYS — in the DOM, not just visually. The world
                          list can only ever appear below this one. */}
                      <p
                        id="map-search-trip-heading"
                        className="pr pr--lo px-2.5 pt-0.5 pb-1"
                      >
                        On your trip
                      </p>
                      <ul data-testid="map-search-results" aria-labelledby="map-search-trip-heading">
                        {searchResults.length === 0 ? (
                          <li className="empty px-2.5 py-1.5">
                            Nothing on your trip matches &ldquo;{searchQuery.trim()}&rdquo; yet.
                          </li>
                        ) : (
                          searchResults.map((hit) => (
                            <li key={hit.id}>
                              <button
                                type="button"
                                onClick={() => selectSearchResult(hit)}
                                data-testid={`map-search-result-${hit.id}`}
                                className="w-full text-left min-h-tap flex flex-col justify-center px-2.5 py-1.5 rounded-r1 text-t-sm text-ink-hi hover:bg-[rgb(255_255_255/0.05)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                              >
                                <span className="block font-semibold">{hit.name}</span>
                                {/* What kind of result this is. */}
                                <span className="pr pr--lo block">{hit.source}</span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>

                      {world.phase === 'done' && (
                        <>
                          {/* World results: own list, with ODbL attribution. */}
                          <p
                            id="map-search-world-heading"
                            className="pr pr--lo flex items-center gap-1.5 px-2.5 pt-2.5 pb-1 border-t-hair border-[color:hsl(var(--border))] mt-1.5"
                          >
                            <Globe className="w-3 h-3" aria-hidden="true" />
                            Elsewhere in the world
                            <span className="font-normal normal-case tracking-normal">
                              · OpenStreetMap
                            </span>
                          </p>
                          <ul
                            data-testid="map-search-world-results"
                            aria-labelledby="map-search-world-heading"
                          >
                            {world.places.length === 0 ? (
                              <li className="empty px-2.5 py-1.5">
                                Nothing else in the world matches &ldquo;{world.query}&rdquo;.
                              </li>
                            ) : (
                              world.places.map((place) => (
                                <li key={place.id}>
                                  <button
                                    type="button"
                                    onClick={() => selectWorldPlace(place)}
                                    data-testid={`map-search-result-${place.id}`}
                                    className="w-full text-left min-h-tap flex flex-col justify-center px-2.5 py-1.5 rounded-r1 text-t-sm text-ink-hi hover:bg-[rgb(255_255_255/0.05)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                  >
                                    <span className="block font-semibold">{place.name}</span>
                                    {/* Nominatim's own `display_name`, verbatim — the full
                                        region trail is what tells two same-named places apart. */}
                                    <span className="pr pr--lo block">
                                      {place.displayName}
                                    </span>
                                  </button>
                                </li>
                              ))
                            )}
                          </ul>
                        </>
                      )}
                    </div>
                  </>
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
            className={`${FACET} ${showItinerary ? 'chip--struck' : FACET_OFF}`}
          >
            <RouteIcon className="w-3.5 h-3.5" aria-hidden="true" />
            My itinerary
            {showItinerary && totalItineraryItems > 0 && (
              <span
                data-testid="map-itinerary-count"
                className="num text-ink-lo"
                aria-hidden="true"
              >
                · {exactCount} of {totalItineraryItems} {totalItineraryItems === 1 ? 'plan' : 'plans'} exactly placed
              </span>
            )}
          </button>

          {/* Issue #247 — explicit, OFF-by-default screen-wake-lock toggle. Deliberately NOT
              always-on like the Travel Mode/safety-card locks: this route can sit open
              unattended, so the lock is only held while a traveler has actively asked for it. */}
          <button
            type="button"
            onClick={toggleWakeLock}
            aria-pressed={wakeLockOn}
            data-testid="map-wake-lock-toggle"
            className={`${FACET} ${wakeLockOn ? 'chip--struck' : FACET_OFF}`}
          >
            <Sun className="w-3.5 h-3.5" aria-hidden="true" />
            Keep screen on
          </button>
        </div>

        {wakeLock.supported && wakeLock.held && (
          <p
            data-testid="map-wake-lock-hint"
            className="pr pr--lo max-w-md mx-auto mb-4 -mt-2 text-center normal-case tracking-normal"
          >
            Screen stays awake while this is on — turn it off to save battery.
          </p>
        )}

        {/* The line is schematic, not a route; also says which day is drawn (D-271). */}
        {showItinerary && (
          <p
            data-testid="map-route-caveat"
            className="pr pr--lo max-w-md mx-auto mb-4 text-center normal-case tracking-normal"
          >
            {selectedDay && (
              <>
                Showing Day {tripDayNumber(selectedDay)} only — tap that day again for the
                whole trip.{' '}
              </>
            )}
            Lines are schematic connections between stops — not driving or transit routes.
          </p>
        )}

        {/* The visited wash in words: screen readers get nothing from the canvas, and the
            shapes aren't borders. */}
        {footprints.length > 0 && (
          <p
            data-testid="map-visited-note"
            className="pr pr--lo max-w-md mx-auto mb-4 text-center normal-case tracking-normal"
          >
            Filled in so far: {visitedCountryLine(footprints.map((fp) => fp.country))}. The soft
            gold wash is the ground your visits cover — drawn from the cities you have actually
            been to, not a national border.
          </p>
        )}

        {/* Note from geolocate or world search; last message wins. */}
        {geoNote && (
          <div
            role="status"
            data-testid="map-note"
            className="max-w-md mx-auto mb-4 flex items-start gap-2 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low p-gut py-2 text-t-sm text-ink-mid"
          >
            <LocateFixed className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-lo" aria-hidden="true" />
            <span>{geoNote}</span>
          </div>
        )}

        {/* Offline, pins and route still render; only the cross-origin basemap tiles are
            missing. The copy says exactly that. */}
        {!online && (
          <div
            role="status"
            data-testid="map-offline-hint"
            className="max-w-md mx-auto mb-4 flex items-start gap-2 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low p-gut py-2 text-t-sm text-ink-mid"
          >
            <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ink-lo" aria-hidden="true" />
            <span>
              You&apos;re offline — your pins and route still show, but the map background
              needs a connection.
            </span>
          </div>
        )}

        <div className="rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low p-3 sm:p-4">
          {/* Inline slot; keeps its height while the host is in fullscreen. */}
          <div
            ref={inlineSlotRef}
            className="relative w-full h-[560px] sm:h-[600px] rounded-r1 overflow-hidden border-hair border-[color:hsl(var(--border))]"
          />
          {/* the Legend that used to sit here was deleted. It rendered the same 7
              categories, the same icons and the same CATEGORY_STYLES as the filter chips
              directly above the map — a second row of noise carrying nothing new. */}
        </div>

        {/* Day strip: tap to show a day, or drop a pin on it to make it that day's anchor
            (the base point for distances, D-281). */}
        <div className="mt-6" data-testid="map-day-strip">
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <CalendarPlus className="w-3.5 h-3.5 text-ink-lo" aria-hidden="true" />
            <span className="pr pr--l text-ink-hi">Pick a day, or plan one around a pin</span>
            <span className="pr pr--lo normal-case tracking-normal">
              — tap a day to see just that day, or drag a pin here
            </span>
          </div>
          <ul
            className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 snap-x"
            aria-label="Trip days — activate a day to show only its stops, or drop a map pin onto a day to anchor it"
          >
            {ASSIGN_DAYS.map(({ date }, i) => {
              const exact = exactCountByDate.get(date) ?? 0;
              const planned = itemCountByDate.get(date) ?? 0;
              const anchored = anchorsReady && Boolean(anchors[date]);
              const isSelected = selectedDay === date;
              const isDropTarget = dragOverDate === date;
              const shortDate = formatDate(date).replace(/^[A-Za-z]+,\s*/, '');
              return (
                <li key={date} className="snap-start shrink-0">
                  <button
                    type="button"
                    // Selecting turns the overlay on, since it draws the day's pins.
                    onClick={() => {
                      if (isSelected) {
                        setSelectedDay(null);
                        return;
                      }
                      setSelectedDay(date);
                      setShowItinerary(true);
                    }}
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
                    // stop-count: total plans; mapped-count: exactly placed ones.
                    data-stop-count={planned}
                    data-mapped-count={exact}
                    // Follows the visible text word for word so it contains it (WCAG 2.5.3).
                    aria-label={`Day ${i + 1}, ${shortDate}, ${
                      planned === 0
                        ? 'not yet planned'
                        : `${planned} ${planned === 1 ? 'plan' : 'plans'}, ${exact} exact`
                    }${anchored ? ', anchored' : ''}. ${
                      isSelected
                        ? 'Showing this day on the map — activate to show the whole trip again.'
                        : 'Activate to show only this day on the map. Drop a pin here to anchor it.'
                    }`}
                    // FILLED means committed, UNFILLED means not yet: a day with nothing
                    // planned is drawn HOLLOW at the size it will occupy, never shorter.
                    // The selected day takes the --accent RULE (an inset bar), not a fill.
                    data-mark={planned === 0 ? 'hollow' : 'struck'}
                    className={`flex flex-col items-start gap-0.5 min-w-[92px] min-h-tap px-3 py-2 rounded-r1 border-hair text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
                      isDropTarget
                        ? 'border-[color:hsl(var(--accent))] bg-[rgb(62_216_255/0.10)]'
                        : isSelected
                          ? 'border-[color:hsl(var(--accent))] bg-[rgb(62_216_255/0.10)] shadow-[inset_3px_0_0_hsl(var(--accent))]'
                          : planned === 0
                            ? 'border-dashed border-[color:var(--text-lo)] bg-transparent'
                            : 'border-[color:hsl(var(--border))] bg-surface-low hover:border-[color:var(--border-ui)]'
                    }`}
                  >
                    <span className="pr pr--l flex items-center gap-1 text-ink-hi">
                      Day <span className="num">{i + 1}</span>
                      {anchored && (
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-[color:hsl(var(--accent))]"
                          aria-hidden="true"
                        />
                      )}
                    </span>{' '}
                    <span className="pr pr--lo">{shortDate}</span>{' '}
                    <span className={`pr ${planned === 0 ? 'pr--lo' : ''}`}>
                      {planned === 0 ? (
                        'not yet'
                      ) : (
                        <>
                          <span className="num">{planned}</span> {planned === 1 ? 'plan' : 'plans'}
                          <span className="pr--lo"> · <span className="num">{exact}</span> exact</span>
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
              className="mt-2 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low p-3"
            >
              {(() => {
                const anchorId = anchorsReady ? anchors[selectedDay] : undefined;
                const anchorMarker = anchorId ? MARKER_BY_ID.get(anchorId) : undefined;
                // One source of truth for "which day is this" (issue #1) — the same
                // function the stops themselves are numbered by, so the panel heading and
                // the pins can never disagree.
                const dayNo = tripDayNumber(selectedDay) ?? 0;
                const coord = anchorCoordFor(selectedDay);
                return (
                  <>
                    <p className="pr pr--l text-ink-hi mb-2 flex flex-wrap items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-ink-lo" aria-hidden="true" />
                      Day <span className="num">{dayNo}</span>
                      {anchorMarker ? (
                        // was "ordered by distance from X" — a claim the code no
                        // longer honours. The anchor is the day's base point now.
                        <span className="pr pr--lo normal-case tracking-normal">
                          · distances from{' '}
                          <span className="text-ink-hi">{anchorMarker.name}</span>
                        </span>
                      ) : (
                        <span className="pr pr--lo normal-case tracking-normal">· plans in time order</span>
                      )}
                    </p>
                    {selectedDayRows.length === 0 ? (
                      // Every plan has a position, so the only empty case is no plans.
                      <p data-testid="map-day-order-empty" className="empty-frame empty p-gut py-4 text-center">
                        Not yet planned. Drop a pin onto this day, or anchor one from a
                        popup, and its stops will be ruled in here.
                      </p>
                    ) : (
                      <ol className="list">
                        {selectedDayRows.map((row, idx) => {
                          const p = row.placement;
                          const km =
                            coord && p.kind !== 'none'
                              ? haversineKm(coord, { lat: p.lat, lng: p.lng })
                              : null;
                          const position = `stop ${idx + 1} of ${selectedDayRows.length}, Day ${dayNo}`;
                          const kmText =
                            km === null ? null : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;

                          // From the previous stop, so backtracking shows. Omitted without coordinates.
                          const segFromPrevKm =
                            idx > 0 ? segmentKm(selectedDayRows[idx - 1].placement, p) : null;
                          const segNode = segFromPrevKm !== null && (
                            <div
                              data-testid={`map-day-order-seg-${row.item.id}`}
                              className="pr pr--lo flex items-center gap-1.5 pl-1 pb-1"
                            >
                              <span aria-hidden="true">↕</span>
                              {segFromPrevKm < 1
                                ? `${Math.round(segFromPrevKm * 1000)} m`
                                : `${segFromPrevKm.toFixed(1)} km`}{' '}
                              as the crow flies from previous stop
                            </div>
                          );

                          // no position at all (custom trips only — the default
                          // pack's cities are all in the one city table). Never dropped: the
                          // row stays and offers the fix instead of a fly-to that would lie.
                          if (p.kind === 'none') {
                            return (
                              <li key={row.item.id}>
                                {segNode}
                                <div
                                  data-testid={`map-day-order-stop-${row.item.id}`}
                                  data-placement="none"
                                  data-mark="hollow"
                                  className="w-full flex items-center gap-2 min-h-tap -mx-1 px-1 text-t-sm text-ink-mid"
                                >
                                  <span
                                    className="num grid place-items-center w-5 h-5 shrink-0 rounded-full border-2 border-dashed border-[color:var(--text-lo)] text-ink-lo text-t-micro"
                                    aria-hidden="true"
                                  >
                                    ?
                                  </span>
                                  <span className="hollow min-w-0 truncate">
                                    {row.item.title}
                                  </span>
                                  <a
                                    href="/plan/"
                                    data-testid={`map-day-order-locate-${row.item.id}`}
                                    className="ml-auto shrink-0 rounded-r1 text-ink-mid underline underline-offset-2 hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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
                              {segNode}
                              {/* Keyed by item id: two plans can share a marker. */}
                              <button
                                type="button"
                                onClick={() => flyToRow(row)}
                                data-testid={`map-day-order-stop-${row.item.id}`}
                                data-placement={p.kind}
                                data-via={p.via}
                                data-marker-id={p.marker.id}
                                data-derived-from={approx ? p.derivedFrom : ''}
                                // Opens with the row's visible text in order (WCAG 2.5.3).
                                aria-label={`${idx + 1} ${row.item.title}${approx ? ` ≈ ${p.derivedFrom}` : ''}${
                                  kmText ? ` ${kmText}` : ''
                                }. Show on the map${
                                  approx ? ` — approximate, placed from ${p.derivedFrom}` : ''
                                } — ${position}`}
                                className="w-full flex items-center gap-2 min-h-tap -mx-1 px-1 rounded-r1 text-left text-t-sm text-ink-mid hover:bg-[rgb(255_255_255/0.05)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                              >
                                {/* the approximate marker must survive GREYSCALE, so
                                    it is a SHAPE (hollow ring, no solid core) plus TEXT (the
                                    verbatim source of the coordinate) — never colour alone. */}
                                <span
                                  // Survives greyscale: the approximate mark is a SHAPE (a
                                  // hollow ring, no solid core) plus the words beside it.
                                  className={`num grid place-items-center w-5 h-5 shrink-0 rounded-full text-t-micro ${
                                    approx
                                      ? 'border-2 border-[color:var(--text-lo)] text-ink-lo'
                                      : 'bg-[color:var(--text-hi)] text-[color:rgb(var(--surface))]'
                                  }`}
                                  aria-hidden="true"
                                >
                                  {idx + 1}
                                </span>{' '}
                                <span className="min-w-0 truncate text-ink-hi">
                                  {row.item.title}
                                </span>{' '}
                                {approx && (
                                  <span
                                    className="shrink-0 max-w-[45%] truncate font-normal text-ink-mid"
                                    aria-hidden="true"
                                  >
                                    ≈ {p.derivedFrom}
                                  </span>
                                )}{' '}
                                {kmText && (
                                  <span className="num ml-auto shrink-0 text-ink-mid">{kmText}</span>
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

      {/* The map host, rendered once and moved with appendChild between slots. The
          fullscreen buttons are children so they travel with it. */}
      <div
        ref={mapHostRef}
        data-testid="map-shell"
        role={isFullscreen ? 'dialog' : undefined}
        aria-modal={isFullscreen ? true : undefined}
        aria-label={isFullscreen ? 'Map' : undefined}
        data-visible-count={visibleMarkers.length}
        data-map-view={mapView}
        // What the canvas draws, for tests: the day and the stop ids.
        data-route-day={showItinerary ? (selectedDay ?? '') : ''}
        data-route-stop-ids={stops.map((s) => s.marker.id).join(',')}
        // Issue #31 — the same assertion seam for the visited wash, for the same reason: the
        // shapes are inside a WebGL canvas and nothing else in the DOM proves they are drawn.
        data-visited-countries={footprints.map((fp) => fp.country).join(',')}
        className={
          isFullscreen
            ? 'fixed inset-0 z-[65] bg-surface'
            : 'absolute inset-0'
        }
      >
        <TripMap
          ref={tripMapRef}
          markers={visibleMarkers}
          initialFocus={initialFocus}
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
          countryFills={footprints}
        />

        {/* Fullscreen toggle (visible on the map, keyboard-accessible). Travels
            with the host, so it stays clickable inline and in fullscreen. */}
        <button
          ref={fullscreenToggleRef}
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          aria-label={isFullscreen ? 'Exit fullscreen map' : 'Open map fullscreen'}
          aria-pressed={isFullscreen}
          data-testid="map-fullscreen-toggle"
          className="absolute top-3 left-3 z-10 grid place-items-center h-tap w-tap rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low text-ink-mid transition-colors hover:border-[color:var(--border-ui)] hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            // Left side, beside the fullscreen toggle: top-right covered MapLibre's zoom-in.
            // left-16 leaves ~11px after the 44px toggle; recheck if either width changes.
            className="chip absolute top-3 left-16 z-10 min-h-tap bg-surface-low px-2.5 text-ink-hi transition-colors hover:border-[color:var(--text-hi)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-4 h-4" aria-hidden="true" />
            Close
          </button>
        )}
      </div>

      {/* Fullscreen slot on document.body, so fixed sizing is against the viewport. Mounted
          after hydration and never torn down while the host might be inside it. */}
      {mounted
        ? createPortal(
            <div ref={fullscreenSlotRef} data-map-fullscreen-slot="" />,
            document.body,
          )
        : null}
    </section>
  );
}
