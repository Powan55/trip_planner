# v5 Phase-5 Feasibility Spike — Self-hosted offline PMTiles vector maps

**Slice:** S209 · **Date:** 2026-07-17 · **Milestone:** M19 (v5) Phase 5 candidate pool (stretch, gates S210)
**Status:** research/decision deliverable, no application code. It renders a go/no-go on S210 (offline PMTiles maps) and, if no-go, the reasoning to formally drop it from the candidate pool.

This spike answers one question before any offline-map code is written:

> Can a self-hosted `.pmtiles` vector basemap covering this trip's geography (Kathmandu Valley + Pokhara, and the Tokyo–Kyoto–Osaka corridor) fit inside the GitHub Pages 100 MB per-file hard cap at a zoom range useful for the map, and is it worth it versus the existing free online basemap?

Scope: sizing and feasibility only. No S210 build, no edits to any live map code (`components/trip-map.tsx`, `components/map-section.tsx`, `lib/maps-link.ts`, `lib/map-style.ts` were read-only inputs). Any extraction tool has to be free / open-source, no signup, no billing, per our free-tools-only rule.

---

## 0. Honest limitation up front (evidence integrity)

We could not run a live extract in this environment. Every outbound HTTPS request from the sandbox returns curl `http_code=000` (tested `example.com`, `api.github.com`, `raw.githubusercontent.com`, `build.protomaps.com`, with and without the sandbox override), and no `pmtiles`/`tippecanoe` binary is installed. Go 1.x *is* on PATH, but with no network we can neither `go install` the CLI nor range-read the remote planet. So the size figures below are transparent, reproducible tile-count arithmetic: Web-Mercator tile math plus a bracketed average tile size. They are not a measured extract, and no command output has been fabricated. Section 5 gives the exact commands for a network-enabled runner to produce the live measured number and confirm or override this verdict.

The verdict does not hinge on the exact byte count. It holds across the entire plausible range of the average-tile-size bracket (see section 3).

---

## 1. Tooling path (real, free, no signup)

Two free, open-source paths produce a bbox-clipped `.pmtiles` from the **Protomaps daily planet basemap** build. Both are keyless and card-free.

| Path | How | Free? |
|---|---|---|
| **`pmtiles extract` CLI** (`go-pmtiles`, github.com/protomaps/go-pmtiles) | `pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles out.pmtiles --bbox=W,S,E,N --maxzoom=Z` range-reads only the needed portion of the remote planet file over HTTP; no full-planet download. | Yes. OSS binary; the planet build is publicly hosted, no key. |
| **Protomaps "Download a small map"** (app.protomaps.com/downloads/small_map, no-CLI) | Draw a bbox in the browser, pick a maxzoom, download the `.pmtiles`. Warns on large areas. | Yes, no account. |

Both consume the **Protomaps Basemap** (OpenStreetMap-derived, ODbL). Attribution is required (OSM + Protomaps), the same posture as the current CARTO raster attribution already wired in `lib/map-style.ts`.

**Self-build alternative (heavier):** `tippecanoe` an OSM `.osm.pbf` extract (Geofabrik/BBBike) into a `.pmtiles`. More control over layers and zoom, but a real ETL pipeline to own, and out of scope for a "polished mock" map.

---

## 2. Region footprints

Trip-planning zoom is city/region level, not full basemap detail. Two extract regions (a combined single file, or split per country):

| Region | bbox (W, S, E, N) | Approx extent | Density |
|---|---|---|---|
| **Nepal legs**: Kathmandu Valley + Pokhara + corridor | `83.8, 27.5, 85.7, 28.35` | ~185 × 95 km | Low–moderate (one dense valley, one town, rural hills) |
| **Japan legs**: Tokyo/Kyoto/Osaka + Tokaido corridor | `135.3, 34.5, 140.0, 35.9` | ~430 × 155 km | Highest on earth (continuous dense-urban Tokaido megalopolis) |

The Japan corridor is the sizing driver. It is both larger and the densest mapped region on the planet.

---

## 3. Sizing — reproducible tile math

