'use client';

// (Next 15 migration): see app/nepal/sections.tsx — same reason. The
// flights/hotels island, ssr:false, with its sized loading skeleton.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const FlightsSection = dynamic(() => import('@/components/flights-section'), {
  ssr: false,
  loading: () => <SectionSkeleton height="clamp(30rem, 80vh, 46rem)" />,
});
