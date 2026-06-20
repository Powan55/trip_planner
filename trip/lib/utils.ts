import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
 
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

// GitHub Pages project-page basePath (empty for local dev; CI sets it).
// Wrap EVERY string asset path in withBasePath() — next/image <Image src>,
// plain <img>, CSS bg-images, and metadata (favicon/og-image) alike. With
// `output:'export'` + unoptimized images, next/image does NOT auto-prepend the
// basePath to a string src, so a bare "/images/..." would 404 on the project
// page. withBasePath is a no-op when BASE_PATH is empty, so it never double-prefixes.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || ''

export function withBasePath(path: string): string {
  if (!path) return path
  return `${BASE_PATH}${path.startsWith('/') ? '' : '/'}${path}`
}