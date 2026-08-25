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
    // Three modules ASSERT in their own comments that this suite runs under
    // `TZ=America/New_York` — `core/dates/trip-dates.ts`, `lib/__tests__/core-clock.test.ts` and
    // `lib/__tests__/burn-rate-core.test.ts` — and until now nothing set it. Tests inherited the
    // machine's zone, so the DST sweep in `countdown-sum-back.test.ts` found two transitions on a
    // US-East dev box and ZERO on the UTC CI runner, where it silently became a no-op. Every DST
    // guarantee in the countdown was unproven by CI.
    //
    // `env` is the right seam on the DEFAULT `forks` pool, which this repo uses (no `pool` is set
    // anywhere): the variable lands before the first `Date` construction, so no `cross-env` and no
    // npm-script change. It is NOT general -- under `pool: 'threads'`/`'vmThreads'` the variable is
    // set but the isolate stays on the host zone, silently reopening this. If a pool is ever set,
    // move the pin to a `process.env.TZ = ...` assignment at this file's module scope.
    env: { TZ: 'America/New_York' },
    // S350: components/__tests__ joins lib/__tests__ as a second, JSX-bearing test root (the
    // concierge renderer test uses real .tsx JSX rather than lib/__tests__'s createElement-only
    // convention) — everything else about the run (jsdom, the @ alias, oxc's automatic JSX
    // runtime) is unchanged.
    //
    // Issue #32, widened again by #264: every source root, any depth, BOTH extensions,
    // though today all 203 files sit on the diagonal (198 .test.ts in lib/__tests__, 5
    // .test.tsx in components/__tests__). Each narrower glob pinned the suite to one axis,
    // so the first `lib/__tests__/*.test.tsx`, then the first `core/**/__tests__/*.test.ts`
    // or a test beside the module it covers, would have been collected by nothing and never
    // run — passing CI by being absent, the failure mode a test suite can least afford.
    // Widening costs nothing: the extra matrix is empty today. Roots are enumerated rather
    // than globbed from `.` so `e2e/` stays Playwright's alone — its specs would otherwise
    // match on the `*.test.ts` half.
    include: ['{app,components,core,hooks,lib}/**/*.test.{ts,tsx}'],
    // Issue #294: default 5000ms + unconstrained fork count starve each other under full
    // parallel load (CPU contention across ~200 files), timing out otherwise-passing tests
    // (concierge-ops.integration, release-gate, visit-autocount, remote-auth, visited-footprint
    // among them) that are clean in isolation. Stays on the default `forks` pool — per-file
    // isolation there is unaffected by worker count, so this only caps how much CPU contends
    // at once, it doesn't touch test correctness.
    testTimeout: 20000,
    maxWorkers: '50%',
  },
});
