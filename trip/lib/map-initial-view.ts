import type { MapMarker } from '@/lib/map-data';
import { getActiveTrip } from '@/core/trips';
import { legLabel } from '@/lib/leg-label';
import { getTodayInTrip } from '@/lib/trip-now';

export type Bounds = [[number, number], [number, number]];

/** SW/NE box around the points, or null when there are none. */
export function boundsOf(points: readonly { lng: number; lat: number }[]): Bounds | null {
  if (points.length === 0) return null;
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity;
  for (const p of points) {
    minLng = Math.min(minLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLng = Math.max(maxLng, p.lng);
    maxLat = Math.max(maxLat, p.lat);
  }
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

/** The markers that belong to leg `legId` (a marker's `country` is its leg's label). */
export function markersForLeg(markers: readonly MapMarker[], legId: string): MapMarker[] {
  const label = legLabel(legId);
  return markers.filter((mk) => mk.country === label);
}

/**
 * The markers of the leg the traveller is in today, else the first leg (before or after the
 * trip). The map frames these first so a cold open fetches the tiles for where you are, not
 * the zoom-2 world tiles. Empty when no marker is on that leg (e.g. a custom trip).
 */
export function currentLegMarkers(markers: readonly MapMarker[]): MapMarker[] {
  const legId = getTodayInTrip()?.country ?? getActiveTrip().legs[0].id;
  return markersForLeg(markers, legId);
}
