'use client';

// The concierge, in Travel Mode. Un-forked: this is the SECOND mount of the exact same
// `<ConciergeChat />`, and only one of the two ever exists at a time — `navbar.tsx` (the other
// mount) returns null under `/travel` (`lib/travel-route.ts`). All of the panel's own styling,
// state grammar and gating live in that one component; this file decides whether it mounts, and
// which edge it opens from.
//
// Gating is deliberately identical to the navbar's: `isConciergeAllowedForActiveTrip()`, because
// the deployed Worker is hardcoded to the Nepal × Japan trip and a custom trip must not get it.
// The rule lives in `lib/concierge-config.ts` so both mounts read ONE copy of it.
// `isConciergeConfigured()` and the active-traveler check stay INSIDE ConciergeChat, which renders
// null when they fail.
//
// Mounted into `/travel`'s reserved `.tm-thumb-zone` band — thumb-reachable at 390×844 and clear
// of both the agenda controls and the day map. The band is `:empty`-collapsed, so in a dormant
// build (where this renders nothing) it stays `display:none` and the layout is unchanged.

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
  // The ONE thing this mount styles differently: the panel rises out of the thumb zone that
  // opened it instead of sliding in from a screen edge. Navbar's mount keeps `right`.
  return <ConciergeChat side="bottom" />;
}
