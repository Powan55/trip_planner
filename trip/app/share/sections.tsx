'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module —
// see app/packing/sections.tsx / app/journal/sections.tsx for the precedent. The share inbox
// island is both the OS-share-target RECEIVER (reads `window.location.search`) and a
// localStorage-only triage list, so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const ShareInbox = dynamic(() => import('@/components/share-inbox'), {
  ssr: false,
  loading: () => <SectionSkeleton height="30rem" count={2} />,
});
