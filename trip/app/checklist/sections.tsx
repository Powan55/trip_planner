'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module — see
// app/packing/sections.tsx / app/journal/sections.tsx for the precedent. The docs-checklist island
// is a client-only store (localStorage + gated sync), so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';
import MapIslandBoundary from '@/components/map-island-boundary';

export const DocsChecklist = dynamic(() => import('@/components/docs-checklist'), {
  ssr: false,
  loading: () => <SectionSkeleton height="40rem" count={2} contentClassName="max-w-3xl" />,
});

// #20 — the machine-checked complement to the day-zero list above it. Same island shape: every
// one of its checks reads a browser API (Cache Storage, StorageManager, the device clock), so it
// has no meaningful server render either.
const PreflightChecksIsland = dynamic(() => import('@/components/preflight-checks'), {
  ssr: false,
  loading: () => <SectionSkeleton height="18rem" count={1} contentClassName="max-w-3xl" />,
});

// Not a map island: `lib/preflight.ts` builds its marker at runtime so this chunk stays precached.
// The boundary is still right, on its own terms. Every
// argument in app/map/sections.tsx holds verbatim for any `ssr:false` island: on a cold cache, an
// evicted chunk or a failed precache fetch, React.lazy THROWS at this call site, and unwrapped that
// throw reaches app/error.tsx and replaces the ENTIRE /checklist route — taking the day-zero list
// down with it. Degrading one pane is strictly better, and it is worse than pointless for the pane
// that exists to tell you what is ready to fail on the day it fails.
export function PreflightChecks() {
  return (
    <MapIslandBoundary
      label="The pre-trip readiness checks"
      title="Readiness checks not on this device"
      detail="These checks couldn't load. Reconnect, then try again. The rest of this page works offline."
    >
      <PreflightChecksIsland />
    </MapIslandBoundary>
  );
}
