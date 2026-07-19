'use client';

// The maplibre-gl base stylesheet (positions the canvas, controls, popups). A
// static side-effect import so Next/webpack bundles it with THIS component — and
// since TripMap is only ever loaded via dynamic(ssr:false) from its host islands
//, the CSS ships only on those routes.
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Landmark,
  UtensilsCrossed,
  Hotel,
  Camera,
  Bus,
  ShoppingBag,
  Sparkles,
  MapPin,
  Navigation,
  Heart,
  CalendarPlus,
  type LucideIcon,
} from 'lucide-react';
import { type MapMarker, type MarkerCategory } from '@/lib/map-data';
import { buildMapStyle, CATEGORY_COLOR, BRAND } from '@/lib/map-style';
import { buildMapsDirectionsUrl } from '@/lib/maps-link';
import { MARKER_BY_ID, type DayStop } from '@/lib/itinerary-map';
import { MAP_PIN_DND_TYPE } from '@/lib/day-anchor';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';
import { useFavorites } from '@/hooks/use-favorites';

// maplibre-gl is imported for its TYPES only at module scope; the real runtime
// module is loaded LAZILY (dynamic import) inside the init effect so it never
// lands on the route's first-load bundle (it is ~200 kB gzip).. See below.
import type {
  Map as MLMap,
  Popup as MLPopup,
  GeoJSONSource,
  MapGeoJSONFeature,
  LngLatBoundsLike,
} from 'maplibre-gl';

// The maplibre-gl runtime namespace (named exports; no default export). Aliased
// for the lazy-loaded module and the popup helper.
type MapLibreNS = typeof import('maplibre-gl');

// ── Category presentation (icon + Tailwind classes), unchanged vocabulary ─────
// Kept from the prior mock so the legend, filter chips, and popup badges stay in
// visual sync with the palette. The GL marker fills come from CATEGORY_COLOR
// (raw hex, in lib/map-style.ts) — same colors, different consumer. Exported so
// the /map chrome (filter chips + legend, in MapSection) shares the same table.
export const CATEGORY_STYLES: Record<
  MarkerCategory,
  { icon: LucideIcon; pin: string; badge: string }
> = {
  Attraction: {
    icon: Landmark,
    pin: 'bg-gold-500 text-surface',
    badge: 'bg-gold-500/20 text-gold-400 border-gold-500/30',
  },
  Restaurant: {
    icon: UtensilsCrossed,
    pin: 'bg-himalaya-500 text-white',
    badge: 'bg-himalaya-500/20 text-himalaya-400 border-himalaya-500/30',
  },
  Hotel: {
    icon: Hotel,
    pin: 'bg-indigo-500 text-white',
    badge: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  },
  'Photo Spot': {
    icon: Camera,
    pin: 'bg-purple-500 text-white',
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  },
  'Day Trip': {
    icon: Bus,
    pin: 'bg-cyan-500 text-surface',
    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  },
  Shopping: {
    icon: ShoppingBag,
    pin: 'bg-sakura-500 text-white',
    badge: 'bg-sakura-500/20 text-sakura-300 border-sakura-500/30',
  },
  Cultural: {
    icon: Sparkles,
    pin: 'bg-amber-500 text-surface',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  },
};

const MARKERS_SOURCE_ID = 'markers';
const ITIN_SOURCE_ID = 'itinerary-route';

// World bounds covering both countries (Nepal → Japan), used for the default
// fit-on-load so both regions are reachable on zoom-out.
const ALL_BOUNDS: LngLatBoundsLike = [
  [83.0, 27.0], // SW (west of Kathmandu Valley)
  [141.0, 36.5], // NE (east of Tokyo)
];

