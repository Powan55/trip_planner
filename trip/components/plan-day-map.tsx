'use client';

// PlanDayMap — the day-scoped split-view map pane for /plan.
//
// A thin host around the reusable <TripMap>: it feeds ONE day's stops as
// BOTH `markers` (clickable browse pins) and `routeStops` (the numbered polyline),
// and wires the marker↔list highlight seam. It is loaded as a `dynamic(ssr:false)`
// island from calendar-planner, gated on the map-view toggle, so the ~200 kB
// maplibre chunk only fetches when the user actually opens the map.
//
// It owns no store state: `dayStops`/`highlightId` come down as props and
// marker clicks bubble up via `onMarkerClick`. The reorder-holds-camera rule lives
// here: we only re-fit when the SET of day markers changes (day switch / add /
// remove), never on a pure reorder (same set, new order) — see `idsKey` below.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, MapPinned, X } from 'lucide-react';
import TripMap from '@/components/trip-map';
import type { DayStop } from '@/lib/itinerary-map';

interface PlanDayMapProps {
  /** The selected day's coordinate stops (marker-matched), in itinerary order. */
  dayStops: DayStop[];
  /** Total items on the selected day (mapped + unmapped) — drives the "N of M" count. */
  totalItems: number;
  /** Marker id to emphasize on the map (drives TripMap's highlight paint). */
  highlightId: string | null;
  /** A map marker was clicked → bubble its id up so the list can highlight the row. */
  onMarkerClick: (markerId: string) => void;
  /**: the editor armed the coordinate picker — show the pick bar and arm TripMap. */
  pickMode?: boolean;
  /**: a coordinate was chosen (canvas click, or the keyboard "centre" button). */
  onPick?: (lngLat: { lng: number; lat: number }) => void;
  /**: the user backed out of picking. */
  onCancelPick?: () => void;
}

export default function PlanDayMap({
  dayStops,
  totalItems,
  highlightId,
  onMarkerClick,
  pickMode,
  onPick,
  onCancelPick,
}: PlanDayMapProps) {
  const markers = useMemo(() => dayStops.map((s) => s.marker), [dayStops]);

  // Re-fit ONLY when the marker SET changes (day switch / add / remove). A pure
  // reorder keeps the same sorted-id key → no re-fit → the camera holds still while
  // the polyline redraws in the new order.
  const idsKey = useMemo(() => markers.map((m) => m.id).sort().join(','), [markers]);
  const [ready, setReady] = useState(false);
  const [fitBounds, setFitBounds] = useState(true);
  // Gate the fit on the map being READY (the maplibre load is async — a wall-clock
  // release races it and the first fit is lost). Once ready, hold `fitBounds` true
  // long enough for TripMap's fit effect to run for this key, then release it so the
  // NEXT change that is a pure reorder (same idsKey → this effect doesn't re-run)
  // leaves the camera untouched.
  useEffect(() => {
    if (!ready) return;
    setFitBounds(true);
    const t = setTimeout(() => setFitBounds(false), 150);
    return () => clearTimeout(t);
  }, [ready, idsKey]);

  // Reflect the live camera into a data attribute so the split-view E2E can assert a
  // reorder leaves it unchanged (a jump would fire `moveend` → update this string).
  const [mapView, setMapView] = useState('');
  // the same camera, unformatted, for the keyboard "use centre" pick. Kept in a REF,
  // not state — `moveend` fires constantly and a fresh object in state would re-render the
  // pane on every camera tick (the string state above de-dupes itself and must keep doing so).
  const viewRef = useRef<{ lng: number; lat: number; zoom: number } | null>(null);
  const pickCentreRef = useRef<HTMLButtonElement>(null);
  // Arming the picker moves focus onto its primary control: the editor that armed it has just
  // gone visually hidden, so focus would otherwise fall to <body>.
  useEffect(() => {
    if (pickMode) pickCentreRef.current?.focus();
  }, [pickMode]);

  return (
    <div
      data-testid="plan-day-map"
      data-stop-count={dayStops.length}
      data-total-count={totalItems}
      data-highlight-id={highlightId ?? ''}
      data-map-view={mapView}
      data-pick-mode={pickMode ? 'true' : 'false'}
      className="relative h-full w-full"
    >
      <TripMap
        markers={markers}
        routeStops={dayStops}
        highlightId={highlightId}
        fitBounds={fitBounds}
        onMarkerClick={(m) => onMarkerClick(m.id)}
        onReady={() => setReady(true)}
        onViewChange={(v) => {
          viewRef.current = v;
          setMapView(`${v.lng.toFixed(4)},${v.lat.toFixed(4)},${v.zoom.toFixed(2)}`);
        }}
        pickMode={pickMode}
        onMapClick={(ll) => onPick?.(ll)}
      />

      {/* pin-pick bar — the ONLY chrome the picker adds, layered over the EXISTING
          pane (desktop aside or mobile sheet, whichever is mounted). No second map surface:
          the maplibre interaction-lazy boundary is untouched, because arming the
          picker just sets props on the instance that is already here.
          Keyboard parity: a canvas click is a pointer-only gesture, so "Use centre" places
          the pin at the current camera centre — maplibre's canvas already pans/zooms with
          the arrow keys and +/-, which makes that a complete keyboard path to any
          coordinate. Escape backs out (focus lives on the centre button, see the effect). */}
      {pickMode && (
        <div
          data-testid="plan-map-pick-bar"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              onCancelPick?.();
            }
          }}
          className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b border-white/10 bg-surface/95 px-3 py-2 backdrop-blur"
        >
          <p aria-live="polite" className="min-w-0 flex-1 text-xs text-ink-hi">
            Tap the map to place the pin
          </p>
          <button
            type="button"
            ref={pickCentreRef}
            data-testid="plan-map-pick-centre"
            onClick={() => {
              const v = viewRef.current;
              if (v) onPick?.({ lng: v.lng, lat: v.lat });
            }}
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-medium text-ink-hi transition-colors hover:bg-white/10 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
            Use centre
          </button>
          <button
            type="button"
            onClick={() => onCancelPick?.()}
            aria-label="Cancel placing the pin"
            data-testid="plan-map-pick-cancel"
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-ink-mid transition-colors hover:bg-white/10 hover:text-white outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* "N of M stops shown" — an honest, passive count so a day whose items
          don't ALL resolve to a marker (no pin, no name/sourceId match) isn't silently
          missing some. Subsumes the old zero-matched-stops hint (dayStops.length === 0
          reads as "0 of M stops shown"). Non-blocking overlay; static per render, so no
          aria-live is needed. */}
      {totalItems > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
          <span
            data-testid="plan-day-map-count"
            className="inline-flex items-center gap-1.5 rounded-full bg-surface/85 px-3 py-1.5 text-xs text-ink-mid backdrop-blur"
          >
            <MapPinned className="h-3.5 w-3.5" />
            {dayStops.length} of {totalItems} {totalItems === 1 ? 'stop' : 'stops'} shown
          </span>
        </div>
      )}
    </div>
  );
}
