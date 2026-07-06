import { Home, Calendar, Mountain, Compass, Map, type LucideIcon } from 'lucide-react';

/**
 * Single source of truth for the five route-driven primary-nav items, shared by the
 * desktop `navbar.tsx` and the mobile `bottom-tab-bar.tsx` (the two
 * components previously each carried a byte-identical local copy of this array + the
 * route-match helpers below).
 *
 * The nav is ROUTE-driven — five pages, trailing-slash canonical hrefs
 * (`trailingSlash:true`). next/link handles basePath; active state comes from
 * usePathname() (which EXCLUDES basePath), so the whole nav is basePath-agnostic.
 */
export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export const NAV_ITEMS: NavItem[] = [
  { label: 'Home', href: '/', icon: Home },
  { label: 'Plan', href: '/plan/', icon: Calendar },
  { label: 'Nepal', href: '/nepal/', icon: Mountain },
  { label: 'Japan', href: '/japan/', icon: Compass },
  { label: 'Map', href: '/map/', icon: Map },
];

// Trailing-slash-agnostic pathname compare ('' and '/' both mean Home).
function normalizePath(p: string | null): string {
  const stripped = (p ?? '/').replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped;
}

// Active when the pathname IS the route or sits below it (`/nepal/*`).
// Home is exact-match only, otherwise it would claim every route.
export function isRouteActive(pathname: string | null, href: string): boolean {
  const current = normalizePath(pathname);
  const target = normalizePath(href);
  if (target === '/') return current === '/';
  return current === target || current.startsWith(`${target}/`);
}