**Method (reproducible):** tiles-per-zoom for a bbox = `x_count × y_count`, where
`x(lon,z) = (lon+180)/360 · 2^z` and `y(lat,z) = (1 − ln(tan(lat)+sec(lat))/π)/2 · 2^z`.
Cumulative `z0..zMax ≈ (top-zoom count) × 4/3`. Sizes = tile count × an **average compressed tile size**. For the Protomaps *basemap* profile the average is top-zoom-weighted and dense-urban-heavy, so we bracket it at **8 KB (rural-lean) / 20 KB (mixed) / 40 KB (dense-urban-heavy)**. The qualitative conclusion is invariant across the whole bracket.

**Tile counts (computed):**

| Region | z0–12 (district overview) | z0–14 (street) | z0–15 (full basemap detail) |
|---|---|---|---|
| Nepal | ~370 | ~5,900 | ~23,500 |
| Japan (Tokaido) | ~1,440 | ~23,000 | ~92,000 |

**Size brackets (tiles × 8/20/40 KB):**

| Region · zoom | 8 KB | 20 KB | 40 KB | vs 100 MB/file cap |
|---|---|---|---|---|
| Nepal z0–12 | 3 MB | 7 MB | 15 MB | **fits, huge margin** |
| Japan z0–12 | 11 MB | 29 MB | 58 MB | **fits** (even worst-case) |
| Combined z0–12 | 14 MB | 36 MB | 73 MB | **fits** (single file) |
| Japan z0–13 | 46 MB | 115 MB | 230 MB | **straddles the cap** |
| Japan z0–14 | 184 MB | 460 MB | 922 MB | **over** (street zoom) |
| Japan z0–15 | 737 MB | 1.8 GB | 3.7 GB | **far over** |

**The finding:** an offline basemap fits under 100 MB only at an overview zoom (z ≤ 12), i.e. district/region level with no street detail. The street-level zoom (z14–15) that would make offline maps actually useful blows past the GitHub Pages 100 MB per-file hard cap for the Japan corridor, in the mixed case by a wide margin. z13 is already marginal for Japan.

**GitHub Pages / git constraints (real, sourced from GitHub docs):**
- git rejects any file > 100 MB on push, so a single street-zoom Japan `.pmtiles` literally cannot be committed.
- GitHub *warns* on files > 50 MB.
- Published Pages site: 1 GB soft size limit, 100 GB/month soft bandwidth. A 50–100 MB tile file served to every visitor eats both.
- Repo history cost: `.git` is **84 MB today** (measured: `du -sh .git`). A committed 50–100 MB binary roughly doubles every clone permanently, and each re-extraction adds another copy to history unless force-purged. Git LFS or a build-time fetch avoids this but adds its own moving parts.

---

## 4. MapLibre 5.24 + PMTiles compatibility: OK (not the blocker)

`package.json` pins **`maplibre-gl@5.24.0`**. PMTiles integrates via the `pmtiles` npm package's protocol handler:

```js
import { Protocol } from 'pmtiles';
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);
// style source: { type: 'vector', url: 'pmtiles:///maps/trip.pmtiles' }
```

- maplibre-gl v5's `addProtocol` uses the promise-based handler API. That requires `pmtiles` npm v4.x (v4 aligns `protocol.tile` to the promise signature; the old v2 callback form is incompatible with maplibre v4+). Compatibility is fine as long as the right major is pinned, which is worth flagging for S210.
- This would be a new runtime dependency (`pmtiles` is a few tens of KB gzip client-side), against v5's otherwise zero-new-dependency posture. Vector rendering also needs a real vector `style` (layers, glyphs, sprite), and the current map is a **raster** style (`lib/map-style.ts`, CARTO dark raster). So S210 would also have to author and ship a full vector style plus glyph/sprite assets. Swapping a URL would not cover it.

**Conclusion for this axis:** technically viable. The protocol path works with the pinned MapLibre. The blocker is size and cost, not compatibility.

---

## 5. Live-confirm commands (for a network-enabled runner)

To replace the computed bracket with a measured number (≈2 min, free, no signup):

