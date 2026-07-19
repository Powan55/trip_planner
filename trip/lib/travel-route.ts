// the single source of truth for "is this pathname under Travel Mode".
//
// Travel Mode is a chrome-free route `/travel`. Chrome suppression is a
// pathname conditional in each of the six chrome-islands client components (NOT a
// layout.tsx restructure) — they all import THIS helper so the match rule can never drift
// between them.
//
// `usePathname()` excludes basePath and, under trailingSlash:true, resolves to
// `/travel/` for the exported route — but a client-side push can transiently read `/travel`
// without the slash, so we accept both. The `/travel/` boundary check means a hypothetical
// sibling like `/travelogue` never matches.
export function isTravelRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === '/travel' || pathname.startsWith('/travel/');
}
