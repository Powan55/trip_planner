# S212: app-wide axe coverage audit (final a11y pass)

**Date:** 2026-07-19. **Result: axe serious/critical = 0 on every route, every Travel Mode
designed state, and every key dialog.** Zero violations found, zero fixes needed, zero excludes
added. Permanent net: `e2e/a11y-full-audit.spec.ts` (15 tests, run twice, green both), on top of
the untouched existing packs.

## Coverage map (who gates what)

| Surface | Pack | Gate level |
|---|---|---|
| `/`, `/plan/`, `/nepal/`, `/japan/`, `/map/` (traveler) | `a11y.spec.ts` (S85/S157) | serious/critical/**moderate** |
| `/` + `/plan/` in-trip panels (Today, recap, budget, burn-rate) | `a11y-intrip.spec.ts` (F19b) | serious/critical |
| `/journal/` (empty + populated + editor) | `journal-browse-a11y.spec.ts` (S153) | serious/critical |
| `/packing/` (template + partially checked) | `packing-a11y.spec.ts` (S206) | serious/critical |
| `/checklist/` (template + checked + note) | `docs-checklist-a11y.spec.ts` (S217) | serious/critical |
| `/travel/` legibility OFF/ON, both iPhone projects | `tm-acceptance.spec.ts` TM-12 (S191) | serious/critical |
| 6 dialog close-targets (scoped subtree scans) | `s157-a11y-close-targets.spec.ts` | serious/critical |
| New: `/flights/`, `/safety/`, `/recap/`, `/settings/`, `/share/` (traveler) | `a11y-full-audit.spec.ts` (S212) | serious/critical |
| New: TM designed states on desktop, full page: pre / nepal / japan / post / empty-date / legibility-ON | `a11y-full-audit.spec.ts` | serious/critical |
| New: key dialogs as full-page scans: trip-join handshake (`?trip=`), add-to-itinerary (quick-add), expense log, Wrapped story populated | `a11y-full-audit.spec.ts` | serious/critical |

Every one of the 15 routes is now axe-gated in its traveler state; `/` and `/plan/` additionally
in-trip; `/travel/` in all six designed states on desktop and (legibility pair + TM-12) on both
iPhone device projects.

## Ground rules held

- No existing gate was weakened. The S85 five-route moderate-level gate and every per-route pack
  are byte-untouched.
- No axe `exclude` was added. The new pack carries only the pre-existing, already-recorded
  exclusion every pack shares: the opaque MapLibre WebGL `<canvas>` (no semantic subtree; host
  labelled at `map-shell`). Nothing else is excluded anywhere.
- moderate/minor are logged as advisory in every scan's output (`axe SUMMARY` lines); both runs
  reported `moderate/minor=0` on all 15 new scans as well.

## Findings

None. All 15 new scans returned zero violations at every impact level on both runs.
