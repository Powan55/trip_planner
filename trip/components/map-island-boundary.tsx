'use client';

// / — contain the ONE deliberately-absent chunk at its call site.
//
// 🔴 WHY THIS FILE EXISTS AT ALL. keeps maplibre's ~1 MB engine OUT
// of the service-worker precache: it is a lot of bytes for a page many people never
// open, and an offline map engine with no cached tiles paints a blank canvas anyway.
// But in the App Router a `dynamic()` whose chunk cannot be fetched makes
// `React.lazy` THROW during render, and the nearest boundary is `app/error.tsx` —
// which replaces the WHOLE ROUTE, hero included. So excluding the chunk without a
// fallback does not remove the map, it removes the route. Measured cold-offline on
// the red run: `/map/` painted "Something went wrong" with
// "Loading chunk … failed", and so did `/plan/`.
//
// 🔴 WHY IT IS A CLASS. This is not a style choice and not a hand-rolled
// alternative to something Next provides — it is the ONLY mechanism available:
// - `next/dynamic` in the App Router has NO `error` option. Verified against the
// installed next@15.5.20: `dist/shared/lib/app-dynamic.js` forwards only
// `loader`/`loading`/`ssr`/`modules` to `dist/shared/lib/lazy-dynamic/loadable.js`,
// which renders `loading` solely as the Suspense FALLBACK with `error: null`
// hardcoded. An `error:` key passed to `dynamic()` is silently ignored. (The
// react-loadable path that DID surface `error` to `loading` is the PAGES-router
// `dist/shared/lib/dynamic.js`, which this app never touches.)
// - React has no function-component error boundary; `getDerivedStateFromError`
// requires a class. `react-error-boundary` is not a dependency and one small
// class does not justify adding one.
//
// WHICH CALL SITES NEED IT is DERIVED, never hand-kept: `scripts/gen-sw.mjs` prints
// the maplibre-reduced call sites at build time under
// `gen-sw: maplibre withheld from N call site(s)`. Wrap exactly those. Add a
// new map island next month and the build names it for you.

import { Component, type ReactNode } from 'react';

/**
 * Digests Next uses for CONTROL FLOW rather than for real failures. These must be
 * re-thrown, never swallowed — the same thing Next's own `ErrorBoundaryHandler`
 * does with `isNextRouterError`.
 *
 * `BAILOUT_TO_CLIENT_SIDE_RENDERING` is the load-bearing one and it is not
 * theoretical: `ssr:false` islands render `<BailoutToCSR>`, which THROWS on every
 * server render (`dist/shared/lib/lazy-dynamic/dynamic-bailout-to-csr.js`:
 * `if (typeof window === 'undefined') throw new BailoutToCSRError(reason)`). This
 * app is `output: 'export'`, so that fires during prerender for EVERY wrapped island
 * on EVERY build. A boundary that caught it would bake this fallback pane into the
 * static HTML and break the ssr:false contract outright.
 *
 * The digest strings are matched literally rather than importing
 * `next/dist/shared/lib/lazy-dynamic/bailout-to-csr` — that is a private deep path,
 * whereas the digest value is part of the client/server wire format.
 */
const CONTROL_FLOW_DIGESTS = new Set([
  'BAILOUT_TO_CLIENT_SIDE_RENDERING',
  'NEXT_REDIRECT',
  'NEXT_NOT_FOUND',
]);

type Props = {
  children: ReactNode;
  /** What could not load, in plain words — e.g. "The interactive map". */
  label?: string;
};

type State = { failed: boolean };

export default class MapIslandBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(error: unknown): State {
    const digest = (error as { digest?: unknown } | null | undefined)?.digest;
    if (typeof digest === 'string' && CONTROL_FLOW_DIGESTS.has(digest)) {
      throw error; // control flow, not a failure — let it reach its real handler
    }
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    const label = this.props.label ?? 'The interactive map';
    return (
      // Real, named copy — NOT a spinner: a spinner here would promise something
      // that is never going to arrive. `role="note"` puts it in the a11y tree as a
      // static aside without the live-region announcement `status`/`alert` would
      // force. No motion, so it is reduced-motion-safe by construction (same
      // reasoning as app/error.tsx).
      <div
        data-testid="map-island-unavailable"
        role="note"
        className="glass-card mx-auto w-full max-w-md rounded-2xl p-6 text-center"
      >
        <p className="mb-2 font-display text-base font-semibold text-white">
          Map unavailable offline
        </p>
        <p className="text-sm text-white/70">
          {label} needs its map engine, which isn&apos;t stored on this device — it is
          large, and it would show a blank canvas without cached tiles anyway.
          Reconnect to load it. Everything else on this page works offline, and your
          saved places and itinerary are safe on this device.
        </p>
      </div>
    );
  }
}
