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
  CircleDashed,
  type LucideIcon,
} from 'lucide-react';
import { type MapMarker, type MarkerCategory } from '@/lib/map-data';
import { buildMapStyle, CATEGORY_COLOR, BRAND } from '@/lib/map-style';
import { buildMapsDirectionsUrl } from '@/lib/maps-link';
import { MARKER_BY_ID, type DayStop } from '@/lib/itinerary-map';
import { footprintsToGeoJSON, type CountryFootprint } from '@/lib/visited-footprint';
import { MAP_PIN_DND_TYPE } from '@/lib/day-anchor';
import { prefersReducedMotion } from '@/lib/motion';
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
// Kept from the prior mock so the filter chips and popup badges stay in visual
// sync with the palette. The GL marker fills come from CATEGORY_COLOR (raw hex,
// in lib/map-style.ts) — same colors, different consumer. Exported so the /map
// chrome (the filter chips in MapSection) shares the same table. ( deleted
// the duplicate legend that used to render this table a second time.)
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
  // was cyan-500 — the SAME hue as the interactive signal (hsl 189), so a
  // "Day Trip" chip could not be told from a focused control by hue. Moved to green-500 (142
  // deg, 47 deg off the signal). MUST stay byte-in-sync with CATEGORY_COLOR in lib/map-style.ts
  // (the GL paint layer) — that mirror is hand-synced with no compiler tie.
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
const ITIN_SOURCE_ID = 'itinerary-route';
// Issue #31 — the visited footprint wash. Its source and layers are added FIRST in the `load`
// handler so every marker, route line and label paints on top of it.
const VISITED_SOURCE_ID = 'visited-footprint';

// 🔴 NOT the default camera — mislabelled for a long time, corrected in.
// This is only (a) the frame the Map is CONSTRUCTED with, i.e. what is on screen for the few
// frames before the style loads, and (b) the frame that survives when the marker set is EMPTY.
// The moment `mapReady` flips, the marker-fit effect below (deps: markers/mapReady/fitBounds,
// and `fitBounds` defaults true) refits the camera to the visible markers and overwrites this.
// So widening these bounds to "reach" a place looks like a fix and changes nothing visible —
// what a place needs in order to be reachable is a way to ADDRESS it, not a
// wider startup box.
const ALL_BOUNDS: LngLatBoundsLike = [
  [83.0, 27.0], // SW (west of Kathmandu Valley)
  [141.0, 36.5], // NE (east of Tokyo)
];

// Read prefers-reduced-motion at call time. MapLibre camera moves branch
// on this: flyTo/easeTo when motion is allowed, instant jumpTo when reduced.
// Issue #24: the local copy is gone; the shared `prefersReducedMotion()` in
// lib/motion.ts reads at call time too, so D-079's "at call time" property holds.

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

