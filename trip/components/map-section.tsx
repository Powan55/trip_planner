'use client';

// The maplibre-gl base stylesheet (positions the canvas, controls, popups). A
// static side-effect import so Next/webpack bundles it with THIS component — and
// since the whole component is loaded via dynamic(ssr:false) from the /map page,
// the CSS ships only on the map route.
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { m } from 'framer-motion';
import {
  Landmark,
  UtensilsCrossed,
  Hotel,
  Camera,
  Bus,
  ShoppingBag,
  Sparkles,
  MapPin,
  X,
  Maximize2,
  Minimize2,
  Route as RouteIcon,
  LocateFixed,
  type LucideIcon,
} from 'lucide-react';
import {
  MAP_MARKERS,
  MARKER_CATEGORIES,
  type MapMarker,
  type MarkerCategory,
} from '@/lib/map-data';
import { buildMapStyle, CATEGORY_COLOR, BRAND } from '@/lib/map-style';
import OptimizedImage from '@/components/optimized-image';
import AddToPlanButton from '@/components/add-to-plan-button';
import { useItineraryContext } from '@/components/itinerary-provider';
import { formatDate } from '@/lib/trip-data';
import type { DayPlan, ItineraryItem } from '@/lib/trip-data';

// maplibre-gl is imported for its TYPES only at module scope; the real runtime
// module is loaded LAZILY (dynamic import) inside the init effect so it never
// lands on the route's first-load bundle (it is ~200 kB gzip). See initMap().
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
// (raw hex, in lib/map-style.ts) — same colors, different consumer.
const CATEGORY_STYLES: Record<
  MarkerCategory,
  { icon: LucideIcon; pin: string; badge: string }
> = {
  Attraction: {
    icon: Landmark,
    pin: 'bg-gold-500 text-navy-900',
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
    pin: 'bg-cyan-500 text-navy-900',
    badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
  },
  Shopping: {
    icon: ShoppingBag,
    pin: 'bg-sakura-500 text-white',
    badge: 'bg-sakura-500/20 text-sakura-300 border-sakura-500/30',
  },
  Cultural: {
    icon: Sparkles,
    pin: 'bg-amber-500 text-navy-900',
    badge: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  },
};

type FilterValue = MarkerCategory | 'All';

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

// ── Itinerary → coordinates join ──────────────────────────────────────────────
// Planned items match a curated marker by (a) sourceId when present (card-created
// items), else (b) a name match against the marker vocabulary so the rich
// SAMPLE_ITINERARY (which predates sourceId) still plots. Items with no coordinate
// match (custom/transport/food-at-a-non-marker) are simply skipped — never crash.
const MARKER_BY_ID = new Map(MAP_MARKERS.map((mk) => [mk.id, mk]));

// Precompute lowercased key fragments per marker for cheap contains-matching.
const NAME_INDEX = MAP_MARKERS.map((mk) => {
  // A short, distinctive key: the primary proper-noun of the place name.
  const keys = [mk.name.toLowerCase()];
  // Add a few well-known short aliases so sample titles like "Sunset at
  // Boudhanath Stupa" or "Dawn at Fushimi Inari" resolve.
  const primary = mk.name
    .toLowerCase()
    .replace(/\(.*?\)/g, '') // drop parentheticals
    .replace(/\b(temple|stupa|square|taisha|shrine|market|crossing|grove|park|viewpoint|bazaar|castle|monastery|hotel|restaurant)\b/g, '')
    .trim();
  if (primary && primary.length >= 4) keys.push(primary);
  return { marker: mk, keys };
});

function matchMarker(item: ItineraryItem): MapMarker | null {
  // 1) Exact sourceId join (curated map-card items).
  if (item.sourceId && MARKER_BY_ID.has(item.sourceId)) {
    return MARKER_BY_ID.get(item.sourceId)!;
  }
  // 2) Name contains-match against the marker vocabulary (sample items).
  const hay = `${item.title} ${item.location ?? ''}`.toLowerCase();
  for (const { marker, keys } of NAME_INDEX) {
    for (const k of keys) {
      if (k && hay.includes(k)) return marker;
    }
  }
  return null;
}

