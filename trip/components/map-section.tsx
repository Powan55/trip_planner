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
  'chip min-h-tap px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60';
const FACET_OFF = 'hover:border-[color:var(--border-ui)] hover:text-ink-hi';

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

/** "Nepal", "Nepal and Japan", "USA, Nepal and Japan" — a plain English list, no Intl needed. */
function visitedCountryLine(countries: readonly string[]): string {
  if (countries.length <= 1) return countries[0] ?? '';
  return `${countries.slice(0, -1).join(', ')} and ${countries[countries.length - 1]}`;
}

// ──: what the map search can resolve ───────────────────────────────────────────────────
// One row shape for THREE in-bundle sources — the 27 curated places, the cities the trip
// actually visits, and the user's own planned stops. `marker` is what the camera flies to, so
// each source is ADAPTED here, at the call site, rather than widening `MapMarker` (which is the
// curated-content type: 27 authored records with images and descriptions, consumed by the
// popup, the favourites store and the guide cards — a city or a plan is none of those things,
// and widening it would push an "is this real content?" branch into every one of them).
//
// 🔴 EVERY `SearchHit` IS IN-BUNDLE DATA. No geocoder, no provider, no network call reaches this
// type — which is why it filters live, on every keystroke, with nothing to wait for.
//
// 🔴 ISSUE #22 CHANGED THE CEILING, NOT THIS PATH. A place that is not in the trip used to be
// unreachable by name at all; it is now reachable through `lib/world-search.ts`, a keyless
// Nominatim lookup that is a SEPARATE state (`world`), rendered in a SEPARATE list, and issued
// ONLY from the submit handler. Two consequences worth stating where someone will read them:
//   • trip places still win — they are computed here, from the bundle, and always render first;
//     a world row naming one of them is dropped (`dropTripDuplicates`).
//   • typing STILL never touches the network. Nominatim's usage policy forbids as-you-type
//     querying, and `e2e/map-trip-mode.spec.ts` pins that: the old test asserted the query never
//     reached the network at all, and now asserts it never reaches it FROM A KEYSTROKE. That is
//     the same tripwire, aimed at the thing that is still forbidden.
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
  /**
   * Issue #1 — the trip date a planned stop belongs to. The route is scoped to the selected
   * day, so flying to this hit has to select its day too, or the pin it targets is not drawn.
   * Absent on curated places and cities, which are browse markers and always on the map.
   */
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
 * The curated pack for the ACTIVE trip: the 27 authored Kathmandu-Valley/Japan places on the
 * default trip, nothing on a custom one.
 *
 * `MAP_MARKERS` is default-pack CONTENT, but `/map/` consumed it as if it were app chrome — and
 * Map is a PRIMARY tab on a custom trip (`primaryItemsForActiveTrip()`), so someone planning Peru
 * opened their Map tab onto Kathmandu and Tokyo, with the camera fitted to Nepal→Japan. Every
 * other N×J surface is gated (`DefaultTripOnly` on /nepal, /japan, /guides, /flights;
 * `defaultTripOnly` in lib/nav-items.ts); this one was missed. Gating the set HERE, where it
 * enters the component, empties the search hits, the saved count and the filter chips with it,
 * and leaves the itinerary overlay — the only trip-real pins — driving the camera.
 *
 * `mounted &&` is the same post-mount storage-read gate `command-palette.tsx` uses for exactly
 * this decision: the trip pointer is localStorage, so it must not be read before mount.
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

  // "Saved" filter — mirrors the guide "Saved" chip idiom
  // (components/recommendation-section.tsx). Same flat gateway-key-14
  // favorites store; map marker ids (`np-*`/`jp-*`) are provably
  // disjoint from guide rec ids (`na#`/`ja#`) so raw ids are reused as-is.
  const { favorites, hydrated: favoritesReady } = useFavorites();
  const [savedOnly, setSavedOnly] = useState(false);
  const online = useOnline();

  // Issue #247 — keep-screen-awake, OFF by default and ONLY held while explicitly toggled
  // on: unlike Travel Mode's Essentials card and the safety phrase card (both bounded,
  // actively-in-hand reads), `/map` is a route someone can leave open in a pocket for a
  // long stretch, so an always-on lock here would drain battery on a trip already rationing
  // it. Persisted the same boolean-as-string way as `legibilityPrefs`/`nightlifeVisible`.
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

  // ── Issue #22 — the WORLD half of the search ────────────────────────────────────────────
  // The trip half above is unchanged and still filters live as you type. This is the fallback
  // underneath it, and it is a SEPARATE, EXPLICIT act: Nominatim's usage policy forbids
  // search-as-you-type outright (see `lib/world-search.ts`), so there is a submit button and
  // there is no effect anywhere that fires a lookup on a query change. That constraint is the
  // reason for the shape, not a limitation of it — the trip search is the one that has to feel
  // instant, and it is in-bundle, so it does.
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
    if (savedOnly) list = list.filter((mk) => favorites.includes(mk.id));
    return list;
  }, [curated, filter, savedOnly, favorites]);

  // Issue #31 — the visited wash. Read ONCE per mount, deliberately: #30's autocount writes the
  // visit record on boot, before this island's chunk has loaded, and nothing else on `/map` can
  // add a visit. A poll or a storage listener here would be machinery for an event that cannot
  // happen while the page is open. This component is `ssr:false`, so the storage read is never
  // a prerender/hydration mismatch. Never filtered by the category chips: the footprint is
  // where you have BEEN, not which restaurants are currently shown.
  const footprints = useMemo(() => visitedCountryFootprints(), []);

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
  //
  // 🔴 ISSUE #1 — SCOPED TO THE SELECTED DAY. Picking a day used to change only the panel
  // below the map while the canvas kept every one of the trip's 32 days drawn, so "select
  // Dec 9" left the Kathmandu plans on screen. The filter is by DATE (`stopsForDay`), and a
  // selected day with nothing planned yields `[]` — which CLEARS the route rather than
  // leaving the last day's pins behind. No day selected still means the whole trip.
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
  //
  // 🔴 ISSUE #1 adds the second half of the same rule: the stop's DAY must be the drawn one.
  // Now that the route is scoped to `selectedDay`, flying to a stop on another day would land
  // the popup on a pin that is not on the canvas AND miss TripMap's `routeStops` lookup —
  // exactly the curated-popup-over-a-centroid failure the paragraph above exists to prevent.
  // So callers pass the stop's date and it becomes the selected day. Switching day changes
  // `stops`, which re-fits the camera, so that case QUEUES too rather than flying into a fit.
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

  // Issue #22 — pick a world result: the camera goes there and the note under the controls says
  // which place is being shown. Deliberately NOT `focusMarker`: there is no marker, and inventing
  // one would print a false country in the popup — see `TripMapHandle.flyToPoint`. The category
  // filter is left alone too; it filters curated markers, and this is not one.
  const selectWorldPlace = (place: WorldPlace) => {
    tripMapRef.current?.flyToPoint(place.lat, place.lng);
    setGeoNote(
      `Showing ${place.displayName}. It isn't part of your trip, so there's no pin for it — the map is just centred there.`,
    );
    closeSearch();
  };

  // (INTAKE-05): a day-order row flies the camera to that stop and opens its popup —
  // the SAME gesture as a search result, via the same imperative handle.
  // a row addresses its GROUP's pin — several plans can share one coordinate and are
  // drawn as a single pin whose popup lists them, so flying to the row's own
  // synthesized marker would land the popup on a pin that was never drawn.
  const flyToRow = (row: PlacementRow) => {
    const stop = stopByItemId.get(row.item.id);
    if (stop) focusStop(stop.marker, stop.date);
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
  // NOTE: FACET / FACET_OFF are declared at module scope below the imports.
  // item with no pin and no curated-marker match isn't silently missing from the count.
  const totalItineraryItems = useMemo(
    () => plans.reduce((sum, p) => sum + (p.items?.length ?? 0), 0),
    [plans],
  );

  // Issue #22 — the ONE sentence the search panel says out loud. It carries the result COUNT
  // (announced by `role="status"` as the trip list filters, and read aloud again when focus lands
  // here after a world search) and, on a failure, the plain-words explanation from the one place
  // those words live. Never a raw error string.
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
      className="py-20 px-4 sm:px-6"
    >
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="map-heading"
          className="mb-8"
          title="Interactive Map"
          subtitle={
            curated.length > 0
              ? 'A real, pannable map of every place across the Kathmandu Valley and Japan. Filter by category, tap a pin for details, or flip on your itinerary to see the plan take shape day by day.'
              : 'A real, pannable map of your trip. Search for anywhere in the world, or flip on your itinerary to see the plan take shape day by day.'
          }
        />

        {/* Category filter chips — the categories belong to the curated pack, so with no curated
            pack there is nothing for them to filter and the whole row goes, wrapper included:
            an empty flex row still spent its `mb-4` on a custom trip. The "Saved" chip inside
            is safe under the same guard — `savedCount` is derived from `curated`, so it is
            already 0 whenever this is. */}
        {curated.length > 0 && (
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
              className="grid h-tap w-tap place-items-center rounded-r1 border-hair border-[color:hsl(var(--border))] text-ink-mid transition-colors hover:border-[color:var(--border-ui)] hover:text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <Search className="w-3.5 h-3.5" aria-hidden="true" />
            </button>

            {searchOpen && (
              <div
                data-testid="map-search-panel"
                className="absolute z-10 top-full mt-2 left-1/2 -translate-x-1/2 w-72 max-w-[85vw] rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low p-2 shadow-lg"
              >
                {/* Issue #22 — a real <form>. Enter submits natively (no key handler of ours),
                    and the submit button is the ONLY thing that ever queries the world: typing
                    filters the trip, submitting adds the world. Nominatim's policy forbids
                    as-you-type querying, so this separation is a requirement, not a preference. */}
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
                    // Disabled only on an EMPTY query, never while the request is in flight:
                    // disabling a focused button blurs it to <body>, and losing the user's place
                    // mid-search is the exact thing the focus handling here exists to prevent.
                    // The in-flight guard lives in `runWorldSearch` instead.
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
                                {/* says WHAT this result is — a curated place ("Boudha,
                                    Kathmandu · Nepal"), a city on the trip, or one of the user's
                                    own plans — so three different kinds of thing don't read as
                                    one undifferentiated list. */}
                                <span className="pr pr--lo block">{hit.source}</span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>

                      {world.phase === 'done' && (
                        <>
                          {/* The world group is a SEPARATE list under its own heading, with its
                              own icon and the data's attribution (ODbL — the same courtesy the
                              basemap's own attribution control pays). A row here is not a place
                              on the trip and never renders as one. */}
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

        {/* schematic-line caveat — an honest passive note, only while the
            itinerary overlay is on (the drawn line is a schematic day-order
            connection between stops, not a routed driving/transit path).
            Issue #1: it also has to say WHICH day is drawn. Scoping the route to one day
            hides the other 31, and a map that quietly shows less than the user thinks it
            does is the same class of defect as copy that claims more (D-271). */}
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

        {/* Issue #31 — the visited wash, IN WORDS. Two jobs, and both are load-bearing.
            (1) The shapes live in a WebGL canvas, so a screen-reader user gets nothing from
            them; this sentence is the whole feature for that user. (2) It says what the shape
            IS. A gold blob over Honshu invites exactly one wrong reading — "that is Japan's
            border" — and `lib/visited-footprint.ts` explains at length why it is not one and
            why no border dataset was added. Copy that let the wrong reading stand would be the
            D-271 defect the route caveat above already exists to avoid. */}
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

        {/* The passive note under the controls. TWO writers now: TripMap's geolocate control
            (`onGeoNote`), and issue #22's world search, which says which off-trip place the
            camera was just centred on. One banner rather than two identical ones — it is the
            same job (a calm, announced sentence about where the map is), and last message wins. */}
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
          {/* Inline map slot. The persistent map-host node (mapHostRef, below)
              lives here in normal mode and is relocated into the portaled
              fullscreen shell on expand — see the relocation effect. This slot
              keeps the layout box (definite height) so the card doesn't collapse
              while the host is away in fullscreen. */}
          <div
            ref={inlineSlotRef}
            className="relative w-full h-[560px] sm:h-[600px] rounded-r1 overflow-hidden border-hair border-[color:hsl(var(--border))]"
          />
          {/* the Legend that used to sit here was deleted. It rendered the same 7
              categories, the same icons and the same CATEGORY_STYLES as the filter chips
              directly above the map — a second row of noise carrying nothing new. */}
        </div>

        {/* ──: day-target strip — pick the day the map shows, and assign pins to it ────
            TWO jobs. Issue #1: tapping a day scopes the drawn route to that day (and opens
            its panel below). And the map is an INPUT to planning: drag a pin's popup handle
            onto a day (desktop pointer) OR use the popup's day <select> + Anchor button
            (keyboard/touch). The dropped/selected pin is added to that day via the existing
            itinerary CRUD and becomes the day's ANCHOR — which, since D-281, is the day's
            BASE POINT (the origin of the per-row distance labels) and re-orders nothing.
            The old "then re-order by client-side haversine distance" wording here described
            behaviour the code has not had since `orderByProximity` was deleted. */}
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
                    // Issue #1: picking a day SHOWS that day. Selecting also turns the
                    // itinerary overlay on — the day's pins are drawn by the overlay, so
                    // without this the gesture would answer "which day?" with an empty
                    // canvas from a cold /map load (the overlay starts off). Deselecting
                    // leaves the overlay alone and the whole trip comes back.
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
                    </span>
                    <span className="pr pr--lo">
                      {formatDate(date).replace(/^[A-Za-z]+,\s*/, '')}
                    </span>
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
                      // Only one honest empty case is left: a day with no plans at all. The
                      // old second branch ("none of this day's N items have a map location")
                      // is now false by construction — under every plan has a position.
                      // The shape of the missing thing, at the size it will be.
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

                          // Issue #224 — distance from the PREVIOUS stop (not the anchor), so a
                          // backtrack (Asakusa → Shibuya → Asakusa) shows up: the anchor-distance
                          // label above reads both Asakusa rows as "near the anchor" alike. Omitted
                          // (not 0, not NaN) when either end has no coordinate, same as the anchor
                          // label's own `p.kind === 'none'` handling.
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
                                </span>
                                <span className="min-w-0 truncate text-ink-hi">
                                  {row.item.title}
                                </span>
                                {approx && (
                                  <span
                                    className="shrink-0 max-w-[45%] truncate font-normal text-ink-mid"
                                    aria-hidden="true"
                                  >
                                    ≈ {p.derivedFrom}
                                  </span>
                                )}
                                {km !== null && (
                                  <span className="num ml-auto shrink-0 text-ink-mid">
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
          parent is the body-portaled shell). The card around the inline slot no
          longer carries a backdrop-filter, so it no longer creates a containing
          block of its own — the portal now guarantees rather than rescues that.
          The fullscreen buttons are direct children so they travel with the host
          and stay clickable in both modes. */}
      <div
        ref={mapHostRef}
        data-testid="map-shell"
        data-visible-count={visibleMarkers.length}
        data-map-view={mapView}
        // Issue #1 — the assertion seam for what is DRAWN. The route lives in a WebGL
        // canvas, so without this there is no observable signal that the map is showing one
        // day (or nothing) rather than the whole trip. Same idiom as `travel-day-map`'s
        // `data-stop-ids`: the ids, not just a count, so a test can tell "the pins changed"
        // from "the pins happen to number the same". `data-route-day` is the date being
        // drawn, empty for the whole trip — the two together separate an EMPTY DAY (a day
        // set, no ids) from an overlay that is simply off (no day, no ids).
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
            // was `top-3 right-3`, which put it ON TOP of MapLibre's top-right
            // control group and won on z-index — MEASURED in a real fullscreen browser:
            // a 27×27 overlap of the 29×29 zoom-in button, and elementFromPoint at that
            // button's centre returned this Close button, i.e. zoom-in was unclickable.
            // Moved beside the fullscreen toggle so the
            // app's own chrome sits together on the left and MapLibre keeps its conventional
            // top-right corner untouched.
            // CLEARANCE, and it moved once already: the toggle was w-9 and ended at ~51px,
            // leaving 8.5px before this button's old `left-14` (59.5px @ the 17px root).
            // Issue #105 grew the toggle to the 44px tap floor, so it now ends at 56.75px
            // and that gap fell to 2.75px — still WCAG 2.5.8-clean (both ≥24px) but visually
            // touching, and this pair has ALREADY caused one unclickable-control bug. `left-16`
            // (68px) restores 11.25px. Recompute this if either control changes width again.
            className="chip absolute top-3 left-16 z-10 min-h-tap bg-surface-low px-2.5 text-ink-hi transition-colors hover:border-[color:var(--text-hi)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="w-4 h-4" aria-hidden="true" />
            Close
          </button>
        )}
      </div>

      {/* Fullscreen portal target: a bare mount point appended to
          document.body. When fullscreen is active the map-host is relocated INTO
          this slot, so its fixed-inset sizing resolves against the viewport and
          cannot be captured by any transform or filter added to the card later.
          Rendered
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
