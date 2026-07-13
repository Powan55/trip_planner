'use client';

// `ssr:false` dynamic imports are only allowed in a client module —
// see app/journal/sections.tsx / app/safety/sections.tsx for the precedent. The settings panel
// is localStorage-only, so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const Settings = dynamic(() => import('@/components/settings-panel'), {
  ssr: false,
  loading: () => <SectionSkeleton height="40rem" count={3} />,
});
