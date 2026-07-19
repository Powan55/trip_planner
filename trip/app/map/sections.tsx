'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. The
// MapLibre GL island, ssr:false, with its sized loading skeleton.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const MapSection = dynamic(() => import('@/components/map-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="60vh" count={2} />,
});
