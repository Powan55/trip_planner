'use client';

// Next 15 forbids calling `dynamic(..., {ssr:false})`
// inside a Server Component module. `app/layout.tsx` is a Server Component (it
// exports `metadata`/`viewport`, which a Client Component cannot), so the
// app-chrome islands are declared here, in a client module, and imported back
// into the layout. Behavior is unchanged: same `dynamic({ssr:false})` island
// pattern, same tree positions in the layout.
import dynamic from 'next/dynamic';

// The Navbar + Footer are app-wide chrome — one persistent instance
// around all routes (client-side route transitions keep layout state).
export const Navbar = dynamic(() => import('@/components/navbar'), { ssr: false });
export const Footer = dynamic(() => import('@/components/footer'), { ssr: false });

// Mobile bottom tab bar + quick-add FAB and the global `quickadd:open` host.
export const BottomTabBar = dynamic(() => import('@/components/bottom-tab-bar'), { ssr: false });
export const QuickAddFab = dynamic(() => import('@/components/quick-add-fab'), { ssr: false });
export const QuickAddHost = dynamic(() => import('@/components/quick-add-host'), { ssr: false });
// The global fast expense-log host — its own `expense:open`
// event + dialog, parallel to QuickAddHost.
export const ExpenseLogHost = dynamic(() => import('@/components/expense-log-host'), { ssr: false });
