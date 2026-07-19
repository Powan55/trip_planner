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

import { useEffect, useMemo, useState } from 'react';
import { MapPinned } from 'lucide-react';
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
}

export default function PlanDayMap({ dayStops, totalItems, highlightId, onMarkerClick }: PlanDayMapProps) {
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

  return (
    <div
      data-testid="plan-day-map"
      data-stop-count={dayStops.length}
      data-total-count={totalItems}
      data-highlight-id={highlightId ?? ''}
      data-map-view={mapView}
      className="relative h-full w-full"
    >
      <TripMap
        markers={markers}
        routeStops={dayStops}
        highlightId={highlightId}
        fitBounds={fitBounds}
        onMarkerClick={(m) => onMarkerClick(m.id)}
        onReady={() => setReady(true)}
        onViewChange={(v) =>
          setMapView(`${v.lng.toFixed(4)},${v.lat.toFixed(4)},${v.zoom.toFixed(2)}`)
        }
      />

      {/* "N of M stops shown" — an honest, passive count so a day whose items
          don't ALL resolve to a marker (no pin, no name/sourceId match) isn't silently
          missing some. Subsumes the old zero-matched-stops hint (dayStops.length === 0
          reads as "0 of M stops shown"). Non-blocking overlay; static per render, so no
}          aria-live is needed. */
      {totalItems > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center p-3">
          <span
            data-testid="plan-day-map-count"
            className="inline-flex items-center gap-1.5 rounded-full bg-surface/85 px-3 py-1.5 text-xs text-white/65 backdrop-blur"
          >
            <MapPinned className="h-3.5 w-3.5" />
            {dayStops.length} of {totalItems} {totalItems === 1 ? 'stop' : 'stops'} shown
          </span>
        </div>
      )}
    </div>
  );
}
