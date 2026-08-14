import { defineConfig } from 'vitest/config';
import path from 'path';

// Standalone Vitest config (S77) — deliberately NOT sharing next.config.js /
// tsconfig's Next-specific plugin pipeline. It only needs to:
//   1. Run pure TS modules under a DOM-capable environment (jsdom) so the
//      storage tests can use `localStorage`.
//   2. Replicate the `@/*` -> project-root path alias from tsconfig.json so
//      transitive imports (e.g. itinerary-remote.ts -> '@/hooks/use-itinerary')
//      resolve exactly as they do for the Next build.
//
// S161: `lib/__tests__/story-photos.test.ts` imports a real `.tsx` component
// (`components/trip-story-recap.tsx`) for the first time. This Vite (8.x) is the
// oxc/rolldown-backed build ("Both esbuild and oxc options were set. oxc options
// will be used" — oxc's own JsxOptions default IS `runtime: 'automatic'`, but
// Vite infers `jsx: 'preserve'` from tsconfig.json's `jsx: "preserve"` (Next's
// setting) and passes that through, leaving `.tsx` JSX untransformed for import
// analysis). Overriding `oxc.jsx.runtime` directly here fixes it with no new dep
// and nothing added to the TS project graph (unlike `@vitejs/plugin-react`, whose
// `.d.ts` uses a `export { X as "module.exports" }` form this project's
// TypeScript 5.2.2 can't parse — that path broke `tsc --noEmit`/`next build`'s
// type-check the moment the package was even imported).
export default defineConfig({
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    // S350: components/__tests__ joins lib/__tests__ as a second, JSX-bearing test root (the
    // concierge renderer test uses real .tsx JSX rather than lib/__tests__'s createElement-only
    // convention) — everything else about the run (jsdom, the @ alias, oxc's automatic JSX
    // runtime) is unchanged.
    //
    // Issue #32: BOTH extensions in BOTH roots, deliberately, though today every file happens
    // to sit on the diagonal (156 .test.ts in lib, 2 .test.tsx in components). The old pair of
    // globs pinned each root to one extension, so the first `lib/__tests__/*.test.tsx` or
    // `components/__tests__/*.test.ts` anyone added would have been collected by nothing and
    // simply never run — passing CI by being absent, which is the failure mode a test suite
    // can least afford. Widening costs nothing: the extra half of the matrix is empty today.
    include: ['{lib,components}/__tests__/**/*.test.{ts,tsx}'],
  },
});
