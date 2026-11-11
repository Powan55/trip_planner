// Pages a signed-out visitor must be able to read: the sign-in wall steps aside on these.
const LEGAL = ['/privacy', '/terms', '/contact'];

export function isLegalRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return LEGAL.some((p) => pathname === p || pathname === `${p}/`);
}