// Read prefers-reduced-motion at call time. MapLibre camera moves branch
// on this: flyTo/easeTo when motion is allowed, instant jumpTo when reduced.
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Build the GeoJSON FeatureCollection for the browse markers (the given set).
function markersToGeoJSON(markers: MapMarker[]) {
  return {
    type: 'FeatureCollection' as const,
    features: markers.map((mk) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [mk.lng, mk.lat] },
      properties: {
        id: mk.id,
        name: mk.name,
        category: mk.category,
        color: CATEGORY_COLOR[mk.category],
      },
    })),
  };
}

// ── Popup content (React, portaled into the MapLibre popup node) ──────────────
// Rendered via createPortal so it stays in TripMap's React tree (context flows
// → AddToPlanButton works) while its DOM lives inside the in-canvas Popup.
// `enableFavorite` gates the heart to the curated-place context only
// (MapSection passes it; /plan's day-map does not). `useFavorites()` here is
// the same flat gateway-key-14 store the guide cards use — raw
// `marker.id` (`np-*`/`jp-*`) is provably disjoint from guide rec ids
// (`na#`/`ja#`), so no namespacing is needed (see the id-disjointness guard
// in lib/__tests__/use-favorites.test.ts).
// a trip day option offered in the popup's "Anchor to a day" control.
export interface AssignDayOption {
  date: string;
  /** e.g. "Day 1 · Tue, Dec 9". */
  label: string;
}

