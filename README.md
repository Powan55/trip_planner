# Nepal × Japan Trip Planner

A trip-planning app for an upcoming Nepal and Japan journey (Kathmandu, then across Japan,
Dec 2026 → Jan 2027). It pulls the whole trip into one place: a live countdown, a day-by-day
itinerary planner that saves to your browser, destination / food / photography / nightlife
guides for both countries, and a real interactive map — packaged as an installable,
offline-capable PWA.

**Live demo:** https://powan55.github.io/trip_planner/

## Features

- **Five pages** – Home, Plan, Nepal, Japan, and Map, with a persistent top navbar, a
  thumb-reach bottom tab bar on phones, and a ⌘K / Ctrl+K command palette that jumps to any
  section from anywhere.
- **Countdown dashboard** – live months/weeks/days/hours/minutes/seconds to departure plus
  trip stats (total days, countries, cities, planned vs. unplanned days). Once the trip is
  underway it switches to a day-by-day travel mode.
- **Itinerary planner** – add, edit, and delete plans on any of the 32 days. Everything
  persists in `localStorage`, so your itinerary survives a reload with no account or backend.
  On mobile, a floating quick-add button opens the add dialog preset to the day you're
  looking at. Optional cross-friend sync (Firebase) can be switched on via env config; with
  no config the app stays fully local.
- **Destination guides** – attractions, neighborhoods, and food for Kathmandu and across
  Japan, with search, category/city filters, and tap-to-open detail sheets.
- **Photography & nightlife guides** – locations, subjects, and practical tips for each
  stop, filterable per country.
- **Interactive map** – a real MapLibre GL map on free CARTO dark tiles (no API key),
  with category-filterable markers, rich popups, an itinerary overlay, and fullscreen mode.
- **Installable PWA** – web app manifest + a hand-rolled service worker precache the app
  shell, so the app installs to a home screen and keeps working offline; updates surface as
  a "New version available" toast (never a silent refresh).
- **Design** – dark, glassy, gold/himalaya/sakura-accented theme; responsive down to small
  phones; `prefers-reduced-motion` respected throughout.

## Tech stack

- [Next.js 14](https://nextjs.org/) (App Router, static export)
- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) with [shadcn/ui](https://ui.shadcn.com/) (Radix UI)
- [Framer Motion](https://www.framer.com/motion/) for animation
- [MapLibre GL](https://maplibre.org/) for the map (CARTO raster basemap)
- [date-fns](https://date-fns.org/) for date math
- Optional [Firebase](https://firebase.google.com/) (Firestore + anonymous auth) for the
  cross-friend itinerary sync — entirely inert unless configured

## Getting started

```bash
cd trip
npm install --legacy-peer-deps
npm run dev
```

Then open http://localhost:3000.

> The `--legacy-peer-deps` flag avoids an ESLint peer-dependency conflict during install.
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

Deployment is automated with GitHub Actions (`.github/workflows/deploy.yml`). On every push to
`main` it builds the static export and publishes it to GitHub Pages. The base path and site URL
are derived from the repository name at build time, so no configuration is hard-coded.

To deploy your own copy, push to `main` and set **Settings → Pages → Source** to **GitHub Actions**.

## Firestore rules

`firestore.rules` at the repo root is the source of truth for the database's access rules.
Before any change to it ships, validate it against the real rules engine with the local
emulator (needs Java and the `firebase` CLI; run from the repo root):

```bash
firebase emulators:exec --only firestore,auth --project demo-rules "node scripts/rules-check.mjs"
```

Exit code 0 means every phase passed (the two negative-control phases are *supposed* to show
failures in their own output — the script accounts for that). The harness resolves the
`firebase` SDK out of `trip/node_modules`, so `npm ci --legacy-peer-deps` inside `trip/`
must have run first. It is deliberately not part of CI or the app's test suite: it needs a
running emulator.

The **auth** emulator is required as well as firestore, because the rules now have an
authentication floor: the harness signs in three anonymous users (owner, member, stranger)
and keeps a fourth client signed out, so that both the membership rules and the floor itself
are exercised rather than assumed. Running with `--only firestore` fails in phase 0.

Publishing the rules is a **manual owner action** — no workflow deploys them:

```bash
firebase deploy --only firestore:rules
```

After any rules deploy, re-verify live that trip enumeration is still denied (a plain
`getDocs(collection('trips'))` must fail with permission-denied).

## Notes

The trip dates are configured in one place (`trip/lib/trip-data.ts`); change `TRIP_START` /
`TRIP_END` there to retarget the countdown. The map needs no key — the CARTO basemap is free
with attribution. To enable the optional cross-friend sync, copy `trip/.env.local.example` to
`trip/.env.local` and fill in a Firebase web config; without it the app is local-only.
