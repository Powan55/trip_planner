'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module — see
// app/packing/sections.tsx / app/journal/sections.tsx for the precedent. The docs-checklist island
// is a client-only store (localStorage + gated sync), so it has no meaningful server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const DocsChecklist = dynamic(() => import('@/components/docs-checklist'), {
  ssr: false,
  loading: () => <SectionSkeleton height="40rem" count={2} />,
});
