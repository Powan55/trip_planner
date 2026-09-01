'use client';

import { getCountryForDate } from '@/core/dates';
import { lastTrainNotice } from '@/lib/travel-last-train';

/**
 * — Travel Mode last-train chip.
 * A thin client shell over the PURE `lastTrainNotice` static lookup —
 * no clock, no fetch, no storage. Japan-phase only (Nepal/Thamel is walk/taxi, per-day
 * country resolution decides this per `date`); the Dec 31 exception is baked into the lookup.
 *
 * This carries the screen's ONE accent fill. Everything else on `/travel` is true for the day you
 * picked; the last-train cutoff is the one mark that is true tonight and wrong tomorrow, so it is
 * the mark that gets stamped. The notice itself sits outside the stamp because it wraps — a
 * nowrap chip holding a full sentence overflows a 393px phone.
 *
 * @param date the resolved trip day.
 */
export default function TravelLastTrainChip({ date }: { date: string }) {
  const notice = lastTrainNotice(date, getCountryForDate(date));
  if (!notice) return null;

  return (
    <p
      data-testid="travel-last-train-chip"
      className="mx-auto mt-4 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-2 border-t-hair border-border px-gut py-3 text-t-sm text-ink-mid"
    >
      <span className="stamp stamp--live">Last train</span>
      <span className="min-w-0">{notice}</span>
    </p>
  );
}