// camera offset (px, [x, y]) applied when a marker is centred for its popup.
// Positive y seats the marker BELOW the container centre, leaving room ABOVE it for
// the bottom-anchored popup so its top controls stay inside the shell / below the
// fixed navbar. Sized for the tallest realistic popup after A5's 17px body bump.
const POPUP_VIEW_OFFSET: [number, number] = [0, 150];

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
    <div className="plate w-[248px] max-w-[80vw]" data-leg={marker.country === 'Japan' ? 'japan' : 'nepal'}>
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
          {/* `/40`→`/55` — axe
              caught this pre-existing AA contrast fail (3.72:1) once a real E2E
              scanned the popup with content OPEN for the first time (the earlier
              /map axe pack never opens a popup, so this was never exercised). */}
          <p className="pr pr--lo flex items-center gap-1 mb-1.5">
            <MapPin className="w-3 h-3" aria-hidden="true" />
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
            className={`ml-auto shrink-0 grid h-8 w-8 place-items-center rounded-r1 border-hair transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
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

      {/* "Anchor to a day" — assign this pin to a trip day so that day's stops
          re-order by distance from it. THREE equivalent affordances (a11y floor):
          the day <select> + Assign button is the keyboard AND touch path (HTML5 drag
          never fires on touch); the drag handle is a desktop-pointer convenience that
          drops onto the day strip (map-section.tsx). enableDayAssign gates the whole
          block to /map — /plan's day-map omits it (like enablePopupFavorite). */}
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
  );
}

// ── /(b): the popup for a DRAWN ITINERARY STOP ──────────────────
// A stop is not a curated place: it is one or more of the user's own plans, at a point that
// was either asserted (a pin) or DERIVED (a district, the day's city). So it gets its own,
// quieter popup — no Directions to a centroid, no "add this place to your plan" for a place
// that is already in the plan, and no favourite heart on a synthesized marker.
// The approximate note QUOTES ITS OWN SOURCE verbatim — the user can check the
// claim — and the distinction is carried by an icon + words, so it survives greyscale.
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
  /**
   * Issue #22 — fly the camera to a bare coordinate. NO popup, NO marker, no `MapMarker`
   * anywhere in the call.
   *
   * 🔴 That is the whole point, not a shortcut. The caller is the world search, whose results are
   * places the trip knows nothing about: they have no curated `area`, no `description`, and no
   * real `country` — and `MapMarker.country`, rendered verbatim in the popup as "{area} ·
   * {country}", is only ever legLabel(day.country)-derived or hand-authored curated content.
   * Synthesising a marker for Reykjavík would have to invent one of those, which is D-271's
   * defect class (a surface asserting something untrue) in one line. The popup would also offer
   * "Add to plan", and `ItineraryDraft` carries no coordinate
   * (D-280, deferred), so the point the user just picked would be dropped on the way into the
   * itinerary and the item would re-place itself at the day's city centroid.
   *
   * So the camera moves and nothing claims to be a pin. Reduced-motion branches exactly like
   * `focusMarker`; no `POPUP_VIEW_OFFSET`, because there is no popup to leave room for, so the
   * place lands centred.
   */
  flyToPoint: (lat: number, lng: number) => void;
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
   * Ordered itinerary stops → the day-grouped route polyline + stops numbered by their
   * per-day `seq`. Empty/undefined = no route drawn, which is how a day with nothing
   * planned CLEARS the route (issue #1). /map passes the selected day's stops when "My
   * itinerary" is on (the whole trip's when no day is selected); /plan passes one day and
   * re-draws live on reorder
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
  /**
   * /(b): clicking a drawn itinerary stop opens a popup naming the plan(s) at
   * that point and, when the position was DERIVED, the verbatim text it was derived from plus
   * the way to fix it. /map's `MapSection` passes `true`. `/plan`'s day-map omits it — there
   * the same points are already clickable browse markers (it feeds one array as both
   * `markers` and `routeStops`), so registering this would open two popups for one click.
   */
  enableStopPopup?: boolean;
  /**
   * pin-pick seam: while true the canvas is a coordinate picker — the cursor turns to
   * a crosshair, marker/cluster clicks stop opening popups (a click on a pin must PLACE a
   * pin, not browse one), and every click reports its lng/lat through `onMapClick`. Default
   * undefined ⇒ browse behavior is byte-identical for every other consumer.
   */
  pickMode?: boolean;
  /** Fired with the clicked coordinate, ONLY while `pickMode` is on. */
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  /**
   * Issue #31 — the visited-footprint wash, one soft shape per country the visit record
   * confirms. Empty/undefined draws nothing, which is what every consumer except `/map` does.
   *
   * 🔴 THESE ARE NOT NATIONAL BORDERS and the layers below must never be styled as though they
   * were. Each ring is the padded convex hull of the cities you have actually been to
   * (`lib/visited-footprint.ts`, which explains at length why no polygon dataset was added).
   * The paint is deliberately a soft fill with a faint edge rather than a crisp outline — an
   * outline reads as a boundary claim, and this is a wash over ground you covered. The host is
   * responsible for saying so in words; `components/map-section.tsx` does.
   */
  countryFills?: CountryFootprint[];
}

// ── TripMap: the reusable MapLibre engine ─────────────────────────────────────
// Owns the container, lazy maplibre-gl load, style/controls, the browse-marker
// source/layers, the itinerary route source/layers, popups, and reduced-motion
// camera behavior. It renders ONLY the map surface (canvas container + loading
// skeleton); the host wrapper, fullscreen slot-swap and filters are the
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
    enableStopPopup,
    pickMode,
    onMapClick,
    countryFills,
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
    // seat the marker BELOW the container centre so the popup (anchored
    // above the marker) opens fully inside the map-shell — clear of the shell's
    // own `overflow-hidden` clip AND of the fixed navbar band. A5's 17px body grew
    // the popup enough that a centred marker pushed its top controls (the favourite
    // heart) above the shell/under the navbar, where they were click-intercepted.
    // The offset is a LAYOUT correction, so reduced motion picks the DURATION, not
    // whether the move happens — same shape as `focusMarker` below. Gating the whole
    // call left reduced-motion users with a clipped close button and heart.
    map.easeTo({
      center: [marker.lng, marker.lat],
      offset: POPUP_VIEW_OFFSET,
      duration: prefersReducedMotion() ? 0 : 400,
    });
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
        // easeTo(duration:0) is an instant jump that ALSO honours `offset` (jumpTo
        // does not), so the marker lands below-centre and the popup opens in-shell.
        map.easeTo({ center: [marker.lng, marker.lat], zoom, offset: POPUP_VIEW_OFFSET, duration: 0 });
        openPopup(maplibregl, marker);
      } else {
        map.flyTo({ center: [marker.lng, marker.lat], zoom, offset: POPUP_VIEW_OFFSET, duration: 900 });
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

  // Expose resize() + focusMarker() + flyToPoint() to the host chrome. MapLibre sizes the
  // canvas on construction; by the time the lazy import resolves and the Map is
  // created, MapSection's relocation effect has already moved the host into its
  // sized inline slot, so no on-ready resize is needed.
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
            // Gold at 0.12 — present enough to read as "this ground is yours" on the navy
            // basemap, faint enough that a marker sitting on it keeps its own colour. Overlap
            // between two countries' shapes is impossible (they are built from disjoint city
            // sets), so no compounding to reason about.
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
          clusterMaxZoom: 8,
        });

        // Cluster bubbles.
        map!.addLayer({
          id: 'clusters',
          type: 'circle',
          source: MARKERS_SOURCE_ID,
          filter: ['has', 'point_count'],
          paint: {
            // clusters were solid gold at 0.85 — the SAME gold family as the
            // `Attraction` category pin, so "a cluster of 8" and "one attraction" read
            // identically at a glance. A neutral glass fill separates the vocabularies:
            // clusters read as chrome, pins read as content.
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
        // /(a): an APPROXIMATE stop is a different MARK, not a different
        // colour — a hollow ring (dark core, gold rim) against the exact stop's solid gold
        // disc. Shape and lightness both differ, so the distinction survives greyscale;
        // colour alone would not clear the project's contrast floor.
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
        // Issue #1 — the number on a pin is the stop's position WITHIN ITS DAY (1, 2, 3 …
        // in itinerary order), not the trip-day index this used to draw. On /plan and
        // /travel, which feed one day, that index was the constant "1" on every pin; on
        // /map it turned a day's whole route into a row of identical numbers.
        // 🔴 Still a NUMERIC label only, deliberately: issue #8 self-hosts exactly range
        // 0-255 of two font stacks (lib/map-style.ts) so these digits survive offline on a
        // Kathmandu street. Anything that puts non-numeric text in this field reintroduces
        // a glyph range nobody has shipped.
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
        for (const id of ['clusters', 'unclustered']) {
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
        map!.on('click', 'unclustered', (e) => {
          if (pickModeRef.current) return; // a pick click places a pin, never browses
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          const id = f?.properties?.id as string | undefined;
          const marker = id ? MARKER_BY_ID.get(id) : undefined;
          if (!marker) return;
          openPopup(maplibregl, marker);
          onMarkerClickRef.current?.(marker);
        });

        // a drawn itinerary stop click → the stop popup. Registered once,
        // gated on a ref so it is INERT for every consumer that doesn't opt in — /plan feeds
        // one array as both `markers` and `routeStops`, so an ungated handler there would
        // fire alongside the `unclustered` one and open two popups for a single click.
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

        // pin-pick: ANY click on the canvas reports its coordinate while the picker is
        // armed. Registered on the map (not a layer) so empty water/street clicks count too —
        // that is the whole point of dropping a pin somewhere with no curated marker. Inert
        // (a ref read + early return) for every consumer that never sets `pickMode`.
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

    // Issue #1 — the mirror of the browse-marker rule above ("close any open popup whose
    // marker is no longer in the visible set"), and it is load-bearing now that /map scopes
    // the route to one day: an open STOP popup whose stop has just left `routeStops` would
    // otherwise keep rendering, and the portal below — which falls back to the CURATED popup
    // for a marker it can no longer find in `routeStops` — would quietly turn it into
    // Directions-to-a-city-centroid, the exact thing D-279 exists to prevent. Curated markers
    // are excluded because their popup is legitimate with or without a route.
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
          // `id` (additive; /map ignores it) lets the highlight effect target
          // this numbered route-stop by marker id. `approx` drives the
          // low-confidence paint above — it is read straight off the placement the
          // resolver returned for this render, never off stored state. `seq` is what the
          // label layer draws (issue #1); `day` stays for the popup heading.
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
    // `popupMarker` is read but deliberately NOT a dep — same as the marker effect above.
    // It must not re-run this effect (that would re-fit the camera every time a popup
    // opens); the closure that runs on a routeStops change already carries that render's
    // value, which is exactly the popup that was open when the stops changed.
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
      {/* (a11y): this was `role="application"` with NO tabIndex. That role tells a
          screen reader to stop intercepting keys and hand every keystroke to the app — but
          the element could not receive focus, so the promise was never kept. It passed axe,
          which is why it survived. MEASURED in a real browser: MapLibre puts
          `tabindex="0"` + `aria-label="Map"` on its own CANVAS (a child of this div), and
          that canvas is what takes focus and handles arrow-pan / ±-zoom. The container
          handles no keys at all, so it is a labelled REGION, not an application widget —
          the SR keeps its normal reading keys and the canvas keeps its native keyboard. */}
      <div
        ref={containerRef}
        className="h-full w-full"
        aria-label="Interactive map of trip destinations across Nepal and Japan"
        role="region"
      />

      {/* Loading skeleton until the GL canvas is ready. */}
      {!mapReady && (
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

      {/* Popup content portal: stays in this React tree so context flows
          to AddToPlanButton, while its DOM lives inside the MapLibre Popup.
          a popup opened on a marker that is NOT one of the 27 curated places is an
          ITINERARY STOP — a synthesized pin or a derived position — so it gets the stop
          popup instead of the curated one (which would offer Directions to a city centroid
          and "add this place to your plan" for a plan that already exists). */}
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

      {/* Scoped overrides for the MapLibre popup + controls. A plain <style> element
          (local to this component; globals.css owns the token layer) — the default chrome
          is light, so it is retinted here.

          THE SEAM. These read the LIVE surface tokens rather than the BRAND.navy* copies
          two lines of JS away, because this is DOM the page repaints and the canvas is not.
          A ramp change reaches the popup on its own now; the GL paint properties below
          still take the frozen hexes, which is the rule for the canvas. */}
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
          max-height: 70vh;
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
          padding: 2px 7px;
          right: 2px;
          top: 2px;
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
