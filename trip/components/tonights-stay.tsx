'use client';

import { useState } from 'react';
import { useItineraryContext } from '@/components/itinerary-provider';
import { TRIP_DATES } from '@/lib/trip-data';
import { selectTonightsStay, stayName } from '@/lib/tonights-stay';
import { buildMapsPlaceUrl } from '@/lib/maps-link';

const ACTION =
  'chip min-h-tap shrink-0 border-[color:hsl(var(--accent))] px-3 text-[color:hsl(var(--accent))] outline-none transition-colors duration-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Where you sleep on `date` (a trip day), from the itinerary's hotel items. Null renders nothing. */
export default function TonightsStay({ date, className = '' }: { date: string; className?: string }) {
  const { getDayPlan, hydrated } = useItineraryContext();
  const [copied, setCopied] = useState(false);
  if (!hydrated) return null;

  const stay = selectTonightsStay((d) => getDayPlan(d).items, TRIP_DATES, date);
  if (!stay) return null;

  const name = stayName(stay);
  const address = stay.location?.trim() || null;
  const mapsUrl = buildMapsPlaceUrl(name, stay.lat, stay.lng, address ?? undefined);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address ? `${name}, ${address}` : name);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked: the address is already on screen to select by hand
    }
  };

  return (
    <section
      aria-labelledby="tonights-stay-title"
      data-testid="tonights-stay"
      className={`border-y-hair border-border px-gut py-3 ${className}`}
    >
      <p id="tonights-stay-title" className="pr">Tonight&rsquo;s stay</p>
      <p className="mt-1 text-t-body font-semibold leading-snug text-ink-hi">{name}</p>
      {address && <p className="pr pr--lo mt-1">{address}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${ACTION} inline-flex items-center`}
          >
            Open in maps
          </a>
        )}
        <button type="button" onClick={copy} className={ACTION}>
          {copied ? 'Copied' : 'Copy address'}
        </button>
      </div>
      <span className="sr-only" aria-live="polite">{copied ? 'Address copied' : ''}</span>
    </section>
  );
}
