'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module — see
// app/settings/sections.tsx for the precedent. The trips hub is localStorage-only,
// so it has no meaningful server render; this island keeps its chunk out of every other route's
// First Load JS. Extracted from app/trips/page.tsx so the page can be a Server
// Component that exports per-route metadata.
import dynamic from 'next/dynamic';

export const TripsHub = dynamic(() => import('@/components/trips-hub'), { ssr: false });
