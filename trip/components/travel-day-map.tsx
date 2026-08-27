'use client';

// — Travel Mode per-day map. "A map with pinned places for that specific day only, nothing
// more, only that specific day's plans, and it should update as I change the days."
//
// This file is a MOUNT, not a new map: the pane is the existing `<PlanDayMap>`, fed
// exactly the way `/plan` feeds it (`buildItineraryStops([dayPlan])`, `lib/itinerary-map.ts`), so
// the marker join, the reorder-holds-camera rule and the honest "N of M stops shown" overlay are
// all the same code. Nothing whole-trip is passed: ONE day plan goes in, so only that day's stops
// can come out. `date` is the SAME resolved `?date=` day the hero/agenda get (travel-date-picker
// passes it down) — so flipping a day chip re-renders this island with a new `date`, a new day
// plan, and a new marker set, and PlanDayMap re-fits because the marker-id SET changed.
//
// Collapsed by default for two reasons: on a
// 390×844 phone an always-open 320px map would shove the day's checklist off-screen, and the
// ~200 kB maplibre chunk must stay interaction-lazy — so the <PlanDayMap> island is only
// RENDERED while open, never merely hidden. The open/closed choice is component state inside the
// island that owns the whole page, so it survives day changes: open it once and the pins then
// follow every chip tap.

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown } from 'lucide-react';
import { useItineraryContext } from '@/components/itinerary-provider';
import MapIslandBoundary from '@/components/map-island-boundary';
import { buildItineraryStops } from '@/lib/itinerary-map';

const PlanDayMap = dynamic(() => import('@/components/plan-day-map'), {
  ssr: false,
  loading: () => (
    <div className="load h-full w-full">
      <span className="pr pr--lo">Loading map</span>
    </div>
  ),
});

export default function TravelDayMap({ date }: { date: string }) {
  const { getDayPlan } = useItineraryContext();
  const dayPlan = getDayPlan(date);
  const dayStops = useMemo(() => buildItineraryStops([dayPlan]), [dayPlan]);
  const totalItems = dayPlan.items?.length ?? 0;

  const [open, setOpen] = useState(false);
  const [clickedId, setClickedId] = useState<string | null>(null);
  // Tapping a pin emphasizes it. DERIVED (not an effect): a highlight left over from the previous
  // day simply isn't in this day's stop set, so it drops itself on a day change — no stale id, no
  // clear-on-date effect to keep in sync.
  const highlightId = dayStops.some((s) => s.marker.id === clickedId) ? clickedId : null;

  return (
    <details
      data-testid="travel-day-map"
      data-stop-count={dayStops.length}
      data-total-count={totalItems}
      // The exact marker ids feeding the pane, so the E2E can assert the pins CHANGED (not just
      // that the count changed) when the day changes — plan-day-map's own data-* are count-only.
      data-stop-ids={dayStops.map((s) => s.marker.id).join(',')}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group mx-auto mt-4 max-w-2xl border-t-2 border-border"
    >
      <summary
        data-testid="travel-day-map-summary"
        className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 px-gut py-2 outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden"
      >
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h2 className="pr pr--l text-ink-hi">Today&rsquo;s map</h2>
          <span className="pr pr--lo" data-testid="travel-day-map-count">
            {totalItems === 0
              ? 'nothing planned'
              : `${dayStops.length} of ${totalItems} ${totalItems === 1 ? 'stop' : 'stops'} pinned`}
          </span>
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-ink-lo transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>

      <div className="px-gut pb-3">
        {dayStops.length === 0 ? (
          <p data-testid="travel-day-map-empty" className="empty pb-2">
            {totalItems === 0
              ? 'Nothing planned for this day yet — plan something and it lands on the map.'
              : `None of this day's ${totalItems} ${totalItems === 1 ? 'item has' : 'items have'} a map location yet.`}
          </p>
        ) : (
          // Rendered ONLY while open: the maplibre chunk stays interaction-lazy, and a
          // collapsed <details> would otherwise keep it mounted (its content is hidden, not
          // unmounted). Sized here because PlanDayMap is h-full/w-full.
          // /: wrapped, because this is one of the 3 call sites gen-sw.mjs
          // reports as maplibre-reduced. Its chunk is deliberately not precached, so
          // cold-offline React.lazy throws here; unwrapped, Travel Mode's whole
          // /travel/ route would drop to app/error.tsx when someone opens the day map.
          <div className="h-[300px] overflow-hidden rounded-r1 border-hair border-border sm:h-[360px]">
            {open && (
              <MapIslandBoundary label="The day map">
                <PlanDayMap
                  dayStops={dayStops}
                  totalItems={totalItems}
                  highlightId={highlightId}
                  onMarkerClick={setClickedId}
                />
              </MapIslandBoundary>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
