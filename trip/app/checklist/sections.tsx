'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module — see
// app/packing/sections.tsx / app/journal/sections.tsx for the precedent. The docs-checklist island
// is a client-only store (localStorage + gated sync), so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';
import MapIslandBoundary from '@/components/map-island-boundary';

export const DocsChecklist = dynamic(() => import('@/components/docs-checklist'), {
  ssr: false,
  loading: () => <SectionSkeleton height="40rem" count={2} />,
});

// #20 — the machine-checked complement to the day-zero list above it. Same island shape: every
// one of its checks reads a browser API (Cache Storage, StorageManager, the device clock), so it
// has no meaningful server render either.
const PreflightChecksIsland = dynamic(() => import('@/components/preflight-checks'), {
  ssr: false,
  loading: () => <SectionSkeleton height="18rem" count={1} />,
});

// This is NOT a map island, and the boundary is still right. `gen-sw.mjs` identifies maplibre by
// CONTENT — a built `.js` chunk containing the string `maplibregl` — because content-hashed chunk
// filenames give it no other handle (D-286). `lib/preflight.ts` holds that identical string as the
// marker it SEARCHES the cache for, under a comment saying the two must move together, so its
// chunk contains the marker without containing the engine. The probe cannot tell "carries maplibre"
// from "looks for maplibre", and this call site is the collision. It also explains the delta in
// gen-sw's `maplibre PRECACHED — N chunk(s)` line: this chunk is one of them, and it is kilobytes.
//
// Wrapping is the right answer anyway, on the boundary's own terms and not as appeasement. Every
// argument in app/map/sections.tsx holds verbatim for any `ssr:false` island: on a cold cache, an
// evicted chunk or a failed precache fetch, React.lazy THROWS at this call site, and unwrapped that
// throw reaches app/error.tsx and replaces the ENTIRE /checklist route — taking the day-zero list
// down with it. Degrading one pane is strictly better, and it is worse than pointless for the pane
// that exists to tell you what is ready to fail on the day it fails.
export function PreflightChecks() {
  return (
    <MapIslandBoundary label="The pre-trip readiness checks">
      <PreflightChecksIsland />
    </MapIslandBoundary>
  );
}
