'use client';

import { useEffect, useState } from 'react';
import { getNowAtTrip } from '@/lib/trip-now';
import { useTravelTick } from '@/lib/travel-tick';

/**
 * The destination-local trip day (`YYYY-MM-DD`), '' until mount (SSR-safe), re-read on the shared
 * travel tick so a PWA left open past midnight rolls to the new day instead of keeping yesterday (#791).
 * State only changes when the day string does, so a tick within the same day re-renders nothing.
 */
export function useTripDay(): string {
  const [day, setDay] = useState('');
  const tickN = useTravelTick();
  useEffect(() => setDay(getNowAtTrip().date), [tickN]);
  return day;
}

/** True once the trip-local day is past the last trip day. Pure so it is unit-testable. */
export function isAfterTrip(today: string, lastTripDate: string | undefined): boolean {
  return !!today && !!lastTripDate && today > lastTripDate;
}
