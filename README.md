# Nepal × Japan Trip Planner

A trip-planning app for an upcoming Nepal and Japan journey (Kathmandu, then across Japan,
Dec 2026 → Jan 2027) — and for any other trip you add beside it. It pulls the whole trip into
one place: a live countdown, a day-by-day itinerary planner, destination / food / photography /
nightlife guides for both countries, a journal, an expense log, and a real interactive map —
packaged as an installable, offline-capable PWA. Plans are kept on the device and sync across
devices when the build is wired to Firebase.

**Live demo:** https://powan55.github.io/trip_planner/

## Features

- **One app, many surfaces** – Today, Plan, Map and Guides sit in the top navbar and in the
  thumb-reach bottom tab bar on phones; Flights, Journal, Safety, Recap, Packing, Documents,
  Shared Links, Trips and Settings live one tap deeper behind **More**. A ⌘K / Ctrl+K command
  palette jumps straight to most of those routes, and to individual sections within them, from
  anywhere.
- **Countdown dashboard** – live months/weeks/days/hours/minutes/seconds to departure plus
  trip stats (total days, countries, cities, planned vs. unplanned days). Once the trip is
  underway it switches to a day-by-day travel mode.
- **Itinerary planner** – add, edit, and delete plans on any of the 32 days. Plans are saved on
  the device (`localStorage`) and, when the build carries a Firebase web config, mirrored to
  Firestore under the trip's id, so every device signed in to that trip sees the same plan;
  with no config the app stays local-only. On mobile, a floating quick-add button opens the add
  dialog preset to the day you're looking at.
- **Destination guides** – attractions, neighborhoods, and food for Kathmandu and across
  Japan, with search, category/city filters, and tap-to-open detail sheets.
- **Photography & nightlife guides** – locations, subjects, and practical tips for each
  stop, filterable per country.
- **AI concierge** – an optional chat that answers questions about the active trip and can
  propose plan changes; nothing it proposes is applied without an explicit confirm. It is
  served by a small Cloudflare Worker whose source lives outside this repo, and it renders
  nothing unless the build sets `NEXT_PUBLIC_CONCIERGE_URL`.
- **Journal, budget, packing and documents** – day-by-day journal entries, an expense log with
  a settle-up summary, a packing checklist, a travel-document checklist, and a shared-links
  inbox. Photos attached to a journal day or an expense are held in IndexedDB.
- **More than one trip** – the Nepal × Japan pack ships with the app; you can also create your
  own trip from dates and destinations, or add someone else's with their Trip Token, and switch
  between them from **Trips**.
- **Interactive map** – a real MapLibre GL map on free CARTO dark tiles (no API key),
  with category-filterable markers, rich popups, an itinerary overlay, and fullscreen mode.
- **Installable PWA** – web app manifest + a hand-rolled service worker precache the app
  shell, so the app installs to a home screen and keeps working offline; updates surface as
  a "New version available" toast (never a silent refresh).
- **Design** – dark, glassy, gold/himalaya/sakura-accented theme; responsive down to small
  phones; `prefers-reduced-motion` respected throughout.

## Tech stack

- [Next.js 15](https://nextjs.org/) (App Router, static export)
- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) with [shadcn/ui](https://ui.shadcn.com/) (Radix UI)
- [Framer Motion](https://www.framer.com/motion/) for animation
- [MapLibre GL](https://maplibre.org/) for the map (CARTO raster basemap)
- [date-fns](https://date-fns.org/) for date math
- Optional [Firebase](https://firebase.google.com/) (Firestore only — Firebase Auth is not
  used; the trip id is the capability) for cross-device sync — entirely inert unless configured

## Getting started

```bash
cd trip
npm install --legacy-peer-deps
npm run dev
```

Then open http://localhost:3000.

> The `--legacy-peer-deps` flag is required, not optional: `cmdk`, `next-themes` and `sonner`
> still pin React 18 peers against this app's React 19.
> The service worker only registers in production builds, so offline support is not active
> under `next dev`.

## Build

```bash
npm run build
```

This runs the static export (`output: 'export'`) and then generates the PWA pieces
(`manifest.webmanifest` and `sw.js`) into `trip/out/`, which can be served from any static
host.

## Deployment

Deployment is automated with GitHub Actions (`.github/workflows/deploy.yml`). On a push to
`main` it builds the static export and publishes it to GitHub Pages. The base path and site URL
are derived from the repository name at build time, so no configuration is hard-coded. Two
gates run first: a repository-hygiene check, and a `version-gate` that fails the run when a tag
`v<version>` for the current `trip/package.json` version already exists — so a push to `main`
without a version bump does not publish. The workflow pushes that tag itself once the deploy
succeeds.

To deploy your own copy, push to `main` and set **Settings → Pages → Source** to **GitHub Actions**.

## Notes

The trip dates live in the trip pack (`trip/core/trips/packs/nepal-japan-2026.ts`); change its
`start` / `end` — and its legs — to retarget the countdown. `TRIP_START` / `TRIP_END` in
`trip/lib/trip-data.ts` are re-exports of values derived from that pack, not editable constants.
The map needs no key — the CARTO basemap is free with attribution. To enable cross-device sync,
copy `trip/.env.local.example` to `trip/.env.local` and fill in a Firebase web config; without
it the app is local-only.