```sh
go install github.com/protomaps/go-pmtiles/pmtiles@latest   # Go is on PATH
PLANET=https://build.protomaps.com/$(date +%Y%m%d).pmtiles  # or any recent daily build

# Overview zoom (expected to FIT):
pmtiles extract "$PLANET" nepal-z12.pmtiles --bbox=83.8,27.5,85.7,28.35 --maxzoom=12
pmtiles extract "$PLANET" japan-z12.pmtiles --bbox=135.3,34.5,140.0,35.9 --maxzoom=12

# Street zoom (expected to bust the 100MB cap for Japan):
pmtiles extract "$PLANET" japan-z14.pmtiles --bbox=135.3,34.5,140.0,35.9 --maxzoom=14

ls -lh *.pmtiles   # measured sizes
```

If the measured Japan-z12 file is comfortably < 100 MB *and* we want offline overview maps, the verdict below can be revisited (see the condition in section 6).

---

## 6. Go / No-Go verdict

| Feature | Verdict | One-sentence reasoning |
|---|---|---|
| **S210 — self-hosted offline PMTiles maps** | **NO-GO (recommend drop from the Phase-5 candidate pool)** | It fits the 100 MB/file cap only at an overview zoom (z ≤ 12) that carries no street detail, the street-level zoom that would make offline maps genuinely useful exceeds the cap for the dense Tokyo–Kyoto–Osaka corridor, and paying for it means a new runtime dependency, a full new vector style, and a large, staleness-prone binary that roughly doubles every clone, all to duplicate a "polished mock" (D-003/D-079) online basemap that already works keylessly and free. |

**Reasoning (full):** This is a feasible-but-not-worth-it result, not a technical wall. The MapLibre 5.24 + `pmtiles` path works (section 4). The overview-zoom file fits under 100 MB with margin, even per the pessimistic size bracket (section 3). But the feature only delivers real value at street zoom, meaning finding a place on a block, offline. At z14–15 the Japan corridor is hundreds of MB to multiple GB, over the GitHub Pages 100 MB per-file hard cap that git enforces on push. Capping to z12 to fit means shipping a district-level overview that adds little the current online CARTO basemap doesn't already give, in exchange for a new dependency, a hand-authored vector style plus glyph/sprite assets, and a 50–100 MB binary permanently in git history (`.git` is 84 MB today). Offline maps are also not a stated project goal: the map is explicitly an online-first polished mock. The cost/value math is clearly negative for v5.

**Condition that would flip this to GO** (revisit, don't build now): a concrete offline-use requirement, plus acceptance of (a) an overview-only zoom (z ≤ 12, per-region split, Japan the binding one), (b) a live measured confirmation < 100 MB via section 5, and (c) the git-binary maintenance handled out of history (Git LFS or a build-time fetch, not a committed blob). Absent all three, S210 should be formally dropped.

---

## 7. If it were GO: rough S210 scope (for completeness)

So a future revisit isn't a blank page:
1. Extract per-region `.pmtiles` at z ≤ 12 via section 5; commit via Git LFS or a build-time fetch into `public/maps/`, never a raw blob in history.
2. Add `pmtiles@^4` (promise-based `addProtocol`, matching maplibre-gl v5); register the protocol in `trip-map.tsx`'s lazy init (keep it on the existing lazy chunk, D-047).
3. Author a **vector** style (layers + glyphs + sprite) to replace or augment the current raster `buildMapStyle()`. This is the bulk of the real work; the current style is raster-only.
4. Offline/online toggle plus graceful fallback to the CARTO raster when the pmtiles asset is absent.
5. Tests: protocol registration, style loads offline (no network), attribution still renders.

---

## 8. Notes for downstream
- No app code changed by this slice. The existing raster map (`lib/map-style.ts`, `trip-map.tsx`) is untouched and remains the shipped map.
- The free-tools-only rule is satisfied by the tooling (the Protomaps planet build and `go-pmtiles` are OSS and keyless). Free tools were never the blocker; the 100 MB/file cap against Japan's density is.
