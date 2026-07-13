'use client';

// `ssr:false` dynamic imports are only allowed in a client module —
// see app/plan/sections.tsx / app/nepal/sections.tsx for the precedent. The journal browse
// island is localStorage-only, so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const JournalBrowse = dynamic(() => import('@/components/journal-browse'), {
  ssr: false,
  loading: () => <SectionSkeleton height="40rem" count={3} />,
});
