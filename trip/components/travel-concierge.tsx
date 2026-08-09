'use client';

// — the concierge, in Travel Mode. The component itself is unchanged and un-forked: this is
// the SECOND mount of the exact same `<ConciergeChat />` (its own Sheet trigger, its own
// `useItinerary()` on the shared `itinerary:changed` bus), and only one of the two ever exists at
// a time — `navbar.tsx` (the other mount) returns null under `/travel` (`lib/travel-route.ts`),
// which is the only reason the concierge was missing here at all.
//
// Gating is deliberately identical to the navbar's: `isConciergeAllowedForActiveTrip()` (TD-08 —
// the DEPLOYED Worker's persona is a hardcoded Nepal × Japan one, so a custom trip must not get
// it). moved that rule into `lib/concierge-config.ts` so both mounts read ONE copy of it and
// the owner lifts it in exactly one place after deploying the trip-aware Worker. Everything else —
// `isConciergeConfigured()` (dormant unless `NEXT_PUBLIC_CONCIERGE_URL` is inlined) and the
// active-traveler check — stays INSIDE ConciergeChat, which renders null when they fail, so
// there is exactly one copy of those rules.
//
// Mounted into `/travel`'s reserved `.tm-thumb-zone` band: the
// designed slot for a TM primary action, thumb-reachable at 390×844 and clear of both the agenda
// controls and the day map. The band is `:empty`-collapsed, so in a dormant build (where this
// renders nothing) it stays `display:none` and the layout is byte-identical to pre-.

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { isConciergeAllowedForActiveTrip } from '@/lib/concierge-config';

// Same lazy split as navbar.tsx:23 — the chat + Radix Dialog chunk is not part of the TM bundle.
const ConciergeChat = dynamic(() => import('@/components/concierge-chat'), { ssr: false });

export default function TravelConcierge() {
  // Once-computed, mount-safe: this component is itself an ssr:false island (app/travel/sections.tsx),
  // so reading trip state during render can't produce a hydration mismatch (the navbar pattern).
  const allowed = useMemo(() => isConciergeAllowedForActiveTrip(), []);
  if (!allowed) return null;
  return <ConciergeChat />;
}
