// image-srcset.ts — pure `srcset` string builder for the responsive image
// pipeline. Extracted out of components/optimized-image.tsx so it's unit-testable
// without React/DOM. Takes ascending-or-unordered width variants (as emitted by
// scripts/gen-images.mjs into lib/image-manifest.json) and a `resolve` fn (the
// component passes withBasePath) and produces the `"url 640w, url 1024w,..."`
// syntax the browser uses to pick a source for a given `sizes`.

export interface ImageVariant {
  width: number;
  webp: string;
  avif: string;
}

/**
 * Build a `srcset` value for one format from the manifest's `variants` array.
 * Returns `null` when there are no variants (caller falls back to a single-URL
 * srcSet — today's pre- behavior, still used whenever a caller doesn't pass
 * `sizes`).
 */
export function buildSrcSet(
  variants: ImageVariant[] | undefined,
  format: 'webp' | 'avif',
  resolve: (path: string) => string,
): string | null {
  if (!variants || variants.length === 0) return null;
  return variants
    .slice()
    .sort((a, b) => a.width - b.width)
    .map((v) => `${resolve(v[format])} ${v.width}w`)
    .join(', ');
}
