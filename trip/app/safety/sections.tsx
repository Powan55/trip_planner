'use client';

// pattern (Next 15): `ssr:false` dynamic imports are only allowed in a client module —
// see app/plan/sections.tsx / app/journal/sections.tsx for the precedent. Mirrored here per
// the brief even though this content has no localStorage dependency of its own, for
// consistency with the established route-island shape.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const SafetyKit = dynamic(() => import('@/components/travel-safety-kit'), {
  ssr: false,
  loading: () => <SectionSkeleton height="60rem" count={6} />,
});
