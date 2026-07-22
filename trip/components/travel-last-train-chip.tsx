'use client';

import { Train } from 'lucide-react';
import { getCountryForDate } from '@/core/dates';
import { lastTrainNotice } from '@/lib/travel-last-train';

/**
 * — Travel Mode last-train chip.
 * A thin client shell over the PURE `lastTrainNotice` static lookup —
 * no clock, no fetch, no storage. Japan-phase only (Nepal/Thamel is walk/taxi, per-day
 * country resolution decides this per `date`); the Dec 31 exception is baked into the lookup.
 *
 * @param date the resolved trip day.
 */
export default function TravelLastTrainChip({ date }: { date: string }) {
  const notice = lastTrainNotice(date, getCountryForDate(date));
  if (!notice) return null;

  return (
    <p
      data-testid="travel-last-train-chip"
      className="mx-auto mt-3 flex max-w-2xl items-center justify-center gap-1.5 text-center text-xs text-white/50"
    >
      <Train className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {notice}
    </p>
  );
}
