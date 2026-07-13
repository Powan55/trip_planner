'use client';

// See app/nepal/sections.tsx for why this lives in a client module. The
// planner/budget/backup islands keep their ssr:false +
// sized loading skeletons; they read/write localStorage so have no server render.
import dynamic from 'next/dynamic';
import SectionSkeleton from '@/components/section-skeleton';

export const CalendarPlanner = dynamic(() => import('@/components/calendar-planner'), {
  ssr: false,
  loading: () => <SectionSkeleton height="44rem" count={4} />,
});
export const BudgetPanel = dynamic(() => import('@/components/budget-panel'), {
  ssr: false,
  loading: () => <SectionSkeleton height="28rem" count={2} />,
});
export const BackupRestore = dynamic(() => import('@/components/backup-restore'), {
  ssr: false,
  loading: () => <SectionSkeleton height="14rem" count={1} />,
});
