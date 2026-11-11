'use client';

import type { ReactNode } from 'react';
import { useActiveTraveler } from '@/hooks/use-active-traveler';

/** Trip chrome (navbar, tab bar, quick-add) stays out of the DOM until someone is signed in. */
export default function TravelerOnly({ children }: { children: ReactNode }) {
  const { traveler } = useActiveTraveler();
  return traveler ? <>{children}</> : null;
}
