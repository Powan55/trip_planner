'use client';

// Bundled with this lazily loaded component, so the CSS only ships on map routes.
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
  CircleDashed,
  type LucideIcon,
} from 'lucide-react';
import { type MapMarker, type MarkerCategory } from '@/lib/map-data';
import { boundsOf } from '@/lib/map-initial-view';
import { buildMapStyle, CATEGORY_COLOR, BRAND, OPENFREEMAP_TILEJSON } from '@/lib/map-style';
import { useOnline } from '@/hooks/use-online';
import { buildMapsDirectionsUrl } from '@/lib/maps-link';
import { placeColor } from '@/lib/city-palette';
import { MARKER_BY_ID, type DayStop } from '@/lib/itinerary-map';
import { footprintsToGeoJSON, type CountryFootprint } from '@/lib/visited-footprint';
import { MAP_PIN_DND_TYPE } from '@/lib/day-anchor';
import { prefersReducedMotion } from '@/lib/motion';
import { withBasePath } from '@/lib/base-path';
import { getActiveTrip } from '@/core/trips';
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

// Category icon and classes for DOM chips and popups. The GL fills use CATEGORY_COLOR in
// lib/map-style.ts; keep the two in step (map-category-mirror.test.ts checks).
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
  // Green, not cyan: cyan matched the focus/interactive hue.
  'Day Trip': {
    icon: Bus,
    pin: 'bg-green-500 text-surface',
    badge: 'bg-green-500/20 text-green-300 border-green-500/30',
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
const CLUSTER_MAX_ZOOM = 13;
const ITIN_SOURCE_ID = 'itinerary-route';
// Issue #31 — the visited footprint wash. Its source and layers are added FIRST in the `load`
// handler so every marker, route line and label paints on top of it.
const VISITED_SOURCE_ID = 'visited-footprint';

// Only used when there are no markers; otherwise the map fits the markers. Widening this
// doesn't make a place reachable.
const ALL_BOUNDS: LngLatBoundsLike = [
  [83.0, 27.0], // SW (west of Kathmandu Valley)
  [141.0, 36.5], // NE (east of Tokyo)
];

// Camera moves use prefersReducedMotion() from lib/motion.ts, read at call time.

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

// Seats the marker below centre so the popup above it stays clear of the navbar.
const POPUP_VIEW_OFFSET: [number, number] = [0, 150];

// Popup content is portaled into the MapLibre popup so React context still reaches it.
// Marker ids and guide ids share the favorites store without clashing (use-favorites.test.ts).
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
    <div
      className="plate w-[248px] max-w-[80vw]"
      data-leg={marker.country === 'Japan' ? 'japan' : 'nepal'}
      style={{ ['--now' as string]: placeColor(marker.country, marker.area) }}
    >
      {/* DOM chrome only — the ratio lives on the frame as `--plate-ar`, which is what the
          recipe reads, and the grid is what gives the ramp a row to span. */}
      {marker.image && !imgError && (
        <div className="frame [--plate-ar:16_/_9] -mx-3 -mt-3 mb-3">
          <div className="fig bg-surface-raised">
            <OptimizedImage
              src={marker.image}
              alt={marker.name}
              fill
              sizes="248px"
              className="object-cover"
              onError={() => setImgError(true)}
            />
          </div>
          <div className="ramp" aria-hidden="true" />
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
            <h3 className="text-t-body font-semibold text-ink-hi leading-tight">
              {marker.name}
            </h3>
            {/* The seven category hexes are frozen, so the chip keeps its category colour
                and takes the instrument's geometry around it. */}
            <span className={`chip ${style.badge}`}>{marker.category}</span>
          </div>
          {/* Area and country. */}
          <p className="pr pr--lo flex items-center gap-1 mb-1.5">
            <MapPin className="w-3 h-3 text-now" aria-hidden="true" />
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
            className={`ml-auto shrink-0 inline-flex min-h-tap min-w-tap items-center justify-center rounded-r1 border-hair transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
              favorited
                ? 'border-[color:hsl(var(--accent))] text-[color:hsl(var(--accent))] bg-[rgb(62_216_255/0.10)]'
                : 'border-[color:hsl(var(--border))] text-ink-lo hover:border-[color:var(--border-ui)] hover:text-ink-hi'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${favorited ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
      <p className="text-t-sm text-ink-mid leading-relaxed mt-1.5">
        {marker.description}
      </p>
      <div
        data-testid="map-popup-actions"
        className="sticky -bottom-3 z-10 bg-[rgb(var(--surface))] pb-3 shadow-[0_-6px_6px_-6px_rgb(0_0_0/0.6)]"
      >
      <a
        href={buildMapsDirectionsUrl(marker.lat, marker.lng)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="map-popup-directions"
        className="chip mt-2 min-h-tap px-2.5 text-ink-hi transition-colors hover:border-[color:var(--text-hi)] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <Navigation className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
        Directions
      </a>
      <AddToPlanButton source={marker} sourceType="map" accentColor="text-now" />

      {/* Anchor to a day. The select is the keyboard and touch path; HTML5 drag never fires
          on touch, so the drag handle is a desktop extra. */}
      {enableDayAssign && assignDays && assignDays.length > 0 && (
        <div
          data-testid={`map-popup-assign-${marker.id}`}
          className="mt-2 pt-2 border-t-hair border-[color:hsl(var(--border))]"
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
              className="hidden sm:grid place-items-center w-7 shrink-0 rounded-r1 border-hair border-[color:hsl(var(--border))] text-ink-lo cursor-grab active:cursor-grabbing hover:border-[color:var(--border-ui)] hover:text-ink-hi transition-colors"
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
              className="min-w-0 flex-1 min-h-tap px-2 py-1.5 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low text-t-sm text-ink-hi outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              {assignDays.map((d) => (
                <option key={d.date} value={d.date} className="bg-surface-low text-ink-hi">
                  {d.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => assignDate && onAssignDay?.(marker, assignDate)}
              data-testid={`map-popup-assign-confirm-${marker.id}`}
              aria-label={`Anchor a day around ${marker.name}`}
              className="chip chip--struck shrink-0 min-h-tap px-2.5 transition-colors hover:border-[color:hsl(var(--accent))] hover:text-[color:hsl(var(--accent))] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              Anchor
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

// Popup for a drawn itinerary stop. It's the user's own plan, maybe at a derived position, so
// no directions, add-to-plan or favourite. An approximate position quotes the text it came from.
function ItineraryStopPopupContent({ stop }: { stop: DayStop }) {
  const approximate = stop.placement.kind === 'approximate';
  const derivedFrom = stop.placement.kind === 'approximate' ? stop.placement.derivedFrom : '';
  return (
    <div
      className="w-[248px] max-w-[80vw]"
      data-testid="map-stop-popup"
      data-approximate={approximate ? 'true' : 'false'}
      data-derived-from={derivedFrom}
    >
      {/* Issue #1 — the heading names the same two numbers the map draws: which day this
          is, and which stop of that day this pin is. The pin shows the second one, so the
          popup has to confirm it or the number on the canvas is unverifiable. */}
      <h3 className="pr pr--l text-ink-hi">
        Day <span className="num">{stop.day}</span> · Stop <span className="num">{stop.seq}</span>
        <span className="pr pr--lo ml-1.5">
          {stop.items.length} {stop.items.length === 1 ? 'plan' : 'plans'} here
        </span>
      </h3>
      <ul className="mt-1.5 space-y-1">
        {stop.items.map((item) => (
          <li key={item.id} className="flex items-start gap-1.5 text-t-sm text-ink-hi">
            <MapPin className="w-3 h-3 mt-0.5 shrink-0 text-ink-lo" aria-hidden="true" />
            <span className="min-w-0">{item.title}</span>
          </li>
        ))}
      </ul>
      {approximate && (
        <>
          <p
            data-testid="map-stop-approx-note"
            className="hollow mt-2 pt-2 border-t-hair border-[color:hsl(var(--border))] flex items-start gap-1.5 text-t-sm"
          >
            <CircleDashed className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
            <span>
              Approximate — placed from &ldquo;{derivedFrom}&rdquo;.
            </span>
          </p>
          <a
            href="/plan/"
            data-testid="map-stop-set-pin"
            className="chip mt-1.5 min-h-tap px-2.5 text-ink-hi transition-colors hover:border-[color:var(--text-hi)] outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <MapPin className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden="true" />
            Set an exact pin in the planner
          </a>
        </>
      )}
    </div>
  );
}

// Stops propagation so the fullscreen shell's document-level Esc doesn't also exit.
export function onPopupKeyDown(e: KeyboardEvent, remove: () => void) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  remove();
}

// Only pulls focus back when it was inside the popup (now removed, so it sits on body):
// a mouse click elsewhere that closed the popup keeps its own focus.
export function restorePopupFocus(
  popupEl: HTMLElement | null,
  opener: HTMLElement | null,
  fallback: HTMLElement | null,
) {
  const active = document.activeElement;
  if (active && active !== document.body && !popupEl?.contains(active)) return;
  const target = opener?.isConnected && opener !== document.body ? opener : fallback;
  if (target?.isConnected) target.focus();
}

// Imperative handle the host chrome holds — used to force a canvas resize after
// the host node is physically relocated (fullscreen enter/exit lives in the
// parent; the map instance lives here, so the parent asks us to resize).
export interface TripMapHandle {
  resize: () => void;
  /** Fly to `marker` and open its popup (by lat/lng, so it opens even if not rendered). */
  focusMarker: (marker: MapMarker) => void;
  /**
   * Fly to a bare coordinate with no popup or marker. World-search results have no real area or
   * country, so a synthesized marker would have to invent them (D-271).
   */
  flyToPoint: (lat: number, lng: number) => void;
}

export interface TripMapProps {
  /** Markers to plot and cluster. An open popup closes when its marker leaves the set. */
  markers: MapMarker[];
  /** Ordered stops for the route line, numbered per day. Empty clears the route. */
  routeStops?: DayStop[];
  /** Fired on a marker click, as well as opening the popup. */
  onMarkerClick?: (marker: MapMarker) => void;
  /** Marker id to emphasize. `undefined` skips the paint effect entirely. */
  highlightId?: string | null;
  /** Fired on every camera settle and once on load. */
  onViewChange?: (view: { lng: number; lat: number; zoom: number }) => void;
  /** Fired once the style and layers are ready. */
  onReady?: () => void;
  /** Auto-fit to markers and route changes. Default true; false holds the camera on reorder. */
  fitBounds?: boolean;
  /**
   * Frame these markers for the construct frame and the FIRST fit instead of all of `markers`,
   * so a cold open fetches nearby tiles, not the zoom-2 world tiles. Later fits (filter change)
   * use `markers` as before. Empty/absent ⇒ `markers`.
   */
  initialFocus?: MapMarker[];
  /** Geolocate error message for the host to show; null on success. */
  onGeoNote?: (note: string | null) => void;
  /** Favourite heart in the popup; curated places only. */
  enablePopupFavorite?: boolean;
  /** "Anchor to a day" control in the popup. */
  enableDayAssign?: boolean;
  assignDays?: AssignDayOption[];
  onAssignDay?: (marker: MapMarker, date: string) => void;
  /**
   * Popup on drawn route stops. Off on /plan, which passes the same points as markers too and
   * would get two popups per click.
   */
  enableStopPopup?: boolean;
  /** Coordinate picker: crosshair cursor, no popups, every click goes to `onMapClick`. */
  pickMode?: boolean;
  /** Fired with the clicked coordinate, ONLY while `pickMode` is on. */
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  /**
   * Visited-footprint wash per country. These are padded hulls of visited cities, not borders
   * (lib/visited-footprint.ts), so they're painted as a soft fill, never a crisp outline.
   */
  countryFills?: CountryFootprint[];
}

// Client-only component, so reading the active trip at module load is safe.
const TRIP_MAP_ARIA_LABEL = `Interactive map of trip destinations across ${getActiveTrip()
  .legs.map((leg) => leg.countryLabel)
  .join(' and ')}`;

// The MapLibre engine: markers, route, popups and camera. Hosts own the chrome (filters,
// fullscreen). The dynamic import below is the only way maplibre-gl gets loaded.
const TripMap = forwardRef<TripMapHandle, TripMapProps>(function TripMap(
  {
    markers,
    routeStops,
    onMarkerClick,
    highlightId,
    fitBounds = true,
    initialFocus,
    onGeoNote,
    onViewChange,
    onReady,
    enablePopupFavorite,
    enableDayAssign,
    assignDays,
    onAssignDay,
    enableStopPopup,
    pickMode,
    onMapClick,
    countryFills,
  },
  ref,
) {
  const [mapReady, setMapReady] = useState(false);
  // Issue #502 — set when the WebGL2 context can't be created; renders the
  // unavailable message in place of the canvas instead of leaving it blank.
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [engineError, setEngineError] = useState<unknown>(null);
  // Basemap source failed on a connection that is otherwise up; cleared when it loads.
  const [basemapFailed, setBasemapFailed] = useState(false);
  const online = useOnline();
  // The marker whose popup is currently open — drives the React portal content.
  const [popupMarker, setPopupMarker] = useState<MapMarker | null>(null);
  // The DOM node inside the open popup that we portal React content into.
  const [popupNode, setPopupNode] = useState<HTMLElement | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const basemapFailedRef = useRef(false);
  const retryBasemapRef =useRef<() => void>(() => {});
  const offRetryRef = useRef<() => void>(() => {});
  const popupRef = useRef<MLPopup | null>(null);
  const popupElRef = useRef<HTMLElement | null>(null);
  const popupOpenerRef = useRef<HTMLElement | null>(null);
  // The loaded maplibre module, for imperative callers like focusMarker.
  const mapLibreRef = useRef<MapLibreNS | null>(null);

  // Latest-value refs for props read inside the once-only init effect / stable
  // click handlers, so those closures never go stale without re-initializing GL.
  const markersRef = useRef(markers);
  markersRef.current = markers;
  const onMarkerClickRef = useRef(onMarkerClick);
  onMarkerClickRef.current = onMarkerClick;
  const onGeoNoteRef = useRef(onGeoNote);
  onGeoNoteRef.current = onGeoNote;
  // Read at construct time and by the first fit only; `firstFitRef` flips once a fit ran.
  const startMarkersRef = useRef(markers);
  startMarkersRef.current = initialFocus?.length ? initialFocus : markers;
  const firstFitRef = useRef(true);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  // the once-registered canvas handlers below read pick state through refs, so
  // arming/disarming the picker never re-initializes GL (same idiom as onMarkerClickRef).
  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  // the drawn stops + whether they are clickable, read by the once-registered
  // itin-stop handler below (same latest-value-ref idiom as pickModeRef).
  const routeStopsRef = useRef(routeStops);
  routeStopsRef.current = routeStops;
  const enableStopPopupRef = useRef(enableStopPopup);
  enableStopPopupRef.current = enableStopPopup;

  // Open (or move) the in-canvas popup for a marker, and expose its content node
  // so React can portal the interactive content in.
  const fitRef = useRef<() => void>(() => {});
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
        restorePopupFocus(
          popupElRef.current,
          popupOpenerRef.current,
          mapRef.current?.getCanvas() ?? null,
        );
      });
      popupRef.current = popup;
    }
    const opener = document.activeElement;
    const holder = document.createElement('div');
    popup.setLngLat([marker.lng, marker.lat]).setDOMContent(holder).addTo(map);
    popupOpenerRef.current = opener instanceof HTMLElement ? opener : null;
    const el = popup.getElement();
    popupElRef.current = el ?? null;
    // popup sits above the marker, which easeTo seats POPUP_VIEW_OFFSET[1] below centre;
    // 48 covers the tip + marker glyph + slack. Refit on resize (fullscreen changes height).
    // KNOWN CEILING: map shorter than ~300px lets the popup overflow
    const fit = () =>
      el?.style.setProperty(
        '--njp-popup-max',
        `${Math.max(120, map.getContainer().clientHeight / 2 + POPUP_VIEW_OFFSET[1] - 48)}px`,
      );
    fit();
    map.off('resize', fitRef.current);
    fitRef.current = fit;
    map.on('resize', fit);
    const p = popup;
    el?.addEventListener('keydown', (e) => onPopupKeyDown(e, () => p.remove()));
    setPopupNode(holder);
    setPopupMarker(marker);
    // Always move (it's a layout fix so the popup isn't clipped); reduced motion only sets the
    // duration to 0.
    map.easeTo({
      center: [marker.lng, marker.lat],
      offset: POPUP_VIEW_OFFSET,
      duration: prefersReducedMotion() ? 0 : 400,
    });
  }, []);

  // Reduced motion jumps and opens at once; otherwise fly, then open on moveend.
  const focusMarker = useCallback(
    (marker: MapMarker) => {
      const map = mapRef.current;
      const maplibregl = mapLibreRef.current;
      if (!map || !maplibregl) return;
      const zoom = Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1);
      if (prefersReducedMotion()) {
        // easeTo(duration:0) is an instant jump that ALSO honours `offset` (jumpTo
        // does not), so the marker lands below-centre and the popup opens in-shell.
        map.easeTo({ center: [marker.lng, marker.lat], zoom, offset: POPUP_VIEW_OFFSET, duration: 0 });
        openPopup(maplibregl, marker);
      } else {
        // Near target (on screen, <=1.5 zoom levels away): short ease. Far: flyTo.
        const near =
          map.getBounds().contains([marker.lng, marker.lat]) && Math.abs(zoom - map.getZoom()) <= 1.5;
        const move = { center: [marker.lng, marker.lat] as [number, number], zoom, offset: POPUP_VIEW_OFFSET };
        if (near) map.easeTo({ ...move, duration: 350 });
        else map.flyTo({ ...move, duration: 700 });
        map.once('moveend', () => openPopup(maplibregl, marker));
      }
    },
    [openPopup],
  );

  // Issue #22 — camera-only move for a place that is not a marker. See `TripMapHandle.flyToPoint`
  // for why the world search must not be handed a synthesized `MapMarker`.
  const flyToPoint = useCallback((lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map) return;
    const zoom = Math.max(map.getZoom(), 12);
    if (prefersReducedMotion()) {
      map.easeTo({ center: [lng, lat], zoom, duration: 0 });
    } else {
      map.flyTo({ center: [lng, lat], zoom, duration: 900 });
    }
  }, []);

  // The host is already in its sized slot when the Map is constructed, so no on-ready resize.
  useImperativeHandle(
    ref,
    () => ({ resize: () => mapRef.current?.resize(), focusMarker, flyToPoint }),
    [focusMarker, flyToPoint],
  );

  // ── Map initialization (client-only, lazy maplibre-gl) ──────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    let cancelled = false;
    let map: MLMap | null = null;

    (async () => {
      let maplibregl: MapLibreNS;
      try {
        maplibregl = await import('maplibre-gl');
      } catch (err) {
        // Offline the one-shot chunk reload cannot fetch the engine; hand it to MapIslandBoundary.
        if (navigator.onLine !== false) throw err;
        if (!cancelled) setEngineError(err);
        return;
      }
      if (cancelled || !containerRef.current) return;
      mapLibreRef.current = maplibregl;

      // Issue #503 — the worker path is versioned by the installed engine's own
      // version (copy-maplibre-worker.mjs copies into the same path), so a
      // maplibre-only bump can never run against a stale cached worker.
      maplibregl.setWorkerUrl(
        withBasePath(`/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`),
      );
      // Issue #502 — `new Map` throws synchronously when the browser can't give it a
      // WebGL2 context (old device, disabled GPU, too many contexts already open).
      // Uncaught here it would just leave the panel blank forever post-mount.
      try {
        map = new maplibregl.Map({
          container: containerRef.current,
          style: buildMapStyle() as never,
          bounds: boundsOf(startMarkersRef.current) ?? ALL_BOUNDS,
          fitBoundsOptions: { padding: 64, maxZoom: 12 },
          attributionControl: false, // added explicitly below (compact)
          maxZoom: 17,
          minZoom: 2,
        });
      } catch (err) {
        console.error(err);
        if (!cancelled) setMapUnavailable(true);
        return;
      }
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

      // Any 'error' listener silences MapLibre's default console output, so re-log the rest.
      map.on('error', (e) => {
        if ((e as { sourceId?: string }).sourceId === 'openfreemap') {
          basemapFailedRef.current = true;
          setBasemapFailed(true);
        } else console.error(e.error);
      });
      map.on('sourcedata', (e) => {
        if (e.sourceId === 'openfreemap' && e.isSourceLoaded) {
          basemapFailedRef.current = false;
          setBasemapFailed(false);
        }
      });
      // setUrl, not setStyle: setStyle would wipe the pin/route layers added on load.
      const m = map;
      const retryBasemap = () =>
        basemapFailedRef.current &&
        (m.getSource('openfreemap') as { setUrl?: (u: string) => void } | undefined)?.setUrl?.(
          OPENFREEMAP_TILEJSON,
        );
      retryBasemapRef.current = retryBasemap;
      window.addEventListener('online', retryBasemap);
      offRetryRef.current = () => window.removeEventListener('online', retryBasemap);

      map.on('load', () => {
        if (cancelled) return;

        // Issue #31 — the visited footprint, added BEFORE everything else so it sits at the
        // bottom of the layer stack: a wash under the pins, never over them. Starts empty and
        // is filled by the effect below, the same shape as the itinerary route source.
        map!.addSource(VISITED_SOURCE_ID, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] } as never,
        });
        map!.addLayer({
          id: 'visited-fill',
          type: 'fill',
          source: VISITED_SOURCE_ID,
          paint: {
            // Faint enough that markers on it keep their colour.
            'fill-color': BRAND.gold400,
            'fill-opacity': 0.12,
          },
        });
        map!.addLayer({
          id: 'visited-edge',
          type: 'line',
          source: VISITED_SOURCE_ID,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            // Soft and dashed ON PURPOSE. A crisp 1px line here would read as a border, which
            // is a claim this shape cannot make (see `countryFills` above); a dashed haze
            // reads as an approximate region, which is exactly what it is.
            'line-color': BRAND.gold400,
            'line-width': 1.5,
            'line-opacity': 0.28,
            'line-dasharray': [2, 3],
          },
        });

        // Browse markers — clustered GeoJSON source.
        map!.addSource(MARKERS_SOURCE_ID, {
          type: 'geojson',
          data: markersToGeoJSON(markersRef.current) as never,
          cluster: true,
          clusterRadius: 50,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
        });

        // Cluster bubbles.
        map!.addLayer({
          id: 'clusters',
          type: 'circle',
          source: MARKERS_SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            // Neutral, so a cluster doesn't read as a gold Attraction pin.
            'circle-color': '#ffffff',
            'circle-opacity': 0.22,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-opacity': 0.55,
            'circle-stroke-width': 1.5,
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
          // white on the glass bubble (navy text was legible only on the old solid
          // gold fill), with a navy halo so the count holds up over a light raster patch.
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': BRAND.navy900,
            'text-halo-width': 1,
          },
        });

        // Invisible 44px hit target under the 20px pin; layer clicks query a single pixel.
        map!.addLayer({
          id: 'unclustered-hit',
          type: 'circle',
          source: MARKERS_SOURCE_ID,
          filter: ['!', ['has', 'point_count']],
          paint: { 'circle-radius': 22, 'circle-opacity': 0 },
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
        // Approximate stops are hollow rings, exact ones solid discs: shape, not colour.
        map!.addLayer({
          id: 'itin-stop',
          type: 'circle',
          source: ITIN_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-color': ['case', ['get', 'approx'], BRAND.navy900, BRAND.gold500],
            'circle-radius': 12,
            'circle-stroke-color': ['case', ['get', 'approx'], BRAND.gold400, BRAND.navy900],
            'circle-stroke-width': ['case', ['get', 'approx'], 2.5, 2],
          },
        });
        // Position within the day. Digits only: just glyph range 0-255 is self-hosted for offline.
        map!.addLayer({
          id: 'itin-stop-label',
          type: 'symbol',
          source: ITIN_SOURCE_ID,
          filter: ['==', ['geometry-type'], 'Point'],
          layout: {
            'text-field': ['get', 'seq'],
            'text-font': ['Noto Sans Bold'],
            'text-size': 12,
          },
          paint: {
            'text-color': ['case', ['get', 'approx'], BRAND.gold400, BRAND.navy900],
          },
        });

        // Cursor affordances.
        // in pick mode the crosshair wins over the browse pointer, so hovering a
        // marker while placing a pin doesn't promise a click that no longer browses.
        for (const id of ['clusters', 'unclustered-hit']) {
          map!.on('mouseenter', id, () => {
            map!.getCanvas().style.cursor = pickModeRef.current ? 'crosshair' : 'pointer';
          });
          map!.on('mouseleave', id, () => {
            map!.getCanvas().style.cursor = pickModeRef.current ? 'crosshair' : '';
          });
        }

        // Cluster click → expand to the cluster's zoom.
        map!.on('click', 'clusters', (e) => {
          if (pickModeRef.current) return; // a pick click places a pin, never zooms
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
        map!.on('click', 'unclustered-hit', (e) => {
          if (pickModeRef.current) return; // a pick click places a pin, never browses
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          const id = f?.properties?.id as string | undefined;
          const marker = id ? MARKER_BY_ID.get(id) : undefined;
          if (!marker) return;
          openPopup(maplibregl, marker);
          onMarkerClickRef.current?.(marker);
        });

        // Stop popup, gated on a ref (see enableStopPopup).
        map!.on('mouseenter', 'itin-stop', () => {
          if (!enableStopPopupRef.current) return;
          map!.getCanvas().style.cursor = pickModeRef.current ? 'crosshair' : 'pointer';
        });
        map!.on('mouseleave', 'itin-stop', () => {
          if (!enableStopPopupRef.current) return;
          map!.getCanvas().style.cursor = pickModeRef.current ? 'crosshair' : '';
        });
        map!.on('click', 'itin-stop', (e) => {
          if (pickModeRef.current || !enableStopPopupRef.current) return;
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          const id = f?.properties?.id as string | undefined;
          const stop = id
            ? routeStopsRef.current?.find((s) => s.marker.id === id)
            : undefined;
          if (!stop) return;
          openPopup(maplibregl, stop.marker);
        });

        // On the map, not a layer, so clicks on empty ground count in pick mode.
        map!.on('click', (e) => {
          if (!pickModeRef.current) return;
          onMapClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
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
      offRetryRef.current();
      popupRef.current?.remove();
      popupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      mapLibreRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // paint the crosshair while the picker is armed (and hand the cursor back on
  // disarm). Separate from the once-only init effect because `pickMode` changes over the
  // map's lifetime and must not tear down GL.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.getCanvas().style.cursor = pickMode ? 'crosshair' : '';
  }, [pickMode, mapReady]);

  // ── Visited footprint → refill the wash when the visit record changes ───────
  // Data only, never the camera: the footprint is context for whatever the map is already
  // showing, so fitting to it would yank the view away from the markers the user is browsing.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(VISITED_SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(footprintsToGeoJSON(countryFills ?? []) as never);
  }, [countryFills, mapReady]);

  // ── Markers → update the source data + camera to the given set ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(MARKERS_SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(markersToGeoJSON(markers) as never);
    // Close any open popup whose marker is no longer in the visible set. Stop popups
    // are the route effect's to close; this one runs late when `load` lands after a click.
    if (
      popupMarker &&
      MARKER_BY_ID.has(popupMarker.id) &&
      !markers.some((mk) => mk.id === popupMarker.id)
    ) {
      popupRef.current?.remove();
    }
    if (markers.length === 0 || !fitBounds) return;

    // Fit to the set (flyTo animation, or jumpTo under reduced-motion). The first fit frames
    // `initialFocus` (same box the map was constructed on, so it is a no-op move).
    const bounds = boundsOf(firstFitRef.current ? startMarkersRef.current : markers)!;
    firstFitRef.current = false;
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

    // Close a stop popup whose stop left the route; otherwise the portal would fall back to the
    // curated popup with directions to a centroid (D-279).
    if (
      popupMarker &&
      !MARKER_BY_ID.has(popupMarker.id) &&
      !stops.some((s) => s.marker.id === popupMarker.id)
    ) {
      popupRef.current?.remove();
    }

    if (stops.length === 0) {
      src.setData({ type: 'FeatureCollection', features: [] } as never);
      return;
    }

    // Group stops by DATE → one LineString per day + one numbered Point per stop. Keyed on
    // the date rather than the day number: the date is the stop's real identity (issue #1),
    // and it cannot be shared by two different days the way a positional index could.
    const byDay = new Map<string, DayStop[]>();
    for (const s of stops) {
      if (!byDay.has(s.date)) byDay.set(s.date, []);
      byDay.get(s.date)!.push(s);
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
          // `id` for highlighting, `approx` for the ring paint, `seq` for the label.
          properties: {
            id: s.marker.id,
            day: String(s.day),
            seq: String(s.seq),
            title: s.title,
            date: s.date,
            approx: s.placement.kind === 'approximate',
          },
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
    // popupMarker is not a dep: opening a popup must not re-fit the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeStops, mapReady, fitBounds]);

  // Highlight: bigger radius and gold stroke on the matching feature id.
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

  if (engineError) throw engineError;

  return (
    <>
      {/* h-full w-full, not inset-0: MapLibre sets position: relative on this node. */}
      {/* A labelled region, not role="application": MapLibre's own canvas takes focus and
          handles the keys. */}
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label={TRIP_MAP_ARIA_LABEL}
        role="region"
      />

      {/* Issue #502 — WebGL2 unavailable. `role="status"` since this fires post-mount
          (unlike MapIslandBoundary's chunk-load case, there's nothing static about it —
          the rest of the page already rendered around a map that then failed). No motion. */}
      {mapUnavailable && (
        <div
          data-testid="map-unavailable"
          role="status"
          className="empty-frame absolute inset-0 mx-auto flex max-w-md flex-col items-center justify-center p-gut py-6 text-center"
        >
          <p className="pr pr--l err mb-2">Map unavailable on this device</p>
          <p className="empty">
            This device or browser can&apos;t create the map engine&apos;s WebGL2
            context. Everything else on this page still works.
          </p>
        </div>
      )}

      {/* Basemap failed while the connection is up: say so and offer a retry. A strip at the
          bottom, not a cover, so pins stay tappable. Offline has its own hint in map-section. */}
      {basemapFailed && online && !mapUnavailable && (
        <div
          data-testid="map-basemap-error"
          role="status"
          className="absolute inset-x-2 bottom-8 z-10 mx-auto flex max-w-md items-center justify-between gap-3 rounded-r1 border-hair border-[color:hsl(var(--border))] bg-surface-low p-gut py-2 text-t-sm text-ink-mid"
        >
          <span>Map background didn&apos;t load. Pins and route still work.</span>
          <button
            type="button"
            onClick={() => retryBasemapRef.current()}
            className="min-h-[var(--tap)] shrink-0 rounded-r1 border-hair border-[color:hsl(var(--border))] px-3 text-ink-hi"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton until the GL canvas is ready. */}
      {!mapUnavailable && !mapReady && (
        // The word is a real text node, not a `content:` string — a static block is
        // indistinguishable from an empty one, and generated content is not reliably
        // announced. The pulse goes with it: the word carries the state.
        <div className="load absolute inset-0">
          <div className="flex flex-col items-center gap-3">
            <MapPin className="w-6 h-6 text-ink-lo" aria-hidden="true" />
            <span className="pr">Loading map</span>
          </div>
        </div>
      )}

      {/* Popup portal. Non-curated markers are itinerary stops and get the stop popup. */}
      {popupNode && popupMarker
        ? createPortal(
            (() => {
              const stop = enableStopPopup && !MARKER_BY_ID.has(popupMarker.id)
                ? (routeStops ?? []).find((s) => s.marker.id === popupMarker.id)
                : undefined;
              return stop ? (
                <ItineraryStopPopupContent stop={stop} />
              ) : (
                <MarkerPopupContent
                  marker={popupMarker}
                  enableFavorite={enablePopupFavorite}
                  enableDayAssign={enableDayAssign}
                  assignDays={assignDays}
                  onAssignDay={onAssignDay}
                />
              );
            })(),
            popupNode,
          )
        : null}

      {/* Dark overrides for MapLibre's popup and controls. These are DOM, so they use the
          live tokens; the GL canvas paint uses frozen hexes. */}
      <style>{`
        .njp-map-popup .maplibregl-popup-content {
          background: rgb(var(--surface-raised));
          color: var(--text-hi);
          border: var(--hair) solid hsl(var(--border));
          border-radius: var(--r-3);
          padding: 0.75rem;
          box-shadow: var(--shadow-lg);
          /* bound the popup height so its on-screen box is STABLE regardless of
             content (the "Anchor to a day" block can make it tall). An unbounded tall
             popup re-anchors/jitters against the map edge under continuous repaint,
             which made a re-opened popup's controls fail Playwright's stability check. */
          max-height: min(70vh, var(--njp-popup-max, 70vh));
          padding-right: calc(var(--tap) + 0.25rem);
          overflow-y: auto;
          /* if anything DOES scroll a popup control into view (Playwright's
             scrollIntoViewIfNeeded, or a keyboard user tabbing to the heart), leave
             room for the fixed navbar (h-16 = 4rem, ~4.25rem at the 17px root) so the
             control never parks under it and gets pointer-intercepted. */
          scroll-margin-top: 5.5rem;
          scroll-margin-bottom: 2rem;
        }
        .njp-map-popup .maplibregl-popup-tip {
          border-top-color: rgb(var(--surface-raised));
          border-bottom-color: rgb(var(--surface-raised));
        }
        .njp-map-popup .maplibregl-popup-close-button {
          color: var(--text-lo);
          font-size: var(--t-lead);
          width: var(--tap);
          height: var(--tap);
          padding: 0;
          right: 0;
          top: 0;
        }
        .njp-map-popup .maplibregl-popup-close-button:hover {
          color: var(--text-hi);
          background: rgb(255 255 255 / 0.05);
          border-radius: var(--r-1);
        }
        .maplibregl-ctrl-attrib {
          background: rgb(var(--surface) / 0.82) !important;
          color: var(--text-lo);
        }
        .maplibregl-ctrl-attrib a { color: var(--text-mid); }
        .maplibregl-ctrl-group {
          background: rgb(var(--surface-raised));
          border: var(--hair) solid hsl(var(--border));
          border-radius: var(--r-1);
        }
        .maplibregl-ctrl-group button {
          width: var(--tap);
          height: var(--tap);
        }
        .maplibregl-ctrl-group button + button {
          border-top: var(--hair) solid hsl(var(--border));
        }
        .maplibregl-ctrl-group button .maplibregl-ctrl-icon {
          filter: invert(1) brightness(1.4);
        }
      `}</style>
    </>
  );
});

export default TripMap;
