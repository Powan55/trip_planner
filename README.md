# Nepal × Japan Trip Planner

A trip-planning dashboard for an upcoming Nepal and Japan journey (Kathmandu, then across Japan,
Dec 2026 → Jan 2027). It pulls the whole trip into one place: a live countdown, a day-by-day
itinerary planner that saves to your browser, destination and food guides for both countries, a
photography guide, and an interactive map.

**Live demo:** https://powan55.github.io/trip_planner/

## Features

- **Countdown dashboard** – live months/weeks/days/hours/minutes/seconds to departure, plus trip
  stats (total days, countries, cities, planned vs. unplanned days).
- **Itinerary planner** – add, edit, and delete plans on any date. Everything persists in
  `localStorage`, so your itinerary survives a reload with no account or backend.
- **Trip timeline** – the Nepal → Japan flow at a glance, with date selection.
- **Destination guides** – attractions, neighborhoods, and food for Kathmandu and across Japan,
  filterable by category.
- **Photography guide** – locations, subjects, and practical shooting tips for each stop.
- **Interactive map** – category-filterable markers for points of interest.
- **Dark / light mode**, responsive layout down to mobile, and reduced-motion support.

## Tech stack

- [Next.js 14](https://nextjs.org/) (App Router, static export)
- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) with [shadcn/ui](https://ui.shadcn.com/) (Radix UI)
- [Framer Motion](https://www.framer.com/motion/) for animation
- [date-fns](https://date-fns.org/) for date math

## Getting started

```bash
cd trip
npm install --legacy-peer-deps
npm run dev
```

Then open http://localhost:3000.

> The `--legacy-peer-deps` flag avoids an ESLint peer-dependency conflict during install.

## Build

```bash
npm run build
```

The app is configured for static export (`output: 'export'`), so this produces a fully static
site in `trip/out/` that can be served from any static host.

## Deployment

Deployment is automated with GitHub Actions (`.github/workflows/deploy.yml`). On every push to
`main` it builds the static export and publishes it to GitHub Pages. The base path and site URL
are derived from the repository name at build time, so no configuration is hard-coded.

To deploy your own copy, push to `main` and set **Settings → Pages → Source** to **GitHub Actions**.

## Notes

The trip dates are configured in one place (`trip/lib/trip-data.ts`); change `TRIP_START` /
`TRIP_END` there to retarget the countdown. The map is a styled mock by default and can be wired
to a real tile provider later.