interface DayStop {
  day: number; // 1-based day index within the trip
  date: string;
  marker: MapMarker;
  title: string;
}

// Flatten plans → an ordered list of coordinate stops, numbered by trip day.
// One stop per marker-per-day (first match wins) so a day's route reads cleanly.
function buildItineraryStops(plans: DayPlan[]): DayStop[] {
  const sorted = [...plans].sort((a, b) => a.date.localeCompare(b.date));
  const stops: DayStop[] = [];
  sorted.forEach((plan, idx) => {
    const seen = new Set<string>();
    for (const item of plan.items ?? []) {
      const marker = matchMarker(item);
      if (!marker || seen.has(marker.id)) continue;
      seen.add(marker.id);
      stops.push({ day: idx + 1, date: plan.date, marker, title: item.title });
    }
  });
  return stops;
}

// Build the GeoJSON FeatureCollection for the browse markers (filtered set).
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
// Rendered via createPortal so it stays in MapSection's React tree (context flows
// → AddToPlanButton works) while its DOM lives inside the in-canvas Popup.
function MarkerPopupContent({ marker }: { marker: MapMarker }) {
  const [imgError, setImgError] = useState(false);
  const style = CATEGORY_STYLES[marker.category];
  const Icon = style.icon;
  return (
    <div className="w-[248px] max-w-[80vw]">
      {marker.image && !imgError && (
        <div className="relative -mx-3 -mt-3 mb-3 aspect-[16/9] overflow-hidden rounded-t-xl bg-navy-800">
          <OptimizedImage
            src={marker.image}
            alt={marker.name}
            fill
            sizes="248px"
            className="object-cover"
            onError={() => setImgError(true)}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy-900/80 to-transparent" />
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
            <h4 className="font-display font-bold text-white text-sm leading-tight">
              {marker.name}
            </h4>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded-full border ${style.badge}`}
            >
              {marker.category}
            </span>
          </div>
          <p className="flex items-center gap-1 text-[11px] text-white/40 mb-1.5">
            <MapPin className="w-3 h-3" />
            {marker.area} · {marker.country}
          </p>
        </div>
      </div>
      <p className="text-xs text-white/60 leading-relaxed mt-1.5">
        {marker.description}
      </p>
      <AddToPlanButton
        source={marker}
        sourceType="map"
        accentColor={
          marker.country === 'Nepal' ? 'text-himalaya-400' : 'text-sakura-400'
        }
      />
    </div>
  );
}

export default function MapSection() {
  const { plans } = useItineraryContext();

  const [filter, setFilter] = useState<FilterValue>('All');
  const [mapReady, setMapReady] = useState(false);
  const [showItinerary, setShowItinerary] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [geoNote, setGeoNote] = useState<string | null>(null);
  // The marker whose popup is currently open — drives the React portal content.
  const [popupMarker, setPopupMarker] = useState<MapMarker | null>(null);

  // Portal mount guard: createPortal(…, document.body) must never
  // run during the static-export prerender (output:'export' has no document).
  // The fullscreen shell only ever portals AFTER a client interaction, but we
  // guard the render anyway so SSR stays a no-op — same pattern as
  // add-to-itinerary-dialog.tsx.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MLMap | null>(null);
  const popupRef = useRef<MLPopup | null>(null);
  // The DOM node inside the open popup that we portal React content into.
  const [popupNode, setPopupNode] = useState<HTMLElement | null>(null);

  // The GL map lives inside a single, persistent host div (`mapHostRef`) that we
  // physically relocate between an inline slot and the portaled fullscreen slot.
  // React never reparents this node (it renders once, at the component
  // root, and we move it with appendChild), so the MapLibre instance attached to
  // `containerRef` survives fullscreen enter/exit with zero state loss — only its
  // size changes, which map.resize() reconciles.
  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const inlineSlotRef = useRef<HTMLDivElement | null>(null);
  const fullscreenSlotRef = useRef<HTMLDivElement | null>(null);

  const visibleMarkers = useMemo(
    () =>
      filter === 'All'
        ? MAP_MARKERS
        : MAP_MARKERS.filter((mk) => mk.category === filter),
    [filter],
  );

  // Itinerary stops: derived from the shared store, so it live-updates on
  // any itinerary:changed fan-out (the provider re-renders us with new `plans`).
  const stops = useMemo(
    () => (showItinerary ? buildItineraryStops(plans) : []),
    [plans, showItinerary],
  );

  // ── Map initialization (client-only, lazy maplibre-gl) ──────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    let cancelled = false;
    let map: MLMap | null = null;

    (async () => {
      const maplibregl: MapLibreNS = await import('maplibre-gl');
      if (cancelled || !containerRef.current) return;

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
        setGeoNote(
          'Location unavailable — permission denied or unsupported. The map still works; browse or use the filter.',
        );
      });
      geolocate.on('geolocate', () => setGeoNote(null));

      map.on('load', () => {
        if (cancelled) return;

        // Browse markers — clustered GeoJSON source.
        map!.addSource(MARKERS_SOURCE_ID, {
          type: 'geojson',
          data: markersToGeoJSON(MAP_MARKERS) as never,
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

        // Itinerary route source (empty until the overlay is toggled on).
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

        // Unclustered point click → open a rich popup.
        map!.on('click', 'unclustered', (e) => {
          const f = e.features?.[0] as MapGeoJSONFeature | undefined;
          const id = f?.properties?.id as string | undefined;
          const marker = id ? MARKER_BY_ID.get(id) : undefined;
          if (!marker) return;
          openPopup(maplibregl, marker);
        });

        setMapReady(true);
      });
    })();

    return () => {
      cancelled = true;
      popupRef.current?.remove();
      popupRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open (or move) the in-canvas popup for a marker, and expose its content node
  // so React can portal the interactive content in.
  const openPopup = useCallback(
    (maplibregl: MapLibreNS, marker: MapMarker) => {
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
      popup
        .setLngLat([marker.lng, marker.lat])
        .setDOMContent(holder)
        .addTo(map);
      setPopupNode(holder);
      setPopupMarker(marker);
      if (!prefersReducedMotion()) {
        map.easeTo({ center: [marker.lng, marker.lat], duration: 400 });
      }
    },
    [],
  );

  // ── Filter → update the source data + camera to the filtered bounds ─────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(MARKERS_SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(markersToGeoJSON(visibleMarkers) as never);
    // Close any open popup that no longer matches the filter.
    if (
      popupMarker &&
      filter !== 'All' &&
      popupMarker.category !== filter
    ) {
      popupRef.current?.remove();
    }
    if (visibleMarkers.length === 0) return;

    // Fit to the filtered set (flyTo animation, or jumpTo under reduced-motion).
    let minLng = Infinity,
      minLat = Infinity,
      maxLng = -Infinity,
      maxLat = -Infinity;
    for (const mk of visibleMarkers) {
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
  }, [visibleMarkers, filter, mapReady]);

  // ── Itinerary overlay → rebuild the route source when stops change ──────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const src = map.getSource(ITIN_SOURCE_ID) as GeoJSONSource | undefined;
    if (!src) return;

    if (!showItinerary || stops.length === 0) {
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
          properties: { day: String(s.day), title: s.title, date: s.date },
        });
      }
    }
    src.setData({ type: 'FeatureCollection', features } as never);

    // Fit to the planned stops on first turn-on.
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
  }, [stops, showItinerary, mapReady]);

  // ── Map-host relocation ─────────────────────────────────────────────────────
  // Physically move the persistent map-host node between the inline slot and the
  // portaled fullscreen slot (createPortal only reparents React-managed subtrees;
  // the map-host is moved imperatively so MapLibre's canvas is never destroyed).
  // Runs on mount (host → inline slot) and on every isFullscreen change; calls
  // map.resize() after each move so MapLibre recomputes its cached canvas size.
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
    const raf = requestAnimationFrame(() => mapRef.current?.resize());
    const raf2 = requestAnimationFrame(() =>
      requestAnimationFrame(() => mapRef.current?.resize()),
    );
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
    };
  }, [isFullscreen, mounted, mapReady]);

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
      requestAnimationFrame(() => mapRef.current?.resize());
    };
  }, [isFullscreen]);

  const handleFilter = (value: FilterValue) => setFilter(value);

  const filters: FilterValue[] = ['All', ...MARKER_CATEGORIES];
  const plannedCount = stops.length;

  return (
    <section
      id="map"
      aria-labelledby="map-heading"
      className="py-20 px-4 sm:px-6"
    >
      <div className="max-w-[1200px] mx-auto">
        {/* Slide-only masthead entrance (opacity pinned to 1) — see the
            RecommendationSection masthead for the full rationale. Keeps the
            (non-reduced-motion) axe scan from catching the muted `text-white/50`
            subtitle mid-fade and flagging a transient contrast failure. */}
        <m.div
          initial={{ opacity: 1, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-8"
        >
          <h2
            id="map-heading"
            className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3"
          >
            Interactive <span className="text-gradient-gold">Map</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">
            A real, pannable map of every place across the Kathmandu Valley and
            Japan. Filter by category, tap a pin for details, or flip on your
            itinerary to see the plan take shape day by day.
          </p>
        </m.div>

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
        </div>

        {/* Overlay + fullscreen controls. */}
        <div className="flex flex-wrap justify-center items-center gap-2 mb-5">
          <button
            type="button"
            onClick={() => setShowItinerary((v) => !v)}
            aria-pressed={showItinerary}
            data-testid="map-itinerary-toggle"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60 ${
              showItinerary
                ? 'bg-gold-500/20 text-gold-300 border-gold-500/40'
                : 'text-white/50 border-white/10 hover:bg-white/5 hover:text-white/70'
            }`}
          >
            <RouteIcon className="w-3.5 h-3.5" />
            My itinerary
            {showItinerary && (
              <span className="text-gold-400/80" aria-hidden="true">
                · {plannedCount} {plannedCount === 1 ? 'stop' : 'stops'}
              </span>
            )}
          </button>
        </div>

        {geoNote && (
          <div
            role="status"
            className="max-w-md mx-auto mb-4 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60"
          >
            <LocateFixed className="w-3.5 h-3.5 shrink-0 mt-0.5 text-white/40" />
            <span>{geoNote}</span>
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
          MapLibre instance on containerRef survives fullscreen toggles.
          className toggles inline (absolute, fills the relative inline slot) vs
          fullscreen (fixed inset-0 → resolves against the VIEWPORT because its
          parent is the body-portaled shell, escaping the glass-card
          backdrop-filter containing block). */}
      <div
        ref={mapHostRef}
        data-testid="map-shell"
        className={
          isFullscreen
            ? 'fixed inset-0 z-[65] bg-navy-900'
            : 'absolute inset-0'
        }
      >
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
          <div className="absolute inset-0 grid place-items-center bg-navy-900">
            {/* Loading label `/40`→`/55` so "Loading map…" clears AA (3.76→6.22)
                on the navy skeleton while the GL canvas mounts. */}
            <div className="flex flex-col items-center gap-3 text-white/55">
              <MapPin className="w-6 h-6 motion-safe:animate-pulse" />
              <span className="text-xs">Loading map…</span>
            </div>
          </div>
        )}

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

      {/* Popup content portal: stays in this React tree so context flows
          to AddToPlanButton, while its DOM lives inside the MapLibre Popup. */}
      {popupNode && popupMarker
        ? createPortal(<MarkerPopupContent marker={popupMarker} />, popupNode)
        : null}

      {/* Scoped dark-brand overrides for the MapLibre popup + controls. A plain
          <style> element (local to this component, not globals.css) — the default
          popup/control chrome is light, so we retint it to
          the navy/gold palette. */}
      <style>{`
        .njp-map-popup .maplibregl-popup-content {
          background: ${BRAND.navy800};
          color: #fff;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 0.75rem;
          padding: 0.75rem;
          box-shadow: 0 12px 32px rgba(0,0,0,0.55);
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
    </section>
  );
}