function MarkerPopupContent({
  marker,
  enableFavorite,
  enableDayAssign,
  assignDays,
  onAssignDay,
}: {
  marker: MapMarker;
  enableFavorite?: boolean;
  enableDayAssign?: boolean;
  assignDays?: AssignDayOption[];
  onAssignDay?: (marker: MapMarker, date: string) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const [assignDate, setAssignDate] = useState<string>(assignDays?.[0]?.date ?? '');
  const { isFavorite, toggle, hydrated } = useFavorites();
  const style = CATEGORY_STYLES[marker.category];
  const Icon = style.icon;
  const favorited = isFavorite(marker.id);
  return (
    <div className="w-[248px] max-w-[80vw]">
      {marker.image && !imgError && (
        <div className="relative -mx-3 -mt-3 mb-3 aspect-[16/9] overflow-hidden rounded-t-xl bg-surface-raised">
          <OptimizedImage
            src={marker.image}
            alt={marker.name}
            fill
            sizes="248px"
            className="object-cover"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-surface/80 to-transparent" />
        </div>
      )}
      <div className="flex items-start gap-2.5">
        <div
          className={`shrink-0 grid place-items-center w-8 h-8 rounded-lg ${style.pin}`}
        >
          <Icon className="w-4 h-4" strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <h3 className="font-display font-bold text-white text-sm leading-tight">
              {marker.name}
            </h3>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded-full border ${style.badge}`}
            >
              {marker.category}
            </span>
          </div>
          {/* `/40`→`/55` — axe
              caught this pre-existing AA contrast fail (3.72:1) once a real E2E
              scanned the popup with content OPEN for the first time (the earlier
              /map axe pack never opens a popup, so this was never exercised). */}
          <p className="flex items-center gap-1 text-[11px] text-white/55 mb-1.5">
            <MapPin className="w-3 h-3" />
            {marker.area} · {marker.country}
          </p>
        </div>
        {enableFavorite && hydrated && (
          <button
            type="button"
            onClick={() => toggle(marker.id)}
            aria-pressed={favorited}
            aria-label={favorited ? `Remove ${marker.name} from saved` : `Save ${marker.name}`}
            data-testid={`map-popup-favorite-${marker.id}`}
            className={`ml-auto shrink-0 p-1.5 rounded-lg border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
              favorited
                ? 'bg-gold-500/15 border-gold-400/40 text-gold-300 hover:bg-gold-500/25'
                : 'bg-white/5 border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorited ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
      <p className="text-xs text-white/60 leading-relaxed mt-1.5">
        {marker.description}
      </p>
      <a
        href={buildMapsDirectionsUrl(marker.lat, marker.lng)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="map-popup-directions"
        className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-gold-400 hover:text-gold-300 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 rounded"
      >
        <Navigation className="w-3.5 h-3.5" strokeWidth={2.5} />
        Directions
      </a>
      <AddToPlanButton
        source={marker}
        sourceType="map"
        accentColor={
          marker.country === 'Nepal' ? 'text-himalaya-400' : 'text-sakura-400'
        }
      />

      {/* "Anchor to a day" — assign this pin to a trip day so that day's stops
          re-order by distance from it. THREE equivalent affordances (a11y floor):
          the day <select> + Assign button is the keyboard AND touch path (HTML5 drag
          never fires on touch); the drag handle is a desktop-pointer convenience that
          drops onto the day strip (map-section.tsx). enableDayAssign gates the whole
          block to /map — /plan's day-map omits it (like enablePopupFavorite). */}
      {enableDayAssign && assignDays && assignDays.length > 0 && (
        <div
          data-testid={`map-popup-assign-${marker.id}`}
          className="mt-2 pt-2 border-t border-white/10"
        >
          <div className="flex items-stretch gap-1.5">
            {/* Desktop-pointer drag handle (drops onto the day strip). Hidden from the
                a11y tree — the select+button below is the equivalent, keyboard/touch path. */}
            <span
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(MAP_PIN_DND_TYPE, marker.id);
                e.dataTransfer.setData('text/plain', marker.name);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              data-testid={`map-popup-drag-${marker.id}`}
              aria-hidden="true"
              title="Drag onto a day below to anchor it"
              className="hidden sm:grid place-items-center w-7 shrink-0 rounded-lg bg-white/5 border border-white/10 text-gold-400/70 cursor-grab active:cursor-grabbing hover:bg-white/10 hover:text-gold-300 transition-colors"
            >
              <CalendarPlus className="w-3.5 h-3.5" />
            </span>
            <label htmlFor={`assign-day-${marker.id}`} className="sr-only">
              Anchor a day around {marker.name}: choose a trip day
            </label>
            <select
              id={`assign-day-${marker.id}`}
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              data-testid={`map-popup-assign-select-${marker.id}`}
              className="min-w-0 flex-1 px-2 py-1.5 rounded-lg bg-surface/60 border border-white/10 text-[11px] text-white outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
            >
              {assignDays.map((d) => (
                <option key={d.date} value={d.date} className="bg-surface text-white">
                  {d.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => assignDate && onAssignDay?.(marker, assignDate)}
              data-testid={`map-popup-assign-confirm-${marker.id}`}
              aria-label={`Anchor a day around ${marker.name}`}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gold-500/15 border border-gold-400/40 text-gold-300 text-[11px] font-medium hover:bg-gold-500/25 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60"
            >
              Anchor
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Imperative handle the host chrome holds — used to force a canvas resize after
// the host node is physically relocated (fullscreen enter/exit lives in the
// parent; the map instance lives here, so the parent asks us to resize).
export interface TripMapHandle {
  resize: () => void;
  /**
   * search-within-map seam: fly the camera to `marker` (reduced-motion-aware
   * — instant jump vs animated flyTo, mirroring the camera behavior already used
   * for fitBounds/cluster-expand) then open its popup via the existing
   * `openPopup`. The host is responsible for making the marker reachable first
   * — the popup
   * itself opens regardless, since it addresses the marker by lat/lng, not by a
   * rendered map feature.
   */
  focusMarker: (marker: MapMarker) => void;
}

export interface TripMapProps {
  /**
   * Curated markers to plot + cluster. /map passes the category-filtered set;
   * /plan passes a single day's subset. Changing this re-sets the source
   * (and, when `fitBounds`, re-fits the camera). Marker visibility is fully
   * determined by this array — an open popup whose marker leaves the set closes.
   */
  markers: MapMarker[];
  /**
   * Ordered itinerary stops → the day-grouped route polyline + numbered stops.
   * Empty/undefined = no route drawn. /map passes the whole trip's stops when
   * "My itinerary" is on; /plan passes one day and re-draws live on reorder
   * (a prop change re-runs `setData` — cheap; no ITINERARY_CHANGED wiring here).
   */
  routeStops?: DayStop[];
  /**
   * Fired on an unclustered marker click, in addition to opening the popup.
   * seam: /plan highlights the matching itinerary stop. /map omits it.
   */
  onMarkerClick?: (marker: MapMarker) => void;
  /**
   * seam: marker id to visually EMPHASIZE (marker↔stop highlight). Consumed
   * below by a `setPaintProperty` effect that fattens/gilds the matching browse
   * marker + numbered route-stop. `undefined` (the /map case) leaves the effect a
   * strict no-op, so /map stays byte-identical; `/plan` passes `string | null`.
   */
  highlightId?: string | null;
  /**
   * seam: fired on every camera settle (`moveend`) + once on load, with the
   * current center/zoom. `/plan` reflects it so an E2E can prove a reorder does
   * NOT move the camera; `/map` omits it (the listener's optional-chain no-ops).
   */
  onViewChange?: (view: { lng: number; lat: number; zoom: number }) => void;
  /**
   * seam: fired once the GL canvas is ready (style loaded, layers added). The
   * /plan host uses it to gate its fit-then-release so the FIRST fit runs against a
   * live map (the maplibre load is async — a wall-clock release races it). Inert on /map.
   */
  onReady?: () => void;
  /**
   * Auto-fit the camera to `markers` (and to `routeStops` on change). Default
   * true — /map fits on filter/overlay change. can pass false to hold the
   * camera still on reorder.
   */
  fitBounds?: boolean;
  /**
   * Surface the geolocate permission/error note to the host chrome (which owns
   * where the banner renders). Called with a message on error, `null` on success.
   */
  onGeoNote?: (note: string | null) => void;
  /**
   * show a favorite/save heart in the popup (`MarkerPopupContent`).
   * Default undefined/false. /map's `MapSection` passes `true` (curated
   * places only); `/plan`'s day-map omits it, so the heart never
   * shows there — the itinerary-derived day markers stay out of the
   * favorites store entirely.
   */
  enablePopupFavorite?: boolean;
  /**
   * show the "Anchor to a day" control in the marker popup (`MarkerPopupContent`).
   * Default undefined/false. /map's `MapSection` passes `true` + the trip-day options +
   * the assign callback; `/plan`'s day-map omits it, so the control never renders
   * there. `onAssignDay` fires with (marker, dateISO) on the popup's Assign button.
   */
  enableDayAssign?: boolean;
  assignDays?: AssignDayOption[];
  onAssignDay?: (marker: MapMarker, date: string) => void;
}

// ── TripMap: the reusable MapLibre engine ─────────────────────────────────────
// Owns the container, lazy maplibre-gl load, style/controls, the browse-marker
// source/layers, the itinerary route source/layers, popups, and reduced-motion
// camera behavior. It renders ONLY the map surface (canvas container + loading
// skeleton); the host wrapper, fullscreen slot-swap, filters, and legend are the
// consumer's chrome (see MapSection).: the maplibre runtime stays a lazy
// chunk — the dynamic import below is the only entry point to it.
const TripMap = forwardRef<TripMapHandle, TripMapProps>(function TripMap(
  {
    markers,
    routeStops,
    onMarkerClick,
    highlightId,
    fitBounds = true,
    onGeoNote,
    onViewChange,
    onReady,
    enablePopupFavorite,
    enableDayAssign,
    assignDays,
    onAssignDay,
  },
  ref,
) {
  const [mapReady, setMapReady] = useState(false);
  // The marker whose popup is currently open — drives the React portal content.
  const [popupMarker, setPopupMarker] = useState<MapMarker | null>(null);
  // The DOM node inside the open popup that we portal React content into.
  const [popupNode, setPopupNode] = useState<HTMLElement | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<MLPopup | null>(null);
  // The resolved maplibre-gl runtime module — stashed once the lazy
  // import in the init effect resolves, so imperative callers (focusMarker)
  // can reuse `openPopup` without re-importing or threading the module through
  // every call site.
  const mapLibreRef = useRef<MapLibreNS | null>(null);

  // Latest-value refs for props read inside the once-only init effect / stable
  // click handlers, so those closures never go stale without re-initializing GL.
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onGeoNoteRef = useRef(onGeoNote);
  onGeoNoteRef.current = onGeoNote;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Open (or move) the in-canvas popup for a marker, and expose its content node
  // so React can portal the interactive content in.
  const openPopup = useCallback((maplibregl: MapLibreNS, marker: MapMarker) => {
    const map = mapRef.current;
    if (!map) return;
    // Reuse a single Popup instance.
    let popup = popupRef.current;
    if (!popup) {
      popup = new maplibregl.Popup({
        closeButton: true,
        closeOnClick: true,
        maxWidth: '272px',
        className: 'njp-map-popup',
      });
      popup.on('close', () => {
        setPopupMarker(null);
        setPopupNode(null);
      });
      popupRef.current = popup;
    }
    const holder = document.createElement('div');
    popup.setLngLat([marker.lng, marker.lat]).setDOMContent(holder).addTo(map);
    setPopupNode(holder);
    setPopupMarker(marker);
    if (!prefersReducedMotion()) {
      map.easeTo({ center: [marker.lng, marker.lat], duration: 400 });
    }
  }, []);

  // search-within-map: fly the camera to `marker` then open its popup.
  // Reduced-motion: jumpTo (instant) + open immediately, mirroring the
  // fitBounds/cluster-expand branch above. Otherwise: flyTo, then open once the
  // camera settles (`moveend`) — openPopup's own easeTo is then a no-op-sized
  // nudge since the camera is already centered on the marker.
  const focusMarker = useCallback(
    (marker: MapMarker) => {
      const map = mapRef.current;
      const maplibregl = mapLibreRef.current;
      if (!map || !maplibregl) return;
      const zoom = Math.max(map.getZoom(), 12);
      if (prefersReducedMotion()) {
        map.jumpTo({ center: [marker.lng, marker.lat], zoom });
        openPopup(maplibregl, marker);
      } else {
        map.flyTo({ center: [marker.lng, marker.lat], zoom, duration: 900 });
        map.once('moveend', () => openPopup(maplibregl, marker));
      }
    },
    [openPopup],
  );

  // Expose resize() + focusMarker() to the host chrome. MapLibre sizes the
  // canvas on construction; by the time the lazy import resolves and the Map is
  // created, MapSection's relocation effect has already moved the host into its
  // sized inline slot, so no on-ready resize is needed.
  useImperativeHandle(
    ref,
    () => ({ resize: () => mapRef.current?.resize(), focusMarker }),
    [focusMarker],
  );

  // ── Map initialization (client-only, lazy maplibre-gl) ──────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    let cancelled = false;
    let map: MLMap | null = null;

    (async () => {
      const maplibregl: MapLibreNS = await import('maplibre-gl');
      if (cancelled || !containerRef.current) return;
      mapLibreRef.current = maplibregl;

      map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle() as never,
        bounds: ALL_BOUNDS,
        fitBoundsOptions: { padding: 48 },
        attributionControl: false, // added explicitly below (compact)
        maxZoom: 17,
        minZoom: 2,
      });
      mapRef.current = map;

      map.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        'bottom-right',
      );
      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        'top-right',
      );

      // Geolocation "where am I" — permission-gated, no storage of position.
      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserLocation: true,
      });
      map.addControl(geolocate, 'top-right');
      geolocate.on('error', () => {
        onGeoNoteRef.current?.(
          'Location unavailable — permission denied or unsupported. The map still works; browse or use the filter.',
        );
      });
      geolocate.on('geolocate', () => onGeoNoteRef.current?.(null));

      map.on('load', () => {
        if (cancelled) return;

        // Browse markers — clustered GeoJSON source.
        map!.addSource(MARKERS_SOURCE_ID, {
          type: 'geojson',
          data: markersToGeoJSON(markersRef.current) as never,
          cluster: true,
          clusterRadius: 50,
          clusterMaxZoom: 8,
        });

        // Cluster bubbles.
        map!.addLayer({
          id: 'clusters',
          type: 'circle',
          source: MARKERS_SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': BRAND.gold500,
            'circle-opacity': 0.85,
            'circle-stroke-color': BRAND.navy900,
            'circle-stroke-width': 2,
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              16,
              5,
              20,
              10,
              26,
            ],
          },
        });
        map!.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: MARKERS_SOURCE_ID,
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 13,
          },
          paint: { 'text-color': BRAND.navy900 },
        });

        // Unclustered points — category-colored.
        map!.addLayer({
          id: 'unclustered',
          type: 'circle',
          source: MARKERS_SOURCE_ID,
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['get', 'color'],
            'circle-radius': 8,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-opacity': 0.85,
          },
        });

        // Itinerary route source (empty until stops are supplied).
        map!.addSource(ITIN_SOURCE_ID, {
          type: 'geojson',
          data: {
            type: 'FeatureCollection',
            features: [],
          } as never,
        });
        map!.addLayer({
          id: 'itin-line',
          type: 'line',
          source: ITIN_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'LineString'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': BRAND.gold400,
            'line-width': 3,
            'line-opacity': 0.7,
            'line-dasharray': [1, 1.5],
          },
        });
        map!.addLayer({
          id: 'itin-stop',
          type: 'circle',
          source: ITIN_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': BRAND.gold500,
            'circle-radius': 12,
            'circle-stroke-color': BRAND.navy900,
            'circle-stroke-width': 2,
          },
        });
        map!.addLayer({
          id: 'itin-stop-label',
          type: 'symbol',
          source: ITIN_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          layout: {
            'text-field': ['get', 'day'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
          },
          paint: { 'text-color': BRAND.navy900 },
        });

        // Cursor affordances.
        for (const id of ['clusters', 'unclustered']) {
          map!.on('mouseenter', id, () => {
            map!.getCanvas().style.cursor = 'pointer';
          });
          map!.on('mouseleave', id, () => {
            map!.getCanvas().style.cursor = '';
          });
        }

        // Cluster click → expand to the cluster's zoom.
        map!.on('click', 'clusters', (e) => {
          const features = map!.queryRenderedFeatures(e.point, {
            layers: ['clusters'],
          });
          const clusterId = features[0]?.properties?.cluster_id;
          if (clusterId == null) return;
          const src = map!.getSource(MARKERS_SOURCE_ID) as GeoJSONSource;
          src.getClusterExpansionZoom(clusterId).then((zoom) => {
            const geom = features[0].geometry;
            if (geom.type !== 'Point') return;
            const center = geom.coordinates as [number, number];
            if (prefersReducedMotion()) {
              map!.jumpTo({ center, zoom });
            } else {
              map!.easeTo({ center, zoom, duration: 500 });
            }
          });
        });

        // Unclustered point click → open a rich popup (+ notify the host).
        map!.on('click', 'unclustered', (e) => {
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          const id = f?.properties?.id as string | undefined;
          const marker = id ? MARKER_BY_ID.get(id) : undefined;
          if (!marker) return;
          openPopup(maplibregl, marker);
          onMarkerClickRef.current?.(marker);
        });

        // view seam: report camera center/zoom on every settle (+ once now),
        // so a /plan host can prove a reorder doesn't move the camera. No-op on /map.
        const emitView = () => {
          const c = map!.getCenter();
          onViewChangeRef.current?.({ lng: c.lng, lat: c.lat, zoom: map!.getZoom() });
        };
        map!.on('moveend', emitView);
        emitView();

        setMapReady(true);
        onReadyRef.current?.();
      });
    })();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      popupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      mapLibreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Markers → update the source data + camera to the given set ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(MARKERS_SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(markersToGeoJSON(markers) as never);
    // Close any open popup whose marker is no longer in the visible set.
    if (popupMarker && !markers.some((mk) => mk.id === popupMarker.id)) {
      popupRef.current?.remove();
    }
    if (markers.length === 0 || !fitBounds) return;

    // Fit to the set (flyTo animation, or jumpTo under reduced-motion).
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const mk of markers) {
      minLng = Math.min(minLng, mk.lng);
      minLat = Math.min(minLat, mk.lat);
      maxLng = Math.max(maxLng, mk.lng);
      maxLat = Math.max(maxLat, mk.lat);
    }
    const bounds: LngLatBoundsLike = [
      [minLng, minLat],
      [maxLng, maxLat],
    ];
    const animate = !prefersReducedMotion();
    map.fitBounds(bounds, {
      padding: 64,
      maxZoom: 12,
      duration: animate ? 700 : 0,
      animate,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markers, mapReady, fitBounds]);

  // ── Itinerary route → rebuild the route source when stops change ────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(ITIN_SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;

    const stops = routeStops ?? [];
    if (stops.length === 0) {
      src.setData({ type: 'FeatureCollection', features: [] } as never);
      return;
    }

    // Group stops by day → one LineString per day + one numbered Point per stop.
    const byDay = new Map<number, DayStop[]>();
    for (const s of stops) {
      if (!byDay.has(s.day)) byDay.set(s.day, []);
      byDay.get(s.day)!.push(s);
    }
    const features: Array<Record<string, unknown>> = [];
    for (const [, dayStops] of byDay) {
      if (dayStops.length >= 2) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: dayStops.map((s) => [s.marker.lng, s.marker.lat]),
          },
          properties: { day: String(dayStops[0].day) },
        });
      }
      for (const s of dayStops) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [s.marker.lng, s.marker.lat] },
          // `id` (additive; /map ignores it) lets the highlight effect target
          // this numbered route-stop by marker id.
          properties: { id: s.marker.id, day: String(s.day), title: s.title, date: s.date },
        });
      }
    }
    src.setData({ type: 'FeatureCollection', features } as never);

    if (!fitBounds) return;

    // Fit to the planned stops.
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const s of stops) {
      minLng = Math.min(minLng, s.marker.lng);
      minLat = Math.min(minLat, s.marker.lat);
      maxLng = Math.max(maxLng, s.marker.lng);
      maxLat = Math.max(maxLat, s.marker.lat);
    }
    if (Number.isFinite(minLng)) {
      const animate = !prefersReducedMotion();
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        { padding: 72, maxZoom: 12, duration: animate ? 700 : 0, animate },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStops, mapReady, fitBounds]);

  // ── highlight → emphasize the matching browse marker + route stop ──────
  // Data-driven paint keyed on the feature `id`: fatter radius + gold stroke on
  // the highlighted one. STRICT no-op when `highlightId === undefined` (the /map
  // case) — the effect returns before touching any paint, so /map is untouched.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || highlightId === undefined) return;
    const hi = highlightId; // string (emphasize this id) | null (reset to base)
    const casePaint = (emph: unknown, base: unknown) =>
      (hi == null ? base : ['case', ['==', ['get', 'id'], hi], emph, base]) as never;
    if (map.getLayer('unclustered')) {
      map.setPaintProperty('unclustered', 'circle-radius', casePaint(13, 8));
      map.setPaintProperty('unclustered', 'circle-stroke-color', casePaint(BRAND.gold400, '#ffffff'));
      map.setPaintProperty('unclustered', 'circle-stroke-width', casePaint(3, 2));
    }
    if (map.getLayer('itin-stop')) {
      map.setPaintProperty('itin-stop', 'circle-radius', casePaint(17, 12));
      map.setPaintProperty('itin-stop', 'circle-stroke-color', casePaint(BRAND.gold400, BRAND.navy900));
      map.setPaintProperty('itin-stop', 'circle-stroke-width', casePaint(3, 2));
    }
  }, [highlightId, mapReady, routeStops]);

  return (
    <>
      {/* h-full w-full (NOT absolute inset-0): MapLibre stamps its own
          `.maplibregl-map { position: relative }` onto this node, which would
          defeat inset-0 sizing and collapse the container to 0px. An explicit
          full-size box sizes correctly under either position, given the host
          has a definite height (inline slot h-[560px] / fixed inset-0). */}
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label="Interactive map of trip destinations across Nepal and Japan"
        role="application"
      />

      {/* Loading skeleton until the GL canvas is ready. */}
      {!mapReady && (
        <div className="absolute inset-0 grid place-items-center bg-surface">
          {/* loading label `/40`→`/55` so "Loading map…" clears AA (3.76→6.22)
              on the navy skeleton while the GL canvas mounts. */}
          <div className="flex flex-col items-center gap-3 text-white/55">
            <MapPin className="w-6 h-6 motion-safe:animate-pulse" />
            <span className="text-xs">Loading map…</span>
          </div>
        </div>
      )}

      {/* Popup content portal: stays in this React tree so context flows
          to AddToPlanButton, while its DOM lives inside the MapLibre Popup. */}
      {popupNode && popupMarker
        ? createPortal(
            <MarkerPopupContent
              marker={popupMarker}
              enableFavorite={enablePopupFavorite}
              enableDayAssign={enableDayAssign}
              assignDays={assignDays}
              onAssignDay={onAssignDay}
            />,
            popupNode,
          )
        : null}

      {/* Scoped dark-brand overrides for the MapLibre popup + controls. A plain
          <style> element (local to this component, not globals.css which
          owns) — the default popup/control chrome is light, so we retint it to
          the navy/gold palette. */}
      <style>{`
        .njp-map-popup .maplibregl-popup-content {
          background: ${BRAND.navy800};
          color: #fff;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 0.75rem;
          padding: 0.75rem;
          box-shadow: 0 12px 32px rgba(0,0,0,0.55);
          /* bound the popup height so its on-screen box is STABLE regardless of
             content (the "Anchor to a day" block can make it tall). An unbounded tall
             popup re-anchors/jitters against the map edge under continuous repaint,
             which made a re-opened popup's controls fail Playwright's stability check. */
          max-height: 70vh;
          overflow-y: auto;
        }
        .njp-map-popup .maplibregl-popup-tip {
          border-top-color: ${BRAND.navy800};
          border-bottom-color: ${BRAND.navy800};
        }
        .njp-map-popup .maplibregl-popup-close-button {
          color: rgba(255,255,255,0.6);
          font-size: 18px;
          padding: 2px 7px;
          right: 2px;
          top: 2px;
        }
        .njp-map-popup .maplibregl-popup-close-button:hover {
          color: #fff;
          background: rgba(255,255,255,0.08);
          border-radius: 6px;
        }
        .maplibregl-ctrl-attrib {
          background: rgba(10,14,39,0.75) !important;
          color: rgba(255,255,255,0.55);
        }
        .maplibregl-ctrl-attrib a { color: rgba(255,255,255,0.7); }
        .maplibregl-ctrl-group {
          background: ${BRAND.navy800};
          border: 1px solid rgba(255,255,255,0.10);
        }
        .maplibregl-ctrl-group button + button {
          border-top: 1px solid rgba(255,255,255,0.10);
        }
        .maplibregl-ctrl-group button .maplibregl-ctrl-icon {
          filter: invert(1) brightness(1.4);
        }
      `}</style>
    </>
  );
});

export default TripMap;
