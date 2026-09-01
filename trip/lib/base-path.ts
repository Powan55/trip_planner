// GitHub Pages project-page basePath (empty for local dev; CI sets it).
// NOTE: wrap EVERY string asset path in
// withBasePath() — next/image <Image src>, plain <img>, CSS bg-images, and
// metadata (favicon/og-image) alike. Under `output:'export'` + unoptimized
// images, next/image does NOT auto-prepend basePath to a string src (the
// optimizer URL is disabled), so a bare "/images/..." 404s on the project page.
// withBasePath is a no-op when BASE_PATH is empty, so it never double-prefixes.
//
// Its own module rather than a member of lib/utils, so a caller that must not pull
// clsx/tailwind-merge into its First Load can reach it without inlining a copy.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''

export function withBasePath(path: string): string {
  if (!path) return path
  return `${BASE_PATH}${path.startsWith('/') ? '' : '/'}${path}`
}
