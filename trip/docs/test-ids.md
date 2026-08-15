# `data-testid` registry (S79)

Stable, documented selector contract for the Playwright E2E waves (S80–S84). This
is a purely additive, non-visual pass: every id below is an attribute added to
an existing DOM node, and nothing else about the markup, styling, or behavior
changed.

Convention: `data-testid="<surface>-<element>[-<qualifier>]"`, describing the
element's role, not its styling. Kebab-case throughout, matching the pre-existing
`scroll-progress` id (`components/scroll-progress.tsx`, unchanged by this slice).

For per-item lists (nav links, filter chips, cards), the qualifier is the item's
own stable value (route label, category, id) rather than an index, so `Array.map`
re-ordering or filtering never invalidates a selector, and no two rendered nodes
ever share an id.

---

## 1. Hero countdown: `components/hero-section.tsx` (route: `/`)

| testid | element | notes |
|---|---|---|
| `countdown-months` | value `<div>` inside a countdown unit cell | Countdown grid, visible only when `mounted && !todayInTrip` (i.e. outside the trip window; this is the default state before Dec 9, 2026). |
| `countdown-weeks` | " | " |
| `countdown-days` | " | " |
| `countdown-hours` | " | " |
| `countdown-minutes` | " | " |
| `countdown-seconds` | " | " |
| `countdown-total-days` | the "N total days" value `<span>` | Same visibility as above. |
| `hero-travel-mode` | the in-trip panel container `<div>` | Renders instead of the countdown grid, only when `mounted && todayInTrip` is non-null: only when the app clock (via `getNow()` / the `?today=` query override, D-075) falls inside Dec 9, 2026 – Jan 9, 2027. To reveal it in a dev/E2E run without waiting for the real date, drive the clock with `?today=2026-12-12` (or any in-window date) per the existing `lib/trip-now.ts` override. |
| `hero-day-number` | the "Day N" value `<span>` inside the travel-mode panel | Same reveal condition as `hero-travel-mode`. |

## 2. Dashboard: `components/trip-dashboard.tsx` (route: `/`)

Namespaced `dashboard-*`, deliberately distinct from the hero's `countdown-*` since
both can render on `/` simultaneously.

| testid | metric |
|---|---|
| `dashboard-trip-duration` | Total Trip Duration (days) |
| `dashboard-days-remaining` | Days Until Departure |
| `dashboard-trip-status` | Trip Status (Upcoming / On the trip / Completed) |

S321: the dashboard was trimmed from 9 cards to these 3 temporal facts. The six removed
ids (`dashboard-countries`, `-cities`, `-attractions-saved`, `-restaurants-listed`,
`-photo-spots-saved`, `-planned-days`) no longer render; the actionable at-a-glance data
(budget/packing/next-up/weather) lives in `home-bento` instead.

Implementation note: `StatCardProps` gained a `testId: string` field (threaded
through the existing `stats` array → `<StatCard>` → the card's root `m.div`) so
each of the 9 cards gets a distinct, stable id. This is the one non-trivial "wiring"
change in the slice. No existing prop, className, or render path was altered.

## 3. Top nav: `components/navbar.tsx` (desktop `md:` and up)

| testid | element | notes |
|---|---|---|
| `navbar` | the `<nav>` root | |
| `navbar-link-today` / `navbar-link-plan` / `navbar-link-map` / `navbar-link-guides` | desktop nav `<Link>`s | Derived from `item.label.toLowerCase()` via `primaryItemsForActiveTrip()` (`lib/nav-items.ts`); only visible `md:` and up. The top row is **four** primaries on the default trip (Today · Plan · Map · Guides). On a **custom** trip the `defaultTripOnly` `Guides` seat is dropped and refilled by the one `customPrimary` companion, so the fourth id becomes `navbar-link-journal`. Every other destination (Flights, Journal, Safety, Recap, Packing, Documents, Shared Links, Trips, Settings) lives behind the desktop "More" disclosure, see `navbar-more-toggle` below. Historical: this row read `navbar-link-home / -plan / -flights / -nepal / -japan / -map` until S320 renamed Home→Today, fronted Nepal/Japan behind `/guides/`, and dropped Flights to a companion. |

> S319: the mobile full-screen hamburger (`navbar-menu-toggle` + the `#mobile-nav-menu` panel with its `navbar-link-mobile-*` links) was deleted, so the bottom tab bar (section 4) is the sole mobile nav. On `<md` the navbar renders only the brand, the desktop-hidden clusters, and the Travel Mode entry. Companion routes' mobile home is re-established by S320.

## 4. Bottom tab bar: `components/bottom-tab-bar.tsx` (all routes, `<md` only)

| testid | element | notes |
|---|---|---|
| `tab-bar` | the `<nav>` root | `md:hidden`. |
| `tab-bar-today` / `tab-bar-plan` / `tab-bar-map` / `tab-bar-guides` / `tab-bar-more` | each tab `<Link>` | Derived the same way as the navbar (`item.label.toLowerCase()`), from `primaryItemsForActiveTrip()` plus a synthetic `MORE_TAB` (`components/bottom-tab-bar.tsx`, `{ label: 'More', href: '/more/' }`) appended last. **Five** tabs, which is what holds the D-071 ≥44px-at-360px floor. On a custom trip the fourth id is `tab-bar-journal` (the `Guides` seat is `defaultTripOnly`). Every other destination lives on the `/more/` page, which renders `navItemsForActiveTrip()` minus the primaries, and in the command palette. Build-output note: this id is a template literal (`` `tab-bar-${item.label.toLowerCase()}` ``) evaluated at render time, so a static grep of the emitted JS bundle finds the template expression, not the pre-concatenated string `"tab-bar-plan"`. The literal id is what actually lands in the DOM at runtime. Historical: this row read `tab-bar-home / -plan / -flights / -nepal / -japan / -map` (6 tabs) until S320. |

## 5. Quick-add FAB: `components/quick-add-fab.tsx` (most routes, `<md` only)

| testid | element | notes |
|---|---|---|
| `quick-add-fab` | the floating action `<button>` | `md:hidden`. Hides itself while `document.body.dataset.dialogOpen === '1'` (i.e. while any dialog/sheet is open); that is existing behavior, unchanged. It is route-suppressed (absent from the DOM, not merely hidden) under `/travel` (D-164) and, since S357C, under `/plan`, which has its own S357A sticky composer. So a spec that needs the FAB must host itself on a route where it renders (`/` is the canonical choice); `/plan/` is no longer such a route. |

## 6. Add-to-itinerary dialog: `components/add-to-itinerary-dialog.tsx` (portal, any route with a place card or the FAB)

| testid | element | notes |
|---|---|---|
| `add-item-dialog` | the dialog panel `<m.div role="dialog">` | Portaled to `document.body`; only mounted while `open` is true. |
| `add-item-cancel` | the header "X" close button | This dialog has no separate literal "Cancel" button: the X close icon is the only cancel-role control, so it carries this id. |
| `add-item-title-input` | Title `<input>` | Custom mode only (`mode="custom"`, e.g. opened from the FAB or nightlife's custom-add path). In source mode (opened from a recommendation/photo/map card) title is fixed text, not an input. |
| `add-item-location-input` | Location `<input>` | Custom mode only, same as above. |
| `add-item-maps-link` | the "Search on Google Maps" `<a>` (or disabled `<span>` fallback, same id either state) | Custom mode only. The `<a>` variant appears once Title is non-empty and the disabled `<span>` appears when Title is empty; same testid either way, with `href` presence / `aria-disabled` distinguishing state. |
| `add-item-day-select` | the Date `<select>` | Present in both source and custom mode. |
| `add-item-time-input` | S125: the `TimePicker` trigger `<button>` (was a free-text `<input>` pre-S125) | Present in both modes. Opens the picker overlay (section 22). |
| `add-item-duration-input` | S125: the `DurationField` minutes `<input type="number">` (was free text pre-S125) | Present in both modes. |
| `add-item-confirm` | the "Add to plan" / "Update plan" submit `<button>` | Present in both modes; `disabled` in custom mode until Title is non-empty (D-074). |

## 7. Place detail sheet: `components/place-detail-sheet.tsx` (portal, opened from a guide/nightlife/map card)

| testid | element | notes |
|---|---|---|
| `place-detail-sheet` | the sheet panel `<m.div role="dialog">` | Portaled; bottom sheet on mobile, right panel `sm:` and up. Only mounted while `open && place` are both truthy. |
| `place-detail-close` | the header "X" close button | |
| `place-detail-add-to-plan` | either the `AddToPlanButton` wrapper `<div>` (source-linked: recommendations/photography/map) or the custom-add trigger `<button>` (nightlife) | Exactly one of the two renders per sheet instance, depending on whether the caller passed `addSource`/`addSourceType` or `customAddDraft`. Same testid either way, since both are "the add-to-plan affordance" for this sheet. |

## 8. Guide filters: `components/recommendation-section.tsx` (routes: `/nepal`, `/japan`, and any embedding page)

S322G collapsed the facets into one sheet. The sort `<select>`, city chips,
Saved/Planned chips and category chips are no longer permanently stacked above the grid:
they live inside a "Filters · n" sheet (a D-021 modal with portal, focus trap, Escape and
focus return, the same primitive as `PlaceDetailSheet`). Every chip testid below is
unchanged, but it is only in the DOM while the sheet is open. E2E: click
`guide-filters-trigger`, wait for `guide-filters-sheet`, then assert on or click a chip.
The search input stays pinned above the grid (a query, not a facet) and is always present.

| testid | element | notes |
|---|---|---|
| `guide-search-input` | the search `<input type="search">` | Pinned above the grid (not in the filters sheet) and always present. |
| `guide-filters-trigger` | the single "Filters · n" `<button>` that opens the sheet (S322G) | Pinned next to the search input. `aria-haspopup="dialog"`, `aria-expanded` tracks the sheet, and `aria-label` reflects the active-facet count (`"Filters"` at 0, else `"Filters, N active"`). A count badge renders when N>0. N = active sheet facets (category≠All + city≠All + savedOnly + plannedOnly + sort≠default); search is not counted. |
| `guide-filters-sheet` | the filters sheet panel `<div role="dialog">` (S322G) | Portaled to `document.body`; only in the DOM while open (`AnimatePresence`). Traps Tab, closes on Escape, returns focus to `guide-filters-trigger`. |
| `guide-filters-close` | the sheet's X close `<button>` (S322G) | `aria-label="Close filters"`. |
| `guide-filters-clear` | the sheet's "Clear all" `<button>` (S322G) | Resets every facet and the sort; disabled when N=0. Distinct from the empty-state "Clear filters" button (which stays in the grid, uses `resetFilters`, and does not reset sort). |
| `guide-filters-apply` | the sheet's "Show N results" `<button>` (S322G) | Applies (closes) the sheet; label shows the live `filtered.length`. |
| `guide-sort-select` | the sort `<select>` | Now inside `guide-filters-sheet`. |
| `guide-filter-city-<value>` | each city filter chip `<button>` | Inside `guide-filters-sheet`. Only rendered when the data set has more than one city (`cities.length > 2`, i.e. more than "All" + 1). `<value>` is `city.toLowerCase()`, e.g. `guide-filter-city-all`, `guide-filter-city-kathmandu`. |
| `guide-filter-category-<value>` | each category filter chip `<button>` | Inside `guide-filters-sheet`. Always rendered (one per `categories` prop entry incl. "All"). `<value>` is `cat.toLowerCase()`, e.g. `guide-filter-category-all`, `guide-filter-category-food`. |
| `guide-filter-saved` | the "Saved" filter chip `<button>` (S149) | Inside `guide-filters-sheet`. Only rendered once favorites (`hooks/use-favorites.ts`) have hydrated and this section has >= 1 favorited item; `aria-pressed` reflects the `savedOnly` toggle. Cuts across categories (a separate boolean, not folded into `guide-filter-category-*`). |
| `guide-results` | the results grid `<div>` | Only rendered when `filtered.length > 0`. |
| `guide-empty-state` | the empty-state `<div>` | Only rendered when `filtered.length === 0` (i.e. the active search/city/category combination matches nothing); includes the "Clear filters" reset button. |
| `guide-card-<id>` | each result card's clickable button (opens the detail sheet) | `<id>` is the recommendation's own `item.id` (stable, from the underlying data set), chosen over a positional index so filtering/sorting never invalidates a selector. |
| `guide-favorite-<id>` | each card's favorite/bookmark toggle `<button>` (S149) | Sibling of the card's `AddToPlanButton`, not nested in the `guide-card-<id>` button. `<id>` is `item.id`. `aria-pressed` reflects favorited state; only rendered once `hooks/use-favorites.ts` has hydrated (`favoritesReady`), so server/first-client-paint always match (no hydration mismatch). |
| `guide-tilt-<id>` | each card's outer `m.div`, the 3D-tilt target (S215) | `<id>` is `item.id`. Carries `data-tilt-enabled` (`"true"` normally, `"false"` under `prefers-reduced-motion`, the D-007/D-056b hard guard). Pointer move over it (desktop) / device orientation (mobile) springs `rotateX`/`rotateY`; at rest it is rotate-0 (visually identity). |
| `guide-tilt-optin` | the section's iOS motion-tilt opt-in `<button>` (S215) | Rendered once per section, and only on browsers that gate the sensor behind `DeviceOrientationEvent.requestPermission` (iOS 13+), not yet granted, motion allowed. Absent on desktop/Android and under reduced motion. Tapping it requests the sensor permission from a user gesture. |

No dedicated `guide-result-count` element exists (there is no single "N results"
line). An E2E author wanting a count can read the live per-chip counts (already
inside each `guide-filter-*` button as plain text) or count `guide-card-*` nodes
under `guide-results`.

## 9. Map shell: `components/map-section.tsx` (route: `/map`)

| testid | element | notes |
|---|---|---|
| `map-shell` | the persistent map-host `<div>` (contains the MapLibre canvas) | Always in the DOM; toggles between an inline-slot layout and a fullscreen (fixed inset-0) layout via `isFullscreen`, same node either way (D-069 relocation pattern). Worth flagging for anyone still holding the "map is a mock" project note: this component now renders a real MapLibre GL map with real geodata. Issue #1 adds the seam for what the overlay is actually DRAWING, since the route lives in WebGL and is invisible to the DOM: `data-route-day` = the trip date whose stops are drawn (empty = the whole trip, or the overlay is off) and `data-route-stop-ids` = those stops' marker ids, comma-joined, in drawn order (the `travel-day-map` `data-stop-ids` idiom — ids, not a count, so "the pins changed" is distinguishable from "the pins happen to number the same"). A day set with no ids is an EMPTY day; no day and no ids is the overlay switched off. |
| `map-fullscreen-toggle` | the expand/collapse `<button>` (top-left, over the map) | |
| `map-filter-<value>` | each category filter chip `<button>` | `<value>` is `value.toLowerCase().replace(/\s+/g,'-')`, e.g. `map-filter-all`, `map-filter-attraction`, `map-filter-photo-spot` (for the "Photo Spot" category), `map-filter-day-trip`. |
| `map-itinerary-toggle` | the "My itinerary" overlay `<button>` | `aria-pressed` reflects on/off. S381 (D-279): `data-stop-count` now counts exactly-placed plans, not "stops shown". Under D-278's ladder every plan is shown, so the old shown-vs-total ratio was always N === M, a number that could no longer fail. `data-total-count` is unchanged (all plans). The visible text (`map-itinerary-count`) reads "· N of M plans exactly placed". |
| `map-itinerary-count` | the count `<span>` inside the toggle (`aria-hidden`, rendered only while the overlay is on) | "· N of M plans exactly placed", where N = pins/sourceIds/name matches and M = every plan. |
| `map-stop-popup` | the popup body for a drawn itinerary stop (S381), portaled into the MapLibre popup | `data-approximate` (`"true"`/`"false"`), `data-derived-from` = the verbatim text an approximate coordinate came from. Lists every plan sharing that point (D-278 per-coordinate dedupe). Only on `/map` (`enableStopPopup`); a stop that is one of the 27 curated markers keeps the curated popup. Issue #1: the heading reads "Day N · Stop M" — M is the number drawn on the pin (its position within that day), so the canvas number is checkable against the popup. |
| `map-stop-approx-note` | the "Approximate — placed from …" `<p>` inside that popup | Present only when `data-approximate="true"`; quotes `derivedFrom` verbatim (D-279). |
| `map-stop-set-pin` | the "Set an exact pin in the planner" link in that popup | The affordance to fix an approximate position (D-279). Goes to `/plan/`, where the S357B pin picker lives. No second picker was built. |

Marker popups (MapLibre `Popup` DOM, portaled per-click) and the fullscreen portal
slot were left untagged: they are ephemeral, imperatively-created nodes outside this
pass's target list. Say so if a later E2E wave needs a popup-content hook.

## 10. Nightlife (bonus): `components/nightlife-section.tsx` (routes: `/nepal`, `/japan`; not mounted on `/`)

S113 made this traveler-gated. The whole section (root included) renders `null` unless
`useActiveTraveler().traveler` is non-null, i.e. a signed-in traveler (a nickname identity). With
no guest mode (D-241), `traveler === null` only ever means "not mounted yet" in practice:
TokenGate's wall blocks every other case, so an unidentified visitor never reaches this route at
all. This is a soft UI visibility gate only (D-053); the content still ships in the static bundle
either way.

| testid | element | notes |
|---|---|---|
| `nightlife-section` | the `<section>` root | absent entirely until a traveler is signed in (S113) |
| `nightlife-add-<id>` | each venue card's clickable button (opens the detail sheet, which is where the actual "add to plan" custom-dialog trigger lives, tagged `place-detail-add-to-plan`) | `<id>` is `venue.id`. Named `nightlife-add-*` for consistency, though the card itself opens the detail sheet rather than adding directly: the add action is one tap further, inside the sheet. Say so if you want this renamed to `nightlife-card-<id>` for accuracy; happy to align once a spec is using it. |
| `nightlife-added-<id>` | passive "Added" badge `<span>` inside the venue card (S138, D-146) | `<id>` is `venue.id`. Renders only when `findPlacements(nightlifeSourceId(venue.id)).length > 0`. Decorative only (not a nested interactive control); add/modify/remove still lives one tap further, inside the detail sheet (`place-detail-add-to-plan`). |

## 11. Calendar / Plan: `components/calendar-planner.tsx` (route: `/plan`)

Distinct `calendar-*` surface prefix from the FU-5/S79 `add-item-*` dialog
(`components/add-to-itinerary-dialog.tsx`). The calendar has its own separate
add/edit modal (`ItemEditor`), so the two never collide even though both can be
reasoned about as "the add-to-itinerary form."

| testid | element | notes |
|---|---|---|
| `calendar-day-<date>` | month-grid day-cell `<button>` (`renderCalendar`) | One per trip date (`<date>` = the ISO date string, e.g. `calendar-day-2026-12-09`). Renders in the desktop `lg+` left pane (Calendar View) and in the mobile collapsible "Month view" (`showMonthView`); it is the same node and id either place, since it comes from one shared `renderCalendar()` call. The empty filler cells (leading blanks before the 1st of the range) get no testid. |
| `calendar-prev-day` | "Previous day" `<button>` | Day-detail agenda pane header. Always present; `disabled` at the first trip date. |
| `calendar-next-day` | "Next day" `<button>` | Always present; `disabled` at the last trip date. |
| `calendar-add-item` | "Add Activity" `<button>` | Always present, below the day's item list. |
| `calendar-empty-state` | the empty-state `<div className="text-center py-12">` | Only rendered when the selected day's *visible* item count is 0: either the day has no stored items, or it has items but none match the active (read-only) author filter. The two cases share this one id and are distinguished by the rendered copy, not a separate testid. Verified end-to-end (CDP) by deleting every item on a day and confirming this resolves to exactly 1 while `calendar-item-*` drops to 0. |
| `calendar-item-<id>` | item card root `<div>` (`SortableItem`) | One per stored item on the selected day (post author-filter). `<id>` = `item.id`. |
| `calendar-item-time-<id>` | S125: the card's time/duration/location meta `<div>` | Wraps the display-rule output (`describeItemTime`, see section 5 of `docs/time-model-blueprint.md`): AM/PM + badge, or a verbatim legacy string, or nothing. |
| `calendar-item-time-badge-<id>` | S125: the NPT/JST badge `<span>` inside the meta div | Only rendered when `effectiveStartMinutes` is defined (never for a legacy-only unparseable `time`, which shows unbadged). |
| `calendar-item-clash-<id>` | S126: the warn-only overlap badge `<span>` inside the meta div | See section 23 below. Never blocks save/drag. S383 amended the source set: it is now `clashingItemIds(visibleItems)`, the author-filtered day rather than the full stored day. Order-independent either way; with no filter selected the two sets are identical. |
| `author-filter` | S383 (D-092): the "Filter by" chip row root `<div>` (`author-filter.tsx`) | Renders nothing at all when no item carries attribution (dormant/portfolio build). Exactly one per page: S383 deleted the duplicate mount in `trip-timeline.tsx`, since both it and the planner used to render one and both are on `/plan` since S321. A count > 1 is a regression. |
| `author-filter-all` | S383: the "All" chip `<button>` | Always present when the row renders; the inert default. `aria-pressed` carries the selection. |
| `author-filter-mine` | S383: the "My edits" chip `<button>` | Only rendered when a display name is set and that name actually appears as an author in the data. |
| `author-filter-author-<name>` | S383: one chip `<button>` per distinct author | `<name>` is the raw display name, not slugified, so a name containing a space produces e.g. `author-filter-author-Jane Doe` and has to be quoted in a selector. The current user's own chip is omitted when `author-filter-mine` is shown (they would filter identically). |
| `calendar-item-edit-<id>` | the card's edit `<button>` | Same `<id>` qualifier as its parent card. |
| `calendar-item-delete-<id>` | the card's delete `<button>` | Same `<id>` qualifier as its parent card. |
| `calendar-editor` | the `ItemEditor` modal `<div role="dialog">` | Only mounted while `showEditor` is true (opened via `calendar-add-item` or a `calendar-item-edit-<id>`). Distinct node/id from `add-item-dialog`. |
| `calendar-editor-cancel` | the header "X" close `<button aria-label="Close editor">` | Same reveal condition as `calendar-editor`. |
| `calendar-editor-title-input` | Title `<input>` | " |
| `calendar-editor-category-<cat>` | each category picker `<button>` | One per `ItineraryCategory` (10 total: `sightseeing`, `food`, `photography`, `shopping`, `nature`, `cultural`, `transportation`, `hotel`, `free`, `nightlife`). `<cat>` is the lowercase category value; these buttons already carried `aria-label={`Category: ${cat}`}`. |
| `calendar-editor-time-input` | S125: the `TimePicker` trigger `<button>` (was a free-text `<input>` pre-S125) | Same id preserved across the swap; now shows `formatTimeAmPm(startMinutes)` or "Add time". Opens the picker overlay (see section 13 below). |
| `calendar-editor-duration-input` | S125: the `DurationField` minutes `<input type="number">` (was free text pre-S125) | Same id preserved; now a plain minutes value (dual-writes `durationMinutes` + canonical `duration` text, D-138). |
| `calendar-editor-location-input` | Location `<input>` | " |
| `calendar-editor-maps-link` | the "Search on Google Maps" `<a>` (or disabled `<span>` fallback, same id either state) | Same pattern as `add-item-maps-link`: the `<a>` (with `href`) appears once Title is non-empty; the disabled `<span>` (`aria-disabled="true"`, no `href`) appears when Title is empty. Same testid either branch; the state is distinguished by tag/attribute, not id. |
| `calendar-editor-notes-input` | Notes `<textarea>` | " |
| `calendar-editor-save` | the "Add Item"/"Update Item" submit `<button>` | `disabled` until Title is non-empty (mirrors D-074's `add-item-confirm` gating). |
| `calendar-day-<date>-spend` | the S103 month-grid "has spend" marker `<span aria-hidden>` (a small gold dot, top-right of the day cell) | S103, additive and read-only (D-018). Rendered on a `calendar-day-<date>` cell only when that day has logged spend (`expensesByDate(useExpenses())[date] > 0`). It is a dot, not a figure (the cramped cell can't fit a currency string); the amount goes to the single-day readout and to the cell's aria-label, which is extended (", Rs 5,000 spent" appended, the activity-count text preserved) rather than replaced. The cell's existing testid/handler/aria-pressed are untouched. |
| `calendar-day-spend-total` | the S103 single-day spend readout `<p>` in the day-detail header | S103, additive and read-only. Rendered under the "Day N • city • country" line only when the selected day has spend; shows that day's total in the day's leg-local currency (`formatMoney`, a day is one leg). Disappears when a no-spend day is selected. Derives from `useExpenses()`, a separate reactive read from the itinerary store, so CRUD/DnD/select are unaffected. |
| `calendar-day-weather-tag` | the S216 quiet contextual weather tag `<p>` in the day-detail header | S216, additive and read-only: a pure derivation over the existing Open-Meteo cache (`weatherCache`, D-078/D-097), with zero new fetch. Rendered under the spend readout only when `lib/weather.ts`'s `getCachedForecastForDate(currentPlan.city, selectedDate)` finds a cached forecast row for that exact city/date (i.e. the Today/Essentials panel already fetched a window covering it). Shows an icon + short condition label (e.g. "☀️ Clear sky"). No cache hit means nothing is rendered and no layout shift. |

The three rows above (two S103 + one S216) are the only additions to this section; every pre-existing
calendar testid, aria-label, handler, and CRUD/DnD/select behavior is unchanged
(the overlay is a pure display addition on top of the existing cells, D-018). The
month-grid `date` was already the per-cell scope variable; the single-day readout
reads the already-in-scope `selectedDate`. No new prop was threaded to the
itinerary store; the expense read is `useExpenses()`, added alongside it.

No new prop was threaded to produce the S79/FU-8 ids above: `item.id` was already in
`SortableItem`'s scope, `date` was already in `renderCalendar`'s per-cell scope,
and `cat` was already the `ALL_CATEGORIES.map` loop variable inside `ItemEditor`.

Out of scope here (say so if a future E2E wave needs them): the mobile `DayStrip`
chips (`components/day-strip.tsx`, a separate component outside this fence;
`calendar-day-<date>` already covers desktop day-selection, which is what the
default E2E waves use), and the desktop Calendar/Agenda view toggle plus the
mobile "Month view" expand/collapse toggle (view chrome, not CRUD).

## 12. Mobile day-strip: `components/day-strip.tsx` (route: `/plan`, `<lg` only)

The mobile counterpart to section 11's desktop `calendar-day-<date>` for day
selection. Below the `lg` breakpoint the month grid is replaced by this horizontally
scrolling one-handed day strip; at `lg` and up the strip is not rendered and
`calendar-day-<date>` is the only day-selection surface.

| testid | element | notes |
|---|---|---|
| `day-strip` | the root `<div role="group" aria-label="Select a trip day">` (the scroller) | Visible only below the `lg` breakpoint (`md/lg:hidden` on the strip's container); the desktop month grid replaces it at `lg+`. |
| `day-strip-<date>` | each day `<button>` (`dates.map`) | One per trip date (`<date>` = the ISO date string already in scope, e.g. `day-strip-2026-12-09`). Same reveal condition as `day-strip`. Distinct per chip so scrolling/selection never invalidates a selector. |

Decorative sub-elements inside each chip (the Today pill, weekday label, day
number, country dot, item-count badge) are `aria-hidden` and were not tagged.

## 13. Backup & Restore: `components/backup-restore.tsx` (route: `/settings`)

Whole-trip export/import panel (S92, D-098). S322 (A4) moved it off `/plan` into the Settings
"Data management" group (`components/settings-panel.tsx`, section 31), a native `<details>` group
that must be expanded (`settings-group-data-toggle`) before these controls are reachable. Distinct
`backup-*` surface prefix. The panel drives the pure `core/vault/export-import.ts`
(`exportItinerary` / `importItinerary`), which reuses the Vault schema and migration runner
(D-095/D-096).

| testid | element | notes |
|---|---|---|
| `backup-restore` | the `<section>` root | Always present once the island mounts (its visibility is the E2E "panel is up" signal). |
| `backup-export-button` | the "Export trip" `<button>` | Triggers a client-side Blob download of `nepal-japan-trip.json` (the v3 Vault envelope). On success `backup-status` shows. |
| `backup-import-trigger` | the "Choose backup file" `<button>` | A styled proxy that opens the hidden file input (`.click()`); the input itself carries the id below. |
| `backup-import-input` | the real `<input type="file">` | Visually `sr-only` but keyboard-reachable + `aria-label`led. E2E drives it directly via `setInputFiles`. Reading a file opens the confirm dialog; it does not import yet. |
| `backup-confirm-dialog` | the confirm overlay `<div role="dialog" aria-modal>` | Only mounted while an import is pending (a file was read). Carries the explicit **shared-trip** replace warning (D-098 flag). |
| `backup-confirm-import` | the "Replace trip" `<button>` | Confirms → runs `importItinerary`. On success `backup-status`; on any failure `backup-error` (and the live trip is untouched, D-098). |
| `backup-confirm-cancel` | the "Cancel" `<button>` | Dismisses the dialog and discards the pending file; nothing is written. |
| `backup-status` | the success `<p aria-live="polite">` | Rendered only in the success state (export done, or import applied). Mutually exclusive with `backup-error`. |
| `backup-error` | the error `<p role="alert">` | Rendered only in the error state (a rejected import, or an export/read failure). The message is safe and user-facing, and the current trip is never destroyed. |

## Deferred (FU-5 fence, resolved in FU-8)

Under the S79 fence, `components/calendar-planner.tsx` and `lib/maps-link.ts` were
not opened or modified in S79. The following surfaces had no testids as of S79 and
were explicitly deferred to a fast-follow once the FU-5 lane merged:

- Calendar day cells / month-view cells (the `/plan` page's calendar grid).
- Itinerary item cards inside a calendar day (the CRUD read surface).
- The calendar's own add/edit item form (`ItemEditor`, separate from
  `add-to-itinerary-dialog.tsx`): add/edit/delete controls, category picker,
  save/cancel/delete buttons.
- Calendar empty-state (unplanned day) presentation.

Status: done as of FU-8. FU-5 landed (`e4ddb8c`), unblocking the calendar file,
and all of the above are now tagged. See section 11 above for the full id list,
elements, and reveal conditions. Nothing in this registry is still "deferred /
no testids yet."

## 14. Today panel: `components/today-panel.tsx` (route: `/`)

The in-trip "Today" agenda island (S98). Mounted on Home via
`dynamic({ ssr:false })` right after `<HeroSection />` and before `<TripDashboard />`.
Outside the trip window it renders `null` and taps nothing (`getTodayInTrip()` is
`null` pre- and post-trip). To reveal it in a dev/E2E run without waiting for December,
drive the clock with `?today=2026-12-12` (or any in-window date) per the D-075
`lib/trip-now.ts` override, the same mechanism the hero's `hero-travel-mode` uses.
Distinct `today-*` surface prefix from `calendar-*` and `hero-*`.

| testid | element | notes |
|---|---|---|
| `today-panel` | the `<section>` root | Present only when the app clock is inside the trip window (and the store has hydrated). Its visibility is the E2E "we're in-trip" signal; absent (`toHaveCount(0)`) outside the window. |
| `today-next-up` | the "Up next" rail `<div aria-live="polite">` | S100. Rendered only when today has items (above the agenda, below the weather card). Names the next upcoming, not-done, timed item by the resolved clock (`nextUp(items, getNow()-time)`; under a `?today=DATE` clock "now" is local noon "12:00"). When nothing is upcoming (all done/past, or no timed items) it shows an "all caught up" line instead, and the rail node is still present. Advances live as the day progresses and when the current item is toggled done. Absent on a zero-item day (the empty state renders instead). |
| `today-empty-state` | the empty-state `<div>` | Rendered only when today's `getDayPlan(date).items` is empty (a free/unplanned in-trip day). Mutually exclusive with the agenda `<ul>`; carries an "Open the planner" link. |
| `today-agenda-item` | the item title `<span>` inside each agenda row | One per today's item. A read/count hook; the interactive control is the parent toggle below. Count these to assert agenda length. |
| `today-done-toggle-<itemId>` | the whole agenda-row `<button>` (the done toggle) | One per item; `<itemId>` = the item's own stable `id`. `aria-pressed` reflects done state (`"true"`/`"false"`), ≥44px min-height, keyboard-operable. Clicking calls the existing `updateItem(date, id, { done })` so a toggle persists across reload (D-018-class) and, sync-on, rides rev/hlc to friends (D-106). |

The `done`/not-done visual (✓ + strikethrough + dim) is CSS-only and reduced-motion
safe; the check indicator span, the time/location/category meta, and the "N / M done"
counter are `aria-hidden`/`sr-only`-labelled decorative sub-elements and were not tagged.

## 15. Weather + golden hour: `components/weather-card.tsx` (route: `/`)

The weather + golden-hour card (S99), mounted inside the in-trip Today panel
(`components/today-panel.tsx`) above the agenda. Fetches Open-Meteo client-side (D-004
keyless, no backend) for the current trip city and caches the last-good response through the
typed storage gateway (`weatherCache`, key 9) for an offline fallback. Same in-trip reveal
condition as `today-panel`: drive the clock with `?today=2026-12-12` to reveal it in an E2E
run. Distinct `weather-*` surface prefix.

| testid | element | notes |
|---|---|---|
| `weather-card` | the card root (`<section>` live/cached, `<div>` loading/unavailable) | Always present once the Today panel mounts. `data-state` is the E2E settle signal: `loading` (first fetch in flight) → `live` (fresh) \| `cached` (offline, stale last-good) \| `unavailable` (no data + no cache). Assert against a concrete non-`loading` state. |
| `weather-temp` | current temperature `<span>` | Rounded °C, e.g. `12°`. Live/cached states only. |
| `weather-condition` | condition label `<p>` | The WMO-code label (`weatherCodeToLabel`), e.g. "Mainly clear". |
| `weather-hilo` | today's high/low `<p>` | Rounded °C H/L; each line carries an `aria-label` ("High N degrees" / "Low N degrees"). |
| `weather-golden-hour` | the golden-hour block `<div>` | Highlighted for photographers (the app's photography theme). Contains the two rows below. |
| `weather-golden-morning` | the morning golden-hour row `<div>` | `[sunrise, sunrise+50m]`, formatted local clock ("6:42 AM – 7:32 AM"); the range `<span>` is `aria-label`led. |
| `weather-golden-evening` | the evening golden-hour row `<div>` | `[sunset-50m, sunset]`, same format/labelling. |
| `weather-cached-indicator` | the offline "last updated …" `<p aria-live="polite">` | Rendered only in the `cached` (offline/stale) state, the quiet fallback signal. Absent when data is fresh. |
| `weather-attribution` | the Open-Meteo attribution `<a>` | Required by D-088 (CC-BY 4.0). Text "Weather data by Open-Meteo.com", `href="https://open-meteo.com/"`. Present in live/cached states. |
| `weather-forecast` | the 7-day outlook `<details>` disclosure | S150. Native `<details>`/`<summary>`, collapsed by default and keyboard-toggleable with no JS state. Rendered only when `data.forecast` is non-null and non-empty (parsed from the same Open-Meteo response as the current-day fields, zero extra fetch); otherwise it is absent, which is not an error. Present in both live and cached (stale) states; the outlook rides the same `data.stale` flag as the rest of the card. |
| `weather-forecast-day` | each outlook row `<li>` | One per forecast day (≤7, index 0 = today); shows the day label ("Today"/"Tomorrow"/short weekday), condition, hi/lo (`aria-label`led), and that day's golden-hour times. |

The temperature/condition icons, the golden-hour icons, the outlook's chevron + per-row
golden-hour icons, and the loading skeleton bars are `aria-hidden` decorative sub-elements and
were not tagged. The card is static markup (no motion-only affordance), so it is
reduced-motion-safe by construction: the parent Today panel owns the reveal animation, already
reduced-motion gated (S98), and the outlook's own chevron-rotate/hover transitions fall under the
app-wide `prefers-reduced-motion` CSS collapse (`app/globals.css`), same as everywhere else.

## 16. Trip Budget: `components/budget-panel.tsx` (route: `/plan`)

The trip-budget panel (S101, D-110), mounted on `/plan` between the calendar planner and
Backup & Restore via `dynamic({ ssr:false })`. Lets the user set per-leg + per-category
budgets (Nepal in NPR, Japan in JPY), choose the home/display currency, and override the
two exchange rates; per-leg + grand totals roll up into the home currency. All edits persist
through the typed storage gateway (key 10, `budgetStore`) so they survive a reload (D-018-class).
Distinct `budget-*` surface prefix, so it never collides with the `calendar-*` / `backup-*`
surfaces that also live on `/plan`.

S322 (A4): the four money sub-views (budget · expenses · burn · settle) now sit behind a
segmented control (a real WAI-ARIA `role="tablist"` with roving tabindex + arrow/Home/End keys).
One view shows at a time, default Budget, so `/plan` stays calendar-first. The inactive views stay
mounted but `hidden` (`display:none`): visibility and `.click()` assertions must select the view's
tab first, while `toHaveText`/`toHaveCount`/`toHaveValue` read the hidden panels fine. Backup &
Restore is no longer on `/plan`; it moved into the Settings Data group (sections 31 and 13).

| testid | element | notes |
|---|---|---|
| `budget-panel` | the `<section>` root | Always present once the island mounts (its visibility is the E2E "panel is up" signal). |
| `budget-view-tab-budget` / `-expenses` / `-burn` / `-settle` | the four `role="tab"` `<button>`s in the tablist | S322: select a money view (one at a time). `aria-selected` reflects the active view; roving tabindex (active tab is the only tab stop); ≥44px. Default active = `budget`. |
| `budget-view-panel-budget` / `-expenses` / `-burn` / `-settle` | each `role="tabpanel"` `<div>` | Holds one money view; `hidden` unless its tab is active. |
| ~~`budget-currency-*` / `budget-rate-*`~~ | n/a | S146 relocated these to `/settings` (see section 31). The home-currency toggle and rate overrides moved off this panel into `settings-panel.tsx` with the same testids; the write path (`use-budget`) is unchanged. |
| `budget-leg-nepal` / `budget-leg-japan` | each leg's card `<div>` | Container for the leg's total input, home-currency echo, and the category breakdown. |
| `budget-leg-nepal-input` / `budget-leg-japan-input` | the leg total-budget `<input type="number">` | In the leg's local currency (Nepal NPR, Japan JPY); the currency symbol is a decorative prefix. Empty ⇒ 0. |
| `budget-leg-nepal-home` / `budget-leg-japan-home` | the per-leg home-currency echo `<p>` | Shows the leg total converted to the home currency (or "Shown in {cur}" when the leg currency is the home currency). |
| `budget-leg-<leg>-categories-toggle` | each leg's category `<summary>` (inside a `<details>`) | Expands the optional per-category budget rows. |
| `budget-cat-<leg>-<category>` | each per-category `<input type="number">` | One per leg × the 10 `ItineraryCategory` values, e.g. `budget-cat-nepal-food`. In the leg's local currency; `aria-label`led; empty/0 ⇒ unset (dropped from the stored map). |
| `budget-grand-total` | the grand-total `<div aria-live="polite">` | Announces the total when it changes (currency toggle / any budget edit). |
| `budget-grand-total-value` | the grand-total value `<p>` | Nepal + Japan summed and converted to the home currency; grouped, no decimals; never `NaN`. |

The wallet / info / refresh icons, the per-input currency-symbol prefixes, and the leg
subtitles are `aria-hidden` decorative sub-elements and were not tagged. The panel's reveal
animation is reduced-motion gated (framer `useReducedMotion`); the inputs themselves have no
motion-only affordance.

## 17. Expense logging: `components/budget-panel.tsx` + `components/expense-dialog.tsx` (route: `/plan`)

The fast expense-log flow (S102, D-111). The log trigger and list live inside the S101 budget
panel (`budget-panel.tsx`); the dialog is a global portal (`expense-dialog.tsx`) opened via the
`expense:open` event + `ExpenseLogHost` (mounted in `app/layout.tsx` beside `QuickAddHost`). That
is a parallel trigger to the itinerary quick-add FAB, which stays single-purpose (S63/D-071).
Logged expenses feed the S101 `rollUp` `spent` seam, so the panel's spent/remaining update live.
Distinct `expense-*` surface prefix, so it never collides with `budget-*` / `calendar-*` /
`backup-*` on `/plan`.

| testid | element | notes |
|---|---|---|
| `expense-log` | the expense-log block `<div>` inside the budget panel | Always present once the budget island mounts. Contains the trigger + list/empty-state below. |
| `expense-log-open` | the "Log expense" `<button>` | Emits `expense:open` (add mode) → the global dialog. ≥44px; the primary in-panel trigger. |
| `expense-log-empty` | the empty-state `<div>` | Rendered only when no expenses are logged. Mutually exclusive with `expense-list`. |
| `expense-list` | the logged-expense `<ul>` | Rendered only when ≥1 expense exists. Newest-first (sorted by `createdAt` desc). |
| `expense-item-<id>` | each expense row `<li>` | `<id>` = the expense's own stable id (`exp-…`). |
| `expense-item-<id>-amount` | the row's amount `<p>` | In the expense's leg-local currency (e.g. `¥8,000 · japan`). |
| `expense-item-edit-<id>` | the row's edit `<button>` | Emits `expense:open` with the expense (edit mode). `aria-label`led. |
| `expense-item-delete-<id>` | the row's delete `<button>` | Calls `removeExpense(id)` → the list + totals revert live and persist. `aria-label`led. |
| `expense-dialog` | the dialog panel `<m.div role="dialog">` | Portaled to `document.body`; only mounted while open. Full D-021/D-068/D-069 contract + `body[data-dialog-open]` flag. |
| `expense-cancel` | the header "X" close `<button>` | The only cancel-role control (mirrors `add-item-cancel`). |
| `expense-amount-input` | the Amount `<input type="number" inputMode="decimal">` | Autofocused on open (the sub-5s "type first" field). In the current leg's local currency; Enter saves. Required: Save is disabled until a positive amount. |
| `expense-leg-toggle` | the leg `<div role="radiogroup">` | Contains the two leg `role="radio"` buttons below; preset by the host from the trip clock (usually correct, no tap). |
| `expense-leg-nepal` / `expense-leg-japan` | each leg `<button role="radio">` | `aria-checked` reflects the active leg; ≥44px. |
| `expense-category-<category>` | each category chip `<button>` | One per the 10 `ItineraryCategory` values, e.g. `expense-category-food`. `aria-pressed` reflects the active category. Required (always has a value; defaults to `food`). |
| `expense-note-input` | the optional Note `<input>` | |
| `expense-save` | the "Save expense" / "Update expense" `<button>` | `disabled` until a positive amount. In edit mode the label reads "Update expense". |

The budget panel additionally gained spent/remaining testids that layer onto S101's existing ids
(all still present + unchanged): `budget-leg-<leg>-spent-remaining` (+ `-spent` / `-remaining`
value spans), `budget-cat-<leg>-<category>-spent-remaining` (only shown once that category has a
budget set), and `budget-grand-total-spent` / `budget-grand-total-remaining` (only shown once
anything is spent). The over-budget cue is a color/copy change (red "Over by …"), reduced-motion
safe (CSS only). The receipt / edit / delete / plus icons are `aria-hidden` decorative.

## 18. Burn-rate vs plan: `components/burn-rate-view.tsx` (route: `/plan`)

The spending-pace view (S103, D-112), rendered inside the S101 budget panel
(`components/budget-panel.tsx`) between the grand total and the expense log. It is fed the panel's
already-live home-currency totals (`rollUp(model, expensesToSpent(expenses)).total*Home`), the
resolved trip clock (`getNow()`, incl. the D-075 `?today=` override) and the home currency, with no
duplicate budget/expense load, so it stays in lockstep with the panel. All math is the pure
`core/budget/burn-rate.ts` (`burnRate`). Distinct `burn-rate-*` surface prefix. It renders nothing
until a budget is set (the panel's other rows cover the no-budget case); to reveal the mid-trip
figures in a dev/E2E run drive the clock with `?today=2026-12-12` (any in-window date).

| testid | element | notes |
|---|---|---|
| `burn-rate` | the view root `<div>` | Present once any budget is set (`totalBudgetHome > 0`); absent otherwise. Its visibility is the E2E "burn-rate is up" signal. |
| `burn-rate-pace` | the pace badge `<span>` | `data-pace` reflects `'under'`\|`'on'`\|`'over'` (the machine-readable pace); the visible text + icon carry the same ("Under/On/Over pace"), so it reads without color. Shows "Not started" pre-trip (the clock is before Dec 9). |
| `burn-rate-not-started` | the pre-trip explanatory `<p>` | Rendered only when `daysElapsed === 0` (the trip hasn't started): a calm "once you're travelling…" state in place of the bar and figures. |
| `burn-rate-spent` | the spent value `<span>` inside the bar caption | Home-currency spend so far (`formatMoney`). Mid-trip only (absent in the not-started state). |
| `burn-rate-percent` | the "N%" text equivalent `<span>` for the bar | The visible text counterpart to the `role="progressbar"` (which carries `aria-valuenow/min/max`). Mid-trip only. |
| `burn-rate-days` | the "Trip progress" figure `<dd>` | "Day N / 32" + "M days left", the inclusive elapsed day count from the clock. Mid-trip only. |
| `burn-rate-daily-avg` | the "Daily average" figure `<dd>` | Realised `spent / daysElapsed` (home currency), with the daily budget as the sub-line. Mid-trip only. |
| `burn-rate-projected` | the "Projected total" figure `<dd>` | The at-this-pace end-of-trip total (`dailyAvg * 32`). Mid-trip only. |
| `burn-rate-remaining` | the "Left to spend" / "Over budget by" figure `<dd>` | Signed remaining (`Math.abs`, with the label carrying the sign, red when over). Mid-trip only. |
| `burn-rate-pace-sr` | the `sr-only` plain-language pace summary `<p>` | Screen-reader-only sentence (the visible badge is the sighted cue). Mid-trip only. |

The bar is a real `role="progressbar"` (`aria-valuenow` = the clamped `[0,100]` spent-percent, with
`aria-valuemin/max`) and its width transition is CSS, disabled under `prefers-reduced-motion` (framer
`useReducedMotion`). The figures sit in an `aria-live="polite"` `<dl>` so a currency toggle / new
expense announces the moved values. The gauge / trend / calendar icons are `aria-hidden` decorative.
Every number routes through `formatMoney`, so nothing renders `NaN` (the core is total).

## 19. In-trip journal: `components/journal-card.tsx` (route: `/`)

The in-trip per-day text journal (S104, D-113), mounted inside the in-trip Today panel
(`components/today-panel.tsx`) below the agenda. Reads and writes today's entry through
`useJournal()` → the framework-free journal core (`core/journal/model.ts`) + the typed storage
gateway (`journalStore`, key 12). Client-side localStorage only (D-002/D-004); photos and IndexedDB
are out, a declared future boundary. Same in-trip reveal condition as `today-panel`: drive the clock
with `?today=2026-12-14` (or any in-window date) to reveal it in an E2E run. Distinct `journal-*`
surface prefix.

| testid | element | notes |
|---|---|---|
| `journal-card` | the card root `<section>` | Present once the in-trip Today panel mounts (its visibility is the E2E "journal is up" signal); absent (`toHaveCount(0)`) outside the trip window, like the panel. |
| `journal-edit` | the "Edit" `<button>` | Rendered only in the read state (an entry exists). Opens the editor pre-seeded from the entry. ≥44px, `aria-label`led. |
| `journal-write-prompt` | the "Write about today" empty-state `<button>` | Rendered only in the empty state (no entry for today). Opens the editor. Mutually exclusive with `journal-read`. |
| `journal-read` | the read-view `<div aria-live="polite">` | Rendered only when today has an entry. Contains the mood/highlight/body displays below. Mutually exclusive with `journal-write-prompt`. |
| `journal-mood-display` | the read-view mood pill `<span>` | Present only when the entry has a mood; shows the glyph + label (e.g. "Great"). |
| `journal-highlight-display` | the read-view highlight `<span>` | Present only when the entry has a highlight. |
| `journal-body` | the read-view body `<p>` | Present only when the entry has non-empty text (`whitespace-pre-wrap`). |
| `journal-editor` | the edit-view `<div>` | Mounted only while editing (opened via `journal-edit` or `journal-write-prompt`). Contains the mood chips, highlight input, text area, and Save/Cancel. |
| `journal-mood-<mood>` | each mood chip `<button>` | One per the 4 `MOODS` (`great`/`good`/`okay`/`rough`), e.g. `journal-mood-great`. `aria-pressed` reflects selection; single-select, tap the active chip again to clear. ≥44px, `aria-label`led ("Mood: Great"). |
| `journal-highlight-input` | the "Highlight of the day" `<input type="text">` | Optional; `maxLength=120`; `<label>`led. |
| `journal-text-input` | the Notes `<textarea>` | The free-text body; `<label>`led; `resize-y`. |
| `journal-save` | the "Save" `<button>` | Calls `saveEntry(date, {text, mood, highlight})`. Clearing all fields and saving removes the entry (the empty prompt returns, D-018). ≥44px. |
| `journal-cancel` | the "Cancel" `<button>` | Discards the draft, returns to the read/empty state without writing. ≥44px. |

The book/pencil/sparkles icons and the mood glyphs are `aria-hidden` decorative sub-elements. The card
is static markup with CSS-only transitions (no motion-only affordance), so it is reduced-motion-safe by
construction: the parent Today panel owns the reveal animation, already reduced-motion gated (S98).
All copy meets AA at rest (D-100).

## 20. Day recap (plan-vs-actual): `components/trip-recap.tsx` (route: `/`)

The read-only plan-vs-actual day recap island (S105, D-114), mounted on Home via
`dynamic({ ssr:false })` right after `<TodayPanel />` and before `<TripDashboard />`. For each trip
day that has already happened (via `elapsedTripDates(getNow())`, incl. the D-075 `?today=` override),
it pairs the plan (that day's `getDayPlan(date).items`, read-only), the actual (each item's `done`
tick + a "{done} of {planned} done" line, S98), and the reflection (that day's `getEntry(date)`
rendered read-only, S104). Pre-trip it renders `null` and taps nothing (Home is byte-unchanged before
Dec 9), as it does before either store hydrates; it renders in-trip and post-trip. It mutates nothing
(D-002 / D-018: no store writes, no re-seed). To reveal it in a dev/E2E run drive the clock with
`?today=`: `?today=2026-12-20` (in-trip, 12 elapsed days) or `?today=2027-01-10` (post-trip, all 32).
Distinct `recap-*` surface prefix, so it never collides with `today-*` / `journal-*` / `hero-*`.

| testid | element | notes |
|---|---|---|
| `trip-recap` | the `<section>` root | Present only when ≥1 trip day has elapsed and both the itinerary and journal stores have hydrated; absent (`toHaveCount(0)`) pre-trip. Its visibility is the E2E "recap is up" signal. |
| `recap-summary` | the top run-rate `<p aria-live="polite">` | Rendered only when the elapsed days have ≥1 planned activity; "{done} of {planned} activities done across N days". |
| `recap-card-<date>` | each per-day recap `<article>` (`<date>` = the day's ISO string) | One per elapsed trip day, rendered most-recent-first (Day N at top). `aria-labelledby` its own `h3`. |
| `recap-done-count-<date>` | the per-day "{done} of {planned} done" `<p>` | Present only when that day has ≥1 planned item. Reflects S98 `done` state, read-only. |
| `recap-plan-<date>` | the day's plan `<ul>` | Rendered only when the day has ≥1 item. Mutually exclusive with `recap-no-plan-<date>`. |
| `recap-plan-item` | each read-only plan row `<li>` | One per item on the day; `data-done` (`"true"`/`"false"`) reflects the persisted `done` state. Not a control (no toggle), display only; a `sr-only` "— done"/"— not done" carries the status without relying on the color-only tick. |
| `recap-no-plan-<date>` | the "No plans this day" `<p>` | Rendered only on a zero-item elapsed day. |
| `recap-journal-<date>` | the day's read-only journal `<div>` | Rendered only when that day has a journal entry. Contains the mood/highlight/body below. Mirrors `journal-read` markup but is read-only (no editor). Mutually exclusive with `recap-no-journal-<date>`. |
| `recap-journal-mood-<date>` | the read-only mood pill `<span>` | Present only when the entry has a mood; glyph + label (e.g. "Great"). |
| `recap-journal-highlight-<date>` | the read-only highlight `<span>` | Present only when the entry has a highlight. |
| `recap-journal-body-<date>` | the read-only body `<p>` | Present only when the entry has non-empty text (`whitespace-pre-wrap`). |
| `recap-no-journal-<date>` | the "No journal entry for this day" `<p>` | Rendered only when that day has no journal entry. |

The history/book/sparkles icons, the mood glyphs, and the done ticks are `aria-hidden` decorative
sub-elements. The island is static markup with CSS-only transitions plus a framer reveal that is
reduced-motion gated (`useReducedMotion`), so it is reduced-motion-safe by construction. It reads
`useItineraryContext().getDayPlan` + `useJournal().getEntry` read-only; no mutator is reachable from
it (the no-write proof). All copy meets AA at rest (D-100).

## 21. Lazy-island placeholder: `components/lazy-visible.tsx` (route: `/`)

The S107 (D-116) below-the-fold lazy-island wrapper. On Home it defers the below-the-fold
sections (`TripDashboard`, `TripTimeline`, `TravelEssentials`; `FlightsSection` moved off
Home to its own `/flights/` route in S113D). On first paint it renders a sized
`SectionSkeleton` placeholder in
place of each, and only mounts the real (own-chunk) section once it nears the viewport or a
post-hydration idle beat fires, which drops those chunks out of Home's First Load JS.

| attribute | element | notes |
|---|---|---|
| `data-lazy-visible="pending"` | the placeholder wrapper `<div>` | Not a `data-testid` but a state attribute. Present only while a deferred section is still a placeholder (pre-trigger); it is removed once the real section mounts (visibility or the idle fallback), so a below-fold section is reliably present for no-scroll assertions shortly after hydration. Its absence is the "section has mounted" signal. No `data-testid` is emitted by default (the `testId` prop is optional and unused on Home). |

The inner `SectionSkeleton` is `aria-hidden` (a decorative loading placeholder, S67) and
reduced-motion-neutralised in globals.css, so it carries no semantic testid of its own.

## 22. AM/PM time picker: `components/time-picker.tsx` (portal, opened from `calendar-editor-time-input` / `add-item-time-input`)

S125 (D-141). Hand-rolled three-column picker (Hour 1-12 / Minute 00-59 full list / AM-PM),
portaled to `document.body` like the two existing editor dialogs, with its own D-021 focus
contract (focus into the panel on open, back to the trigger on close). Esc is handled on the
panel's own `onKeyDown` rather than a second `document` listener, so it closes only the picker,
never the parent editor it's nested inside (see the file-header comment for the propagation
rationale).

| testid | element | notes |
|---|---|---|
| `time-picker-panel` | the picker overlay panel `<div role="dialog">` | Only mounted while its `open` state is true. |
| `time-picker-close` | the header "X" close `<button>` | Closes without changing the value (same as `time-picker-done`). |
| `time-picker-hour-<n>` | each Hour option `<button role="option">` | `<n>` = `1`..`12`. |
| `time-picker-minute-<n>` | each Minute option `<button role="option">` | `<n>` = `0`..`59` (unpadded, e.g. `time-picker-minute-5` not `-05`), the full list with no 5-minute grid. |
| `time-picker-period-<p>` | each AM/PM option `<button role="option">` | `<p>` = `AM` or `PM`. |
| `time-picker-clear` | "Clear time" `<button>` | Sets both `startMinutes`/`time` to `undefined` (D-138) and closes the picker. |
| `time-picker-done` | "Done" `<button>` | Closes without changing the value beyond whatever column selections already fired `onChange`. |

Every option button is `min-h-[44px]` (D-141 a11y floor); each column is a `role="listbox"`
with roving `tabIndex` (arrow keys/Home/End move within a column; Tab moves between the three
columns' single reachable stops, then Clear/Done/Close).

## 23. Timeline chronological sort + warn-only clash badges: `lib/sort-items-by-time.ts`, `components/trip-timeline.tsx`, `components/calendar-planner.tsx` (D-142)

S126. Two passive, non-destructive views on top of the structured time model (S124/S125):
a pure view-level chronological sort applied only to the timeline's day list
(`sortItemsByTime`, stable, untimed items sink to the end preserving relative order; the
calendar's manually-dragged order is never touched, D-018), and warn-only clash badges
(`clashingItemIds`, half-open overlap on `effectiveStartMinutes`/`durationMinutes`) shown
on both the timeline and the calendar. Zero store writes.

| testid | element | notes |
|---|---|---|
| `timeline-item-<id>` | each day-detail item `<li>` on the Home timeline (`components/trip-timeline.tsx`) | `<id>` = `item.id`. Rendered in the `sortItemsByTime` projection order (chronological, untimed last), not the stored order, which stays the calendar's (D-018). |
| `timeline-item-clash-<id>` | the warn-only overlap badge `<span>` inside a timeline item row | Only rendered when the item's id is in `clashingItemIds(selectedItems)` for that day. `title`/`aria-label` "Overlaps another timed item"; never blocks anything (no modal, no disabled state). |

The calendar's `calendar-item-clash-<id>` (added to section 11's table above) is the same badge
pattern, computed at the day-render level off the full stored set (`clashingItemIds(dayItems)`)
and threaded into `SortableItem` as a plain boolean. `handleDragEnd`/`arrayMove`/
`SortableContext` are byte-unchanged; only the passive badge was added. Both badges are static
Tailwind (`text-amber-300 bg-amber-500/15 border-amber-500/30`, D-020), contrast-checked ≥4.5,
and carry no motion (reduced-motion-safe by construction, D-007).
## 24. Journal browse: `components/journal-browse.tsx` (route: `/journal`) + `components/journal-card.tsx` (route: `/`)

S153. A new dedicated route listing every persisted journal entry (S104's localStorage-only
per-day text journal, `useJournal().entries`), newest-first, readable and editable. Mounted on
`app/journal/page.tsx` via `dynamic({ ssr:false })` (localStorage-only, no meaningful server
render, mirroring `BudgetPanel`/`BackupRestore` on `/plan`). Reached via a direct URL, the
"View all entries" link on `journal-card.tsx`, the `/more/` page (mobile) or the desktop "More" dropdown, or the command
palette (nav/tab/palette wiring landed in FU-33). Editing reuses the real `JournalCard` primitive: exactly
one instance is ever mounted at a time (its internal ids are not date-keyed, so more than one
mounted at once would duplicate ids, an axe violation), so every other row renders as a
read-only summary.

| testid | element | notes |
|---|---|---|
| `journal-view-all` | the "View all entries" `<Link>` in `journal-card.tsx`'s header | Always present (both the read and empty states of the Today panel's journal card); navigates to `/journal/`. ≥44px, visible focus ring. |
| `journal-browse` | the `/journal` page's `<section>` root | Present once the island mounts (loading and hydrated share this root; the loading shell renders a `<p>` in its place, see the hydration note below). |
| `journal-browse-empty` | the empty-state `<div>` | Rendered only when there are zero persisted entries (and none is mid-edit). |
| `journal-browse-list` | the entries `<ul>` | Rendered only when ≥1 entry exists (or one is being edited). |
| `journal-browse-row-<date>` | each read-only entry row `<article>` | `<date>` = the entry's own `YYYY-MM-DD`. Newest-first. Swapped out for a mounted `JournalCard` (the `/`-route `journal-card`/`journal-editor`/… ids, unchanged) while that date is being edited. |
| `journal-browse-edit-<date>` | the row's "Edit" `<button>` | Opens `JournalCard` for that date in place of the row. `aria-label`led with the full date, ≥44px. |
| `journal-browse-mood-<date>` | the row's mood pill `<span>` | Present only when the entry has a mood. |
| `journal-browse-highlight-<date>` | the row's highlight `<span>` | Present only when the entry has a highlight. |
| `journal-browse-body-<date>` | the row's body `<p>` | Present only when the entry has non-empty text. |
| `journal-browse-photos-<date>` | the row's read-only journal-photo thumbnail strip `<div>` | S208. Present only when that day has ≥1 journal photo (`usePhotos().photosFor({kind:'journal',date})`, a pure filter, D-159). Same treatment as `story-photos-<date>` (section 25 below), ported to this route. No strip at all on a photo-less day (no empty box). |
| `journal-browse-photo-<id>` | each thumbnail `<li>` | `<id>` = the photo's own `PhotoMeta.id`. `alt` on the `<img>` is always `PhotoMeta.altText`; `data-missing="true"` on an evicted/absent blob renders the S160 placeholder tile instead of a broken `<img>`. Read-only: no delete/edit control (that's `photo-attach.tsx`'s job, reached via the row's Edit control into `JournalCard`, not from inside the strip). |

Known limitation, flagged but not fixed (it sits outside the S153 fence, which scoped
`journal-card.tsx` changes to the entry link only): while editing a past day from this list, the
mounted `JournalCard` still shows its hardcoded "Today's journal" heading, unconditioned on the
actual date. Every testid, behavior and persistence path is correct; only that one heading string
is misleading for a non-today day. A generic `heading` prop on `journal-card.tsx` would fix it
cleanly, and it is deferred to a follow-up rather than widening the fence here.

## 25. Recap spend line: `components/trip-recap.tsx` (route: `/`)

S153, additive and read-only (D-018). Each `recap-card-<date>` (section 20) gained a per-day spend
line: the sum of that day's logged expenses (`core/recap/model.ts`'s `sumExpensesForDate`, a pure
`Expense[]` → number reducer), formatted with the same `formatMoney`/`legCurrency` the budget
panel uses, in that day's leg-local currency. It reads `useExpenses()`, a new hydration gate on the
recap island alongside the existing itinerary/journal gates, but calls no mutator; the S102
expense store is otherwise untouched.

| testid | element | notes |
|---|---|---|
| `recap-spend-<date>` | the per-day spend `<p>` | Rendered only when that day has >0 logged spend; absent on a no-spend day (no zero-state, mirroring `recap-done-count-<date>`'s "only when >0 planned" pattern). `<date>` = the same ISO string as its parent `recap-card-<date>`. |

The wallet icon is `aria-hidden` decorative. No existing `recap-*` testid, behavior, or markup
changed; this is a pure addition inside the existing card.

## 24. Travel Safety Kit: `components/travel-safety-kit.tsx` (route: `/safety`)

S152. A new, self-owned route: an offline travel-safety reference covering emergency and
embassy contacts, a Nepali/Japanese phrasebook, and a document checklist. It is all
static content (`core/content/safety.ts`, D-088; zero fetch, zero persistence). Mounted on
`app/safety/page.tsx` via `dynamic({ ssr:false })` (mirrors `app/journal/sections.tsx`'s
island shape). Reached via a direct URL, the `/more/` page (mobile) or the desktop "More" dropdown, or the command palette
(nav/tab/palette wiring landed in FU-33, same as `/journal`), and deliberately not on the
bottom tab bar or the desktop top row (D-071 slot ceilings).

| testid | element | notes |
|---|---|---|
| `safety-kit` | the page's root `<div>` | Always present once the island mounts (its visibility is the E2E "kit is up" signal). |
| `safety-contact-<id>` | each emergency/embassy contact's `<li>` | `<id>` is the contact's own stable id (e.g. `safety-contact-np-police`, `safety-contact-jp-us-embassy`). Contains a `tel:` `<a>` with an explicit `aria-label` (accessible name distinct from the visible digit string, D-074) and, for any contact not live-verified this session, a visible "Unverified this session" note (not color-only). |
| `safety-phrase-<id>` | each phrasebook entry's `<tr>` | `<id>` is the phrase's own stable id (e.g. `safety-phrase-hello`). 33 total, grouped into per-category `<table>`s (Greetings / Politeness / Basics / Numbers / Emergency / Directions / Food & Shopping), each wrapped in a horizontally-scrollable container so a narrow viewport never overflows the page (D-022). Each row's Nepali and Japanese cells hold the native script above its romanization; the script span carries `lang="ne"` / `lang="ja"` (#2), which `e2e/safety.spec.ts` asserts on every row — that attribute is the acceptance criterion, so it is a locator contract, not styling. |
| `safety-checklist-<id>` | each document-checklist entry's `<li>` | `<id>` is the item's own stable id (e.g. `safety-checklist-passport-validity`). Grouped under "Before you go" / "Carry with you" / "Digital backups". Static (not an interactive checkbox), with deliberately no persisted checked-state, so it never implies a save it doesn't perform. |

Static markup only (no framer motion, no motion-only affordance), so it is reduced-motion-safe
by construction. All copy is rendered at ≥ white/70 opacity on the dark field to meet the D-100
AA-at-rest floor; `tel:` links are ≥44px tall.

## 26. Offline banner: `components/offline-banner.tsx` (all routes, mounted in `app/layout.tsx`)

S154. An app-wide `navigator.onLine` indicator (`hooks/use-online.ts`): a fixed,
top-center pill that renders nothing while online (including on the server and first
client paint, no SSR mismatch) and appears the instant the browser goes offline,
clearing itself automatically when connectivity returns. No dismiss control. Mirrors
`presence-bar.tsx`'s live-region pill pattern; visual language mirrors
`weather-card.tsx`'s existing `weather-cached-indicator` (calm, not red/alert).

| testid | element | notes |
|---|---|---|
| `offline-banner` | the pill root `<div role="status" aria-live="polite">` | Present only while `useOnline()` reports offline; absent (`toHaveCount(0)`) online. `aria-label="You are offline"`. Contains a visible "Offline — showing cached content" line + `WifiOff` icon (`aria-hidden`) + an `sr-only` full-sentence summary. |

Deliberately not built in S154: a per-guide or per-map stale-cache badge. Guides are
static SW-precached content with nothing that can go stale; the map's stale-tile
indicator is deferred to the S135 map-extraction lane; weather already has its own
per-surface `weather-cached-indicator` (section 15) and was left untouched. This
banner is the one app-wide signal.

## 27. Post-trip story recap: `components/trip-story-recap.tsx` (route: `/recap`)

S156. A new, self-owned route: a read-only, scroll-storytelling text recap of the whole
trip, gated on `isPostTrip()` (`core/recap/model.ts`). It is a separate presentation from the
compact home `TripRecap` card island (`components/trip-recap.tsx`, section 20, untouched), and
reuses the same pure data layer (`summarizePlan` / `elapsedTripDates` / `sumExpensesForDate`)
and read hooks (itinerary/journal/expenses), read-only (D-018). Mounted on `app/recap/page.tsx`
via `dynamic({ ssr:false })` (mirrors `app/journal/sections.tsx`'s island shape). Reached via a
direct URL, the `/more/` page (mobile) or the desktop "More" dropdown, or the command palette (nav/tab/palette wiring landed
in FU-33, same as `/journal` and `/safety`), and deliberately not on the bottom tab bar or the
desktop top row (D-071 slot ceilings).

| testid | element | notes |
|---|---|---|
| `trip-story-recap` | the page's root `<section>`/`<div>` | Present in all three states (loading skeleton, locked, full story); the stable "island mounted" signal for E2E waits. |
| `trip-story-locked` | the "unlocks after the trip" panel `<div>` | Rendered only when `isPostTrip(now)` is false (pre-trip or in-trip), with no per-day content at all. |
| `story-trip-summary` | the opening trip-level summary `<p>` | Post-trip only: total activities done/planned, spend by leg, days journaled. |
| `story-day-<date>` | each day's story `<article>` | Post-trip only, one per trip date, chronological (Dec 9 -> Jan 9, oldest-first, the opposite of the home card's most-recent-first). |
| `story-plan-summary-<date>` | the day's "N of M done" `<p>` | Present only when that day has ≥1 planned item. |
| `story-no-plan-<date>` | the "free day" `<p>` | Present only when that day has 0 planned items. |
| `story-plan-<date>` / `story-plan-item` | the day's plan `<ul>` / each item `<li>` | `data-done="true"/"false"` on each item, mirroring `recap-plan-item` (section 20). |
| `story-journal-<date>` | the day's reflection block `<div>` | Present only when that day has a journal entry. |
| `story-journal-mood-<date>` / `story-journal-highlight-<date>` / `story-journal-body-<date>` | mood pill / highlight / body text | Same shape as `recap-journal-*` (section 20), present only when that field exists on the entry. |
| `story-spend-<date>` | the day's spend `<p>` | Present only when that day has >0 logged spend, formatted leg-local (mirrors `recap-spend-<date>`, section 25). |
| `story-photos-<date>` | the day's read-only journal-photo thumbnail strip `<div>` | S161. Present only when that day has ≥1 journal photo (`usePhotos().photosFor({kind:'journal',date})`, a pure filter, D-159). Rendered after the journal reflection block, before the spend line. No strip at all on a photo-less day (no empty box), mirroring `story-journal-<date>`/`story-spend-<date>`'s presence gating. |
| `story-photo-<id>` | each thumbnail `<li>` | `<id>` = the photo's own `PhotoMeta.id`. `alt` on the `<img>` is always `PhotoMeta.altText` (never empty by construction, since it is required at capture); the caption, if present, shows as an overlay label. `data-missing="true"` when the blob was evicted or absent (`BlobStorePort.get`→null), which renders the S160 placeholder tile (alt/caption preserved via `title`) instead of a broken `<img>`; `"false"` otherwise. Read-only: no delete/edit control (D-018, that's the journal's job via `photo-attach.tsx`, near section 19). |

Reduced motion: the app-wide `<MotionConfig reducedMotion="user">` auto-neutralizes the
per-day `m.article` scroll-reveal, so no manual guard is needed. Heading hierarchy nests under the page's
own `<h1>` ("Trip Story"): the trip summary is an `h2`, each day is an `h3`. The photo strip's
own object-URL resolution (`usePhotoObjectUrl`, `hooks/use-photo-object-url.ts`) is the same
blob→objectURL→revoke idiom `photo-attach.tsx`'s `PhotoThumb` uses (S160), extracted to a shared
hook in S161 so neither surface duplicates the lifecycle.

## 28. Map trip-mode + favorites: `components/map-section.tsx` + `components/trip-map.tsx` (route: `/map`), S151 (D-158) + FU-34 (D-157)

| testid / attr | element | notes |
|---|---|---|
| `map-search-toggle` | the search icon button | Opens the search-within-map panel (S151). |
| `map-search-panel` | the search panel container | Present only when the search toggle is open. |
| `map-search-input` | the search `<input>` | Client-side filter over marker titles. |
| `map-search-results` | the results `<ul>` | Keyboard-navigable list. |
| `map-search-result-<marker-id>` | each result `<li>`/button | Select → resets category filter to `'All'`, flies + opens popup (`focusMarker`). |
| `map-popup-directions` | the Directions link in a marker popup | `href` = `buildMapsDirectionsUrl(lat,lng)`, destination-only (D-074/D-158); `target`/`rel` set. |
| `map-route-caveat` | the "schematic line, not a route" caption | Present only when the day overlay is on. Issue #1: while a day is selected it also opens with "Showing Day N only — tap that day again for the whole trip", because scoping the route hides the other days and a map that quietly shows less than the user expects is D-271's defect class in reverse. |
| `map-popup-favorite-<id>` | the favorite heart in a marker popup | FU-34; prop-gated `enablePopupFavorite` → `/map` only, never `/plan` day-map. `aria-pressed`. |
| `map-filter-saved` | the "Saved" filter chip | Absent@0 favorites, appears@≥1; ANDs the category filter (D-157). |
| `map-offline-hint` | the offline stale-tile hint | Present only when `useOnline()` is false. |
| `data-visible-count` | attr on `map-shell` | Reflects the count of markers after search + category + Saved filters. |

## 29. Search-within-plan: `components/plan-search.tsx` + `components/command-palette.tsx` (route: `/plan`), S147 (D-161)

| testid | element | notes |
|---|---|---|
| `plan-search-input` | the `/plan` search combobox input | Filters items by title>notes>category (substring). |
| `plan-search-clear` | clear button | Resets the query. |
| `plan-search-results` | results listbox | |
| `plan-search-empty` | empty-state | Shown when the query matches nothing. |
| `plan-search-result-<id>` | each result option | Select → jumps to the item's day + highlights it. |
| `palette-plan-result-<id>` | palette "In your plan" result | Hands off via `?focus=<id>` (D-161). |

## 30. Multi-day item spans: `components/calendar-planner.tsx` (route: `/plan`), S148 (D-162)

| testid | element | notes |
|---|---|---|
| `calendar-editor-span-toggle` | the "spans multiple days" toggle in ItemEditor | Opt-in; reveals the end-date select. |
| `calendar-editor-span-select` | end-date `<select>` | Sets the additive `endDate?` (absolute ISO). |
| `calendar-span-bands` | the span-band overlay container | Pure render derivation across covered days. |

## 31. Settings: `components/settings-panel.tsx` (route: `/settings`), S146

The `/settings` island (ssr:false, D-131): three collapsible `<details>` groups. Identity (name +
sign-out), Currency & rates (the `budget-currency-*` / `budget-rate-*` toggle + rate overrides
relocated from `budget-panel.tsx`, with the same testids and an unchanged `use-budget` write path so
S143 sync is unaffected), and Data management (the reused `backup-restore` panel + per-domain clears
behind Radix `AlertDialog` confirms). There is no notifications group (D-130 declined).

| testid | element | notes |
|---|---|---|
| `settings-panel` | the `<section>` root | Visibility is the E2E "panel is up" signal. |
| `settings-group-identity` / `settings-group-currency` / `settings-group-data` | each `<details>` group | `-toggle` suffix = its `<summary>` disclosure button (≥44px, keyboard-toggled). Identity is open by default. |
| `settings-identity-name` | the signed-in name `<p aria-live>` | The active traveler's name, or "Not signed in" as a defensive fallback; with no guest mode (D-241) this page is unreachable without a traveler in practice (`settings-panel.tsx`). |
| `settings-sign-out` | the Sign out `<button>` (trigger) | S352 (D-249): sign-out is now a full local teardown (`wipeAllTripData()`) covering every trip-scoped domain in both namespaces plus `activeTrip`/`knownTrips`/`removedTrips`/`syncCode`/`travelMode`, including the User Token (key 28; this supersedes the old "stays on disk, lockout-safe" D-239 claim). Confirm-gated via the shared `<SignOutConfirm>` (`components/sign-out-confirm.tsx`), reused verbatim at the navbar desktop chip (`navbar-sign-out`) and the mobile `/more/` row (`more-sign-out`). |
| `settings-sign-out-dialog` / `-cancel` / `-confirm` / `-backup` | the shared sign-out confirm dialog | `-confirm` runs `signOut()` then reloads (Ruling 3); `-backup` calls the extracted `downloadTripBackup()` and stays open (Ruling 2: an offer, not a forced step). Same 4 suffixes at `navbar-sign-out-*` and `more-sign-out-*`. |
| `settings-forget-device` / `-dialog` / `-cancel` / `-confirm` / `-backup` | the "Forget this device" `<button>` + its confirm dialog | Settings-only, strictly more destructive than plain sign-out: does everything sign-out does and clears every locally-stored photo blob (`defaultBlobStore.clear()`, IndexedDB). |
| `budget-currency-toggle` / `budget-currency-{usd,npr,jpy}` / `budget-rate-{npr,jpy}` / `budget-rate-reset` | the relocated currency toggle + rate inputs | Identical semantics to the former section 16 rows; now under `/settings` Currency & rates. |
| `settings-clear-{itinerary,expenses,budget,journal}` | each destructive "Clear" trigger `<button>` | Opens its `AlertDialog` confirm. |
| `settings-clear-<domain>-dialog` / `-confirm` / `-cancel` | the confirm dialog + its two actions | `-confirm` runs the domain's clear (itinerary `clearAll`, expenses `clearAll`, budget `reset`, journal `clearAll`, all local only per D-152); `-cancel` leaves data intact. Under sync each clear propagates (tombstone/LWW); dormant is a plain local wipe (D-038). |
| `calendar-span-band-<id>` | each covered-day band for the spanning item | Item stays homed on its start day only (never multi-homed). |

## S158: expense CSV export + Home section nav

| Testid | Element | Notes |
|---|---|---|
| `settings-export-expenses-csv` | the "Export expenses (CSV)" `<button>` in the settings Data-management group | Blob/`URL.createObjectURL` download (`nepal-japan-expenses.csv`); disabled + empty-safe when no expenses. Read-only over `useExpenses` (`lib/expense-csv.ts`). |
| `home-section-nav` | the Home in-page sticky section `<nav>` | `position:sticky` under the navbar; real `<a href="#id">` anchors, keyboard-focusable, smooth-scroll via the global `html{scroll-behavior}` (reduced-motion-neutralized, D-007). |
| `home-section-nav-{hero,dashboard,timeline,inspiration}` | each section jump link | `aria-current="true"` tracks the section in the reading band via a small `IntersectionObserver` (D-088, no scroll-spy dependency). |

## S155: first-run guided tour, `components/first-run-tour.tsx` (all routes, mounted at app root)

A one-time, ≤5-step centered coach-mark stepper (Today · Plan · Budget · Journal · Map) shown
exactly once past the TokenGate (gateway key 17, `tourStore`). Mounted as a sibling of
`<TokenGate />` in `itinerary-provider.tsx`; "gate passed" mirrors TokenGate's own resolved
"wall is down" condition exactly: `!!traveler`. With no guest mode (D-241) there is no partial
access to fall back to, and every other case still shows the wall.

| Testid | Element | Notes |
|---|---|---|
| `tour-dialog` | the panel `<m.div role="dialog">` | Only mounted while unseen and the gate has resolved (post-`mounted`). z-[65]. |
| `tour-skip` | the header "X" close `<button aria-label="Skip tour">` | The dialog's sole Skip control (focused on open); calls `markTourSeen()` and closes at any step. |
| `tour-progress` | the "Step N of 5" `<p aria-live="polite">` | Announces step changes to assistive tech; the accessible source of the step count (the dot row below is `aria-hidden`). |
| `tour-desc` | the current stop's blurb `<p>` | `aria-describedby` target. |
| `tour-back` | the "Back" `<button>` | `disabled` on step 1. |
| `tour-next` | the "Next" / "Let's go" `<button>` | On the last step this also calls `markTourSeen()` and closes (finishing the tour is equivalent to Skip for the exactly-once guarantee). |

The stop title (`<h2>`, `aria-labelledby` target) renders the destination label ("Today" /
"Plan" / "Budget" / "Journal" / "Map") directly, with no separate testid; it is asserted via
`getByRole('heading', { name: ... })` in `e2e/first-run-tour.spec.ts`. The progress dots are
decorative (`aria-hidden`), not tagged.

## 32. Travel Mode: `app/travel/page.tsx` (route: `/travel`), S184 (D-164)

The chrome-free Travel Mode route shell (Phase-2 opener). The six chrome-islands
(navbar / footer / bottom-tab-bar / quick-add-fab / quick-add-host / expense-log-host) each
render `null` under `/travel` via `lib/travel-route.ts` `isTravelRoute(pathname)`, so this
surface has no app chrome; assert their absence (`toHaveCount(0)`) as the "chrome-free"
signal. `CommandPalette` / `OfflineBanner` / `ServiceWorkerRegistrar` stay mounted (not chrome
per the six-island definition). This slice is the shell only: the hero card, agenda, `?date=`
picking, essentials, legibility toggle, and enter/exit affordances are S185–S190.

| testid | element | notes |
|---|---|---|
| `travel-mode-root` | the TM root `<main>` container | Always present on `/travel`; its visibility is the E2E "TM shell is up" signal. Carries the `.travel-mode-root` safe-area and hardening CSS (globals.css). The page `<h1>` "Travel Mode" nests under it (asserted via `getByRole('heading', { level: 1, name: 'Travel Mode' })`). |

The `.tm-thumb-zone` bottom band is a documented CSS contract (no interactive children in S184,
so `:empty` collapses it to `display:none`, giving zero visual box). It gets a testid once S190
places the first primary action in it.

## 33. Travel Mode, Now/Next hero card: `components/travel-hero-card.tsx` (route: `/travel`), S185 (D-016 / D-131 / D-007)

The top-of-`/travel` Now/Next card. A client island (mounted `ssr:false` via `app/travel/sections.tsx`,
D-131) whose phase is derived by the pure `deriveTravelHero` (`lib/travel-hero.ts`, D-016) from the
day-in-trip's itinerary + the injected clock (`getNowUtcMsForPlace`, incl. the `?today=` D-075
override). `data-phase` on the root carries the machine's phase: `now` | `upcoming` | `done` |
`untimed` | `empty` | `off-trip`. The flip is reduced-motion gated at the React level (D-007): under
`prefers-reduced-motion` the `travel-hero-flip` container renders the plain, spring-free branch
(`data-flip-animated="false"`) so a state change is an instant swap.

| testid / attribute | element | notes |
|---|---|---|
| `travel-hero` | the card `<section>` | Always present once hydrated (replaces `travel-hero-skeleton`). `data-phase` = the derived phase (see above), the E2E "which state is showing" signal. |
| `travel-hero-skeleton` | the pre-hydration placeholder `<div>` | `aria-hidden`; reserves height to avoid a mount CLS shift. Replaced by `travel-hero` once the store hydrates. |
| `travel-hero-flip` | the flip container wrapping the phase body | `data-flip-animated` = `"true"` (framer spring) / `"false"` (reduced-motion plain branch, D-007). |
| `travel-hero-headline` | the current-or-next activity title `<p>` | Present in `now` / `upcoming`. The item shown is the current activity (`now`) else the next (`upcoming`). |
| `travel-hero-expand` | the compact header `<button>` | The tap-to-expand toggle (keyboard-operable; `aria-expanded` + `aria-controls="travel-hero-details"`). Present in `now` / `upcoming`. |
| `travel-hero-details` | the expanded details region `<div>` | `id="travel-hero-details"`; rendered only while expanded. Category / notes and, in `now`, the "then" line. |
| `travel-hero-then` | the "Then: …" next-up line inside the details | Present only in `now` when a next item exists and details are expanded. |
| `travel-hero-progress` | the elapsed progress bar (`role="progressbar"`) | Present only in `now`. `aria-valuenow` = `data-progress` = `round(progress*100)` (0–100). Fill width is CSS, reduced-motion-neutralised app-wide. |
| `travel-hero-progress-wrap` | the progress bar + labels wrapper | Present only in `now`. |
| `travel-hero-recalc` | the manual "Recalculate" `<button>` | ≥44px target; re-reads the clock and re-derives (backgrounded-tab stale fix). Present in `now` / `upcoming` / `done`. |
| `travel-hero-empty` | the empty-day state `<div>` | Phase `empty`: no items; mirrors the today-panel empty state plus the "Open the planner" link. |
| `travel-hero-untimed` | the all-untimed state `<div>` | Phase `untimed`: items exist but none carry a time. |
| `travel-hero-done` | the day-complete state `<div>` | Phase `done`: every timed item is done/past. |
| `travel-hero-offtrip` | the off-trip copy `<p>` | Phase `off-trip`: the clock is outside Dec 9 – Jan 9 (portfolio / pre-/post-trip). |

## 34. Travel Mode, agenda: `components/travel-agenda-card.tsx` + `components/trip-agenda.tsx` (route: `/travel`), S186

The full day list under the S185 hero. A client island (`ssr:false` via `app/travel/sections.tsx`)
that injects the clock and delegates to the shared `TripAgenda` (`variant="travel"`), the same
list component the Today panel renders (`variant="today"`, its markup byte-unchanged). Per-row phase
is derived by `deriveRowPhases` (`lib/travel-hero.ts`, the same machine the hero uses). The done
toggle calls the existing `updateItem(date, id, {done})`, the same store mutation as the Today
panel, so a TM toggle reflects on `/` and survives reload (D-018). Rows are ≥48px min-height.

| testid / attribute | element | notes |
|---|---|---|
| `travel-agenda` | the agenda `<section>` | Present once hydrated on an in-trip day with items (replaces `travel-agenda-skeleton`). Absent off-trip (the hero card owns the off-trip state) and on a zero-item day (the empty state renders instead). |
| `travel-agenda-skeleton` | the pre-hydration placeholder `<div>` | `aria-hidden`; reserves height to avoid a mount CLS shift. |
| `travel-agenda-empty` | the empty-day state `<div>` | Rendered on a zero-item in-trip day; carries an "Open the planner" link. Mutually exclusive with the row `<ul>`. |
| `travel-agenda-item` | the item title `<span>` inside each row | One per item, a read/count hook; the interactive control is the parent toggle. |
| `travel-done-toggle-<itemId>` | the whole agenda-row `<button>` (the done toggle) | One per item; `<itemId>` = the item's stable `id`. `aria-pressed` reflects done state; `min-height:48px`; keyboard-operable. `data-row-phase` = `now` \| `upcoming` \| `past` \| `done` \| `untimed` (from `deriveRowPhases`). Clicking calls `updateItem(date, id, {done})`, the same mutation the Today panel's `today-done-toggle-<id>` uses (they reflect on each other, D-018). |

## 35. Travel Mode, `?date=` day picking: `components/travel-date-picker.tsx` + `components/travel-day-strip.tsx` (route: `/travel`), S187 (D-164)

The selection layer above the S185 hero + S186 agenda. Owns `?date=YYYY-MM-DD` (bounded Dec 9 –
Jan 9, via `useSearchParams`, the S147/D-161 in-place-reactive pattern) and reuses the existing
mobile `day-strip.tsx` (via the thin `TravelDayStrip` wrapper) to pick a day. Bounds and default
resolution are the pure `resolveTravelDate` (`lib/travel-date.ts`). Composes with `?today=` per
D-164: `?date=` picks the day, `?today=` still drives the clock/phases; with no `?date=`, the
default follows the `?today=`-simulated day when on-trip, else Day 1 pre-trip.

| testid / attribute | element | notes |
|---|---|---|
| `travel-date-skeleton` | the pre-hydration placeholder `<div>` | `aria-hidden`; reserves height before the store hydrates. |
| `day-strip` / `day-strip-<date>` | the reused strip + its per-day chips | Same component and testids as `/plan`'s mobile strip (`components/day-strip.tsx`), not forked. `aria-pressed` marks the selected chip; a `Today` pill marks the live (possibly `?today=`-simulated) trip day. |
| `travel-pretrip-notice` | the "Trip starts in N days" `<p>` | Shown only when there is no `?date=` and the clock is pre-trip (Day 1 is the forced default). |
| `travel-preview-banner` | the non-today preview banner `<div>` | Shown when the selected day ≠ the live trip day (a deliberate `?date=` preview). Carries the "Back to today" action. |
| `travel-preview-back` | the "Back to today" `<button>` inside the banner | Clears `?date=` (preserves every other param, incl. `?today=`) via `router.replace`. |
| `travel-date-empty` | the "not a trip day" `<section>` | Rendered when `?date=` is present but malformed or outside Dec 9 – Jan 9. Never a crash or a silent clamp. |
| `travel-date-empty-return` | the one-tap return `<button>` inside the empty state | Same clear-`?date=` action as `travel-preview-back`. |

## 36. Travel Mode, Essentials block: `components/travel-essentials-card.tsx` (route: `/travel`), S188

Mounts below the S186 agenda as its own lazy island (`next/dynamic(ssr:false)` inside
`components/travel-date-picker.tsx`), following the same resolved `?date=` the hero and agenda use.
Four panels: leg-correct weather (`fetchWeather`, reuses `weatherCache`, no new fetch path),
a live USD→leg-currency rate (`lib/currency-rate.ts`, new), a compact safety/emergency-numbers
subset (`core/content/safety.ts`), and, only on the trip's four travel days (Dec 9, Dec 18,
Dec 19, Jan 9), the confirmed flight(s) for that day with FlightRadar24 tracker + Rome2Rio/
Google-Flights deep-links (`lib/flight-deep-links.ts`, D-169). Also acquires the Screen Wake
Lock (`lib/use-wake-lock.ts`) while mounted.

| testid | element | notes |
|---|---|---|
| `travel-essentials` | the block `<section>` | Present whenever `/travel` has a resolved day (mirrors hero/agenda's mount condition). |
| `travel-wake-lock-hint` | the "Screen stays awake…" `<p>` | Present only when Wake Lock is supported and currently held. Absent everywhere the API is unsupported (no error either way). |
| `travel-essentials-weather` | the weather panel `<div>` | Header reads "Weather — `<city>`" for the resolved day's leg. |
| `travel-essentials-weather-loading` / `-stale` / `-unavailable` | state markers inside the weather panel | `-loading` before the first fetch settles; `-stale` when the rendered value came from cache; `-unavailable` when there's no cache and the fetch failed. |
| `travel-essentials-currency` | the currency panel `<div>` | Shows "1 USD = `<rate>` `<currency>`" (NPR for the Nepal leg, JPY for Japan). |
| `travel-essentials-currency-loading` / `-asof` / `-unavailable` | state markers inside the currency panel | `-asof` holds the Frankfurter `date` + a "(cached)" suffix when stale. `-unavailable` covers both a failed fetch with no cache and currencies Frankfurter is confirmed not to carry (NPR; see `lib/currency-rate.ts`, where the fetch for those is skipped entirely, never issued). |
| `travel-essentials-safety` | the safety panel `<div>` | Header reads "Emergency — `<Nepal\|Japan>`" for the resolved leg. |
| `travel-essentials-safety-<contactId>` | one `tel:` link per shown contact (≤3) | Same `tel:`/`aria-label` pattern as `/safety`'s `safety-contact-<id>` (S152), namespaced to avoid a duplicate-id collision on the same page. |
| `travel-essentials-safety-link` | the "Full safety kit & phrasebook" `<Link>` | Routes to `/safety/` for the rest. |
| `travel-essentials-flights` | the flight-card list wrapper `<div>` | Present only on the 4 travel days (Dec 9 / Dec 18 / Dec 19 / Jan 9); absent every other day. |
| `travel-essentials-flight-<journeyId>` | one card per confirmed `Journey` (`lib/booking-data.ts`) that day | Dec 19 renders two (`return-to-japan` + `tokyo-to-osaka`: the arrival and the same-day domestic hop). |
| `travel-essentials-tracker-<legId>` | the FlightRadar24 "Track flight" `<a>` per flight leg | `target="_blank" rel="noopener noreferrer"`; absent when the airline isn't in the bounded IATA map (never a guessed link). |
| `travel-essentials-rome2rio-<journeyId>` / `travel-essentials-gflights-<journeyId>` | the two route-level deep-links per journey card | Byte-exact hrefs built by `lib/flight-deep-links.ts` from the journey's `fromSummary`/`toSummary`; `target="_blank" rel="noopener noreferrer"`. |

## 37. Travel Mode, outdoor high-legibility toggle: `components/travel-legibility-toggle.tsx` (route: `/travel`), S189

D-165's TM-local substitute for a site-wide light mode. Mounted directly in `app/travel/page.tsx`'s
header row (next to the "Travel Mode" `<h1>`), a plain (non-lazy) client component with no
`useSearchParams`, so it needs no `ssr:false` boundary. Persists via the gateway's `legibilityPrefs`
(key 18). On, it stamps `html[data-tm-legibility="high"]`, which `app/globals.css` uses to re-value
the D-177 semantic surface tokens, raise every `text-white/*` utility's computed color, and bump the
root font-size 12.5%. All of that is Travel-Mode-local: the attribute is removed on toggle-off and
unconditionally on unmount (route leave), so it can never leak onto another route.

| testid | element | notes |
|---|---|---|
| `travel-legibility-toggle` | the toggle `<button>` | `aria-pressed` reflects the persisted/current state; ≥44×44px hit target; label "High legibility" (icon-only below `sm:`). |

## 38. Travel Mode, enter/exit affordances: `components/navbar.tsx` · `components/hero-section.tsx` · `components/travel-exit-button.tsx` · `components/travel-arrival-toast.tsx` (route: `/travel` + app-wide), S190 (D-164 / D-194)

The four entry surfaces plus the exit. Entry (nav button / hero CTA / in-trip card / toast
"Open") records the origin route (`travelReturn`, session key 20) and arms the `travelMode` gateway
flag (`travelModeGate`, local key 19, 3-state `absent→seen→active`), then pushes `/travel/`. The exit
X `router.replace`s the remembered route (or `/` on a cold start) after downgrading the flag to
`'seen'`; it is a replace so browser Back never traps back into `/travel`. With no guest mode
(D-241), every caller of the entry hook is already an identified traveler (TokenGate's wall blocks
everyone else), so the flag is armed and the return route recorded unconditionally. The arrival
toast shows exactly once per device, on-trip only, until entered or dismissed.

| testid | element | notes |
|---|---|---|
| `navbar-travel-mode` | the persistent Travel Mode entry `<button>` in the nav chrome | On every page and trip phase, at both widths (not behind the hamburger); ≥44px; `aria-label="Enter Travel Mode"`, label "Travel Mode" collapses to icon-only below `sm:`. Sits inside the navbar bar (z-50), always above the S229 sync pill (fixed `top-20`, z-40). Absent on `/travel` (navbar renders null there). |
| `hero-travel-entry` | removed in S321 | The Home hero collapsed to one state-aware CTA (pre/post-trip → "Open Planner" link → `/plan/`; in-trip → the in-trip card's Travel Mode button below). The always-present hero Travel Mode button is gone; Travel Mode entry pre-trip is the persistent `navbar-travel-mode` button. |
| `home-intrip-travel-card` | the on-trip hero panel action row `<div>` | Only rendered inside the trip window (`todayInTrip` non-null); this is the in-trip "card", hidden off-trip. S321 reduced it to a single button (it was two, and "Open today's plan" was dropped). |
| `home-intrip-travel` | the "Open Travel Mode" `<button>` inside the in-trip card | On-trip only. S321: now the in-trip card's sole action. |
| `travel-exit` | the exit X `<button>` inside `/travel` | ≥44×44px; `aria-label="Exit Travel Mode"`; mirrors the shared dialog-close idiom (S157). Restores the prior route with no history trap. Lazy `ssr:false` island (sections.tsx), same as the legibility toggle. |
| `travel-arrival-toast` | the arrival auto-suggest toast `<div role="region">` | App-wide, on-trip only, exactly-once. Bottom-center above the mobile tab bar; `m.*` reveal auto-neutralized under reduced motion. |
| `travel-arrival-enter` | the toast "Open" `<button>` | ≥44px; enters Travel Mode (also marks the toast seen). |
| `travel-arrival-dismiss` | the toast dismiss X `<button>` | ≥44×44px; `aria-label="Dismiss Travel Mode suggestion"`; persists `'seen'` → never shown again. |

## Existing testid (unchanged)

- `scroll-progress` in `components/scroll-progress.tsx`, the fixed top scroll
  progress bar. Present on every route. Not touched by this pass.

## S214: `data-scroll-driven` marker, `components/reveal.tsx` (`<Reveal>`, all content routes)

Not a `data-testid` but a state/marker attribute, the same idiom `scroll-progress.tsx`'s
`data-scroll-driven` already uses (see the "Existing testid" entry above). S214 extends
S180's dual-path scroll-driven-CSS pattern from the page-progress bar to `<Reveal>`, the
section-entrance slide-in used by `SectionHeading` and ~12 content-route consumers
(Nepal/Japan guides, photography guide, nightlife, country-essentials, budget panel,
flights, trip-timeline, trip-dashboard, trip-recap, trip-story-recap). This is internals
only: `<Reveal>`'s external API (`children`, `className`) and visual output are unchanged.

| attribute | element | notes |
|---|---|---|
| `data-scroll-driven="css"` | the `<Reveal>` wrapper `<div class="reveal-view-css">` | Chromium (or any engine matching `@supports (animation-timeline: view())`) and not under `prefers-reduced-motion`. Driven by the `reveal-view-in` keyframe on an element view timeline (`animation-timeline: view()` + `animation-range: entry 0% cover 30%`, `app/globals.css`), so zero JS runs per scroll frame. |
| `data-scroll-driven="js"` | the `<Reveal>` wrapper `<m.div>` | Firefox/Safari (no `animation-timeline: view()` support), or always under `prefers-reduced-motion` (the CSS element is never rendered there, per D-007/D-056, mirroring `scroll-progress.tsx`). The original framer `whileInView`/`viewport:{once:true}` entrance, byte-identical to pre-S214. |

Covered by `e2e/reveal.spec.ts` (content renders/reveals correctly on `/nepal/` + `/japan/`
incl. the embedded photography guide section, the CSS path is proven live via this
attribute + `animationName`, and reduced motion proves the CSS path never renders) and the
component-level suite `lib/__tests__/reveal-css-path.test.ts` /
`lib/__tests__/reveal-reduced-motion.test.ts`.

## S200: Google sign-in group, `components/settings-panel.tsx` (route: `/settings`)

A fourth `/settings` group (D-168 is locked: sign-in only, no sign-out flow, no accounts system).
Gives each traveler a stable Firestore auth uid that survives storage clears and device swaps.
The group is entirely absent (not just empty) when dormant
(`!isRemoteConfigured()`) or before a traveler is signed in, mirroring the
`isRemoteConfigured() && getActiveTraveler()` dormant/guest gate at `hooks/use-presence.ts:85`.

| Testid | Element | Notes |
|---|---|---|
| `settings-group-google` | the `<details>` group (+ `-toggle` for its summary) | Absent entirely when dormant/no-traveler; present + expandable once remote-configured and a traveler is signed in. |
| `settings-google-signin` | the "Sign in with Google" `<button>` | Shown while the Firebase identity is still anonymous (or not yet resolved). `signInWithPopup` → success reloads the page; failure surfaces `settings-google-error` and leaves the button re-clickable. |
| `settings-google-error` | the inline `<p role="alert">` sign-in failure message | Only rendered after a failed popup attempt (blocked/closed/offline, an expected path rather than an exceptional one). |
| `settings-google-signed-in` | the "Signed in as `<name or email>`" `<p>` | Shown once the Firebase identity is a Google account. No sign-out control (D-168 puts it out of scope). |

## S229: Sync-status badge, `components/sync-status-badge.tsx` (app-wide, all routes, mounted in `app/layout.tsx`)

A passive, live pill over the offline-push outbox (`core/sync/outbox.ts`, S141/D-150) reporting a
pending-chunk count or a calm "synced Xm ago" resting state (`hooks/use-sync-status.ts`). Fixed
top-right, below the navbar (`OfflineBanner` owns top-center, `PresenceBar` bottom-left, the
mobile FAB/Sonner toasts bottom-right). Entirely absent, not just empty, when dormant
(`!isRemoteConfigured()`) or before a traveler is signed in (mirrors the
`isRemoteConfigured() && getActiveTraveler()` gate used at `hooks/use-presence.ts:85` /
`settings-group-google` above), and when nothing has ever synced yet (`pending===0 &&
lastAckAt===null`).

| Testid | Element | Notes |
|---|---|---|
| `sync-status-badge` | the pill's root `<div role="status" aria-live="polite">` | Absent (not just empty) when dormant/guest, or when `pending===0 && lastAckAt===null`. `data-state` is `"pending"` \| `"synced"`. |
| `sync-status-text` | the visible label `<span>` inside the pill | `"N pending"` while `pending>0`; `"Synced {relative}"` (via `lib/relative-time.ts`'s `formatRelativeTime`) once `pending===0 && lastAckAt!==null`. |

## S224: Map-linked itinerary editing, `components/trip-map.tsx` + `components/map-section.tsx` (route: `/map`)

Assign a map pin to a trip day so that day's stops re-order by client-side haversine
distance from the pin (the anchor). No routing API (D-003/D-079 free-tools-only). The
assigned pin rides the existing itinerary CRUD (`addItem`, the one synced write, D-088);
the anchor is local only (gateway key 22 `dayAnchors`, D-149) and the reorder is a derived
view. Three equivalent affordances: the popup day `<select>` plus Anchor button (keyboard and
touch), and a desktop-pointer drag handle (drops onto the day strip; manually verified, since
HTML5 DnD never fires on touch, which makes the select the a11y-floor equivalent).

Popup controls (gated by `enableDayAssign`, so `/plan`'s day-map, which omits it, never
renders them; parallel to `enablePopupFavorite`):

| Testid | Element | Notes |
|---|---|---|
| `map-popup-assign-{markerId}` | the "Anchor a day around this pin" `<div>` in the popup | Present only on `/map`. |
| `map-popup-assign-select-{markerId}` | the trip-day `<select>` | Options are "Day N · Wed, Dec 10" per `TRIP_DATES`. |
| `map-popup-assign-confirm-{markerId}` | the "Anchor" `<button>` | Calls `onAssignDay(marker, date)` → adds the pin to the day + sets it as the day's anchor. |
| `map-popup-drag-{markerId}` | the pointer-drag grip `<span draggable>` | `aria-hidden` (the select is its keyboard/touch equivalent); `hidden sm:grid` (desktop only). Carries the marker id via the `application/x-njp-marker-id` DnD type. |

Day-target strip + ordered-stop panel (`map-section.tsx`):

| Testid | Element | Notes |
|---|---|---|
| `map-day-strip` | the day-strip `<div>` (label "Pick a day, or plan one around a pin") | One chip per trip day: a day selector AND a pin drop target. |
| `map-day-target-{dateISO}` | a day chip `<button>` (day selector + drop target) | `data-anchored` (`"true"`/`"false"`), `data-stop-count` = the day's total planned items (S380; it used to be mapped-stops-only, so a day holding 3 plans the join could not place read `0`), `data-mapped-count` = how many of them are exactly placed (S381/D-279, since "mapped" is now every item and that count could no longer fail), `aria-pressed` (this day is selected). Issue #1: activating it now SCOPES THE MAP to that day — it opens the day panel, turns the itinerary overlay on (the pins are drawn by the overlay, so without that the gesture answers with an empty canvas from a cold load) and sets `map-shell`'s `data-route-day`. Activating the selected chip again deselects it and the whole trip comes back; the overlay is left on. |
| `map-day-order` | the day panel `<div>` for the selected day | `data-anchored` reflects whether that day has an anchor. S381/D-281: rows are always in time order. The anchor is the day's base point, supplying the per-row distance label, and no longer re-orders anything. |
| `map-day-order-empty` | the panel's empty-state `<p>` | Only one honest empty case is left (S381): "Nothing planned for this day yet — drop a pin here to start." Under D-278 every plan has a position, so the old "none of this day's N items have a map location yet" branch was deleted as false. |
| `map-day-order-stop-{itemId}` | one plan row inside its `<li>`, in time order | S381 keys this by the item id, not the marker id, because two plans can share a marker, which duplicated both the React key and this testid. It is a `<button>` when the plan has a position: Click/Enter/Space flies the map to that plan's pin (resets the filter to All, turns the overlay on), and several plans at one coordinate share one pin. Carries `data-placement` (`exact`/`approximate`/`none`), `data-via` (`pin`/`source`/`name`/`area`/`city`), `data-marker-id`, `data-derived-from`. An approximate row is marked by shape (hollow ring) plus text ("≈ <derivedFrom>"), never colour alone (D-279). |
| `map-day-order-locate-{itemId}` | the "No location yet — set one" link on a `kind:'none'` row (S381) | Custom trips only (a `city` outside the one city table). Goes to `/plan/` and its S357B pin picker; that row is a `<div>`, not a fly-to button, because there is nowhere to fly. |

S218 added polish-bundle micro-celebration bursts (`components/celebration-burst.tsx`), `aria-hidden`
and decorative only (no a11y role), absent entirely under `prefers-reduced-motion`:

| Testid | Element | Notes |
|---|---|---|
| `hero-arrival-celebration` | the burst inside the hero's "You're on the trip" panel | Fires once on the countdown-reaches-zero / arrival edge (`components/hero-section.tsx`). |
| `packing-celebration` | the burst inside the packing checklist section | Fires once when the last packing item is checked off (`components/packing-checklist.tsx`). |

S220 added the share-target inbox (`/share`, `components/share-inbox.tsx`): the OS `share_target`
receiver and triage inbox. `{id}` is the generated item id (`share-<uuid>`).

| Testid | Element | Notes |
|---|---|---|
| `share-inbox` | the inbox `<section>` | Present on `/share` once the island hydrates (also wraps the pre-hydration "Loading…" state). |
| `share-empty` | the designed empty-state `<div>` | Shown when the inbox is empty ("Nothing shared yet"). |
| `share-item-{id}` | one inbox row `<li>`, newest-first | Filter rows with `li[data-testid^="share-item-"]` (the delete/day/link testids share the prefix). |
| `share-item-link-{id}` | the linkified url `<a>` | Present only for an `http(s)` url; carries `target="_blank"` + `rel="noopener noreferrer"`. |
| `share-item-day-{id}` | the trip-day `<select>` | Options: "Unassigned" + one per `TRIP_DATES` ("Day N · Wed, Dec 10"). Value is the `YYYY-MM-DD` day or `''`. |
| `share-item-delete-{id}` | the delete `<button>` | Removes the row; the last delete reveals `share-empty`. |

S256 added the desktop "More" disclosure (`components/navbar.tsx`): a hand-rolled dropdown after
the 6 primary desktop links (`hidden md:flex` cluster only, never below `md`; D-071 mobile chrome
untouched). Lists the active trip's companion routes (`navItemsForActiveTrip()` minus the
primary seats) plus a Search row that dispatches the `palette:open` window CustomEvent
(listener in `components/command-palette.tsx`).

| Testid | Element | Notes |
|---|---|---|
| `navbar-more-toggle` | the "More ▾" trigger `<button>` | `aria-expanded`/`aria-controls="navbar-more-menu"`/`aria-haspopup`. Escape/outside-click close returns focus here (D-021). Hidden below `md` (its whole cluster is `hidden md:flex`). |
| `navbar-more-menu` | the dropdown panel `<div role="menu">` | Mounted only while open. Plain tab order inside (no roving tabindex, matching the mobile panel). |
| `navbar-more-link-{label}` | each companion `<Link role="menuitem">` | `{label}` = `item.label.toLowerCase()` (default trip: `journal`/`safety`/`recap`/`packing`/`trips`/`settings`). Active route gets `aria-current="page"`. |
| `navbar-more-search` | the "Search ⌘K / Ctrl+K" row `<button role="menuitem">` | Closes the menu (focus → toggle) then dispatches `palette:open`; the palette opens as a second, clean action. |

## 39. Flights, Flighty-anatomy journey card + "Check live status" rail: `components/flight-journey-card.tsx` (route: `/flights`), S325 / S326

The `/flights` journey list renders one standalone `FlightJourneyCard` per `JOURNEYS` member
(S326, D-233): phase strip → big route → verbatim times → proximity countdown → labelled chips
→ layover verdict rows → the S325 deep-link rail. Phase and countdown derive from the trip clock
(`getFlightTiming`, `lib/flight-phase.ts` → `getNow` + `computeCountdown` targeting the authored
`Journey.departDate`), never from a booking label (D-034). The card is self-contained so a later
slice can embed it in Travel Mode or the day timeline (deferred FU). The rail is built by
`lib/flight-deep-links.ts` fed by `lib/booking-data.ts#JOURNEYS`, the same builders and source
Travel Mode's Essentials block uses (section 36), guarded by `lib/__tests__/flights-deep-links-binding.test.ts`.
Timing pinned by `lib/__tests__/flight-phase.test.ts` (incl. `OUTBOUND_JOURNEY.departDate === TRIP_DATES[0]`).
All external deep-links go out only (D-169); every time/date/duration label is verbatim (D-034).

| testid | element | notes |
|---|---|---|
| `flight-card-<journeyId>` | the `<article>` journey card | one per `JOURNEYS` member (`outbound`, `return-to-japan`, `tokyo-to-osaka`, `flight-home`). |
| `flight-phase-<journeyId>` | the phase strip pill | text `Upcoming` / `Departing today` / `Completed` (text + icon + color, never color alone, D-007). Live against the trip clock (honors `?today=`, D-075). |
| `flight-countdown-<journeyId>` | the proximity-countdown row | `Departs in <mo w d / h m s>` while `upcoming`; `Departing today` on the day; `This journey is complete` after. Ticks 1s. |
| `flights-tracker-<legId>` | the FlightRadar24 tracker `<a>` per flight leg | `target="_blank" rel="noopener noreferrer"`; `aria-label="Track <flightNumber> on FlightRadar24"`; absent when the airline isn't in the bounded IATA map (never a guessed link). |
| `flights-rome2rio-<journeyId>` / `flights-gflights-<journeyId>` | the two route-level deep-links per journey card | Byte-exact hrefs built by `lib/flight-deep-links.ts` from the journey's verbatim `fromSummary`/`toSummary`; `target="_blank" rel="noopener noreferrer"` + descriptive `aria-label`. |

## 40. Travel Mode, per-day map + concierge mount: `components/travel-day-map.tsx` · `components/travel-concierge.tsx` (route: `/travel`), S344 / S343

S344, the day's map. A collapsed-by-default `<details>` row (the section 36 Essentials idiom) sitting
directly under the S317 checklist, hosting the existing `<PlanDayMap>` (the `/plan` S136/S137 pane),
with no new map component. It is fed one day plan (`buildItineraryStops([getDayPlan(selectedDate)])`,
`lib/itinerary-map.ts`), so only the selected day's marker-matched stops can ever plot; the day
changes via the same `?date=` seam as the hero/agenda (S187), which re-renders this island in place
with the new stop set. The `<PlanDayMap>` pane is rendered only while the row is open, so the
~200 kB maplibre chunk stays interaction-lazy (D-047) exactly as on `/plan`; the row's open state is
component state, so it survives day changes (open once, then flip days and watch the pins change).
Zero-stop days render an honest empty line instead of a bare world map. Covered by
`e2e/travel-day-map.spec.ts`.

S343, the concierge on `/travel`. The same `<ConciergeChat />` the navbar mounts, placed in the
reserved `.tm-thumb-zone` band (section 32) via `components/travel-concierge.tsx`, whose only rule is
the navbar's `isDefaultTrip()` persona gate. Every other gate stays inside ConciergeChat
(`isConciergeConfigured()` + non-guest traveler), so a dormant build (`NEXT_PUBLIC_CONCIERGE_URL`
unset, which is every build today) renders nothing and the band stays `:empty` → `display:none`. The
gate is unit-proven in `lib/__tests__/travel-concierge-gating.test.ts`, and presence is asserted
conditionally in `e2e/travel-day-map.spec.ts` (the `custom-trip-gating.spec.ts` pattern).

| testid | element | notes |
|---|---|---|
| `travel-day-map` | the `<details>` row | Carries `data-stop-count` (pins plotted), `data-total-count` (items on the day) and `data-stop-ids` (the exact marker ids, comma-joined). `data-stop-ids` is the "the pins changed when the day changed" assertion seam, since `plan-day-map`'s own attributes are count-only. |
| `travel-day-map-summary` | the `<summary>` toggle | ≥48px, keyboard-operable (native `<details>`), visible focus ring. |
| `travel-day-map-count` | the count hint inside the summary | `"2 of 3 stops pinned"`, or `"nothing planned"` on an empty day, visible while collapsed. |
| `travel-day-map-empty` | the zero-pin empty line | Two honest wordings: nothing planned at all vs. planned items that have no map location yet. |
| `plan-day-map` / `plan-day-map-count` | the reused `/plan` pane + its "N of M stops shown" overlay | Unchanged components (S136/S137); present only while the row is open. |
| `concierge-trigger` / `concierge-panel` | the concierge, now reachable on `/travel` | Same ids as the navbar mount; there is only ever one mount at a time (the navbar returns null under `/travel`). Absent in a dormant build on both surfaces. |
| `concierge-error` / `concierge-retry` | the `role="alert"` error row and its single "Try again" control (S389-C) | Present only while `error` is set. `concierge-error` became a `<div>` (it now wraps a button); the copy for a lost connection names being offline and no request is made at all. `concierge-retry` re-sends the last attempted turn: one control, no auto-retry or backoff. Both DOM-proven in `lib/__tests__/concierge-op-feedback.test.ts`. |

## 41. Front door v3 (two-token) + `/trips` account affordances: `components/token-gate.tsx` · `components/user-token-show-once.tsx` · `components/trips-hub.tsx`, S338B (D-239, D-205 amended)

D-239 splits one word into two capabilities, and the UI must never blur them:

- User Token: the account credential. Same on-disk key as S255's Sync Code
  (`tripPlannerSyncCode`, gateway key 28), promoted rather than migrated. Entered at the front
  door only. Never shared.
- Trip Token: one trip's capability (the trip id, the old "Trip Key"). Entered in the
  add-a-trip form and `?trip=` links only. Sharing a trip is sharing its Trip Token.

"Trip Key" and "Sync Code" are retired names in UI copy; the identity stays a plain "name".
`getSyncCode`/`setSyncCode` and `Traveler.token` remain documented internal misnomers.

The wall replaces the old nickname-only form (`Enter your name` + `Unlock` are gone). It has three
paths and one extra state; the show-once screen is a state of the wall, not a route.

| testid | element | notes |
|---|---|---|
| `token-gate-mode-login` / `token-gate-mode-create` | the two path buttons (`aria-pressed`) | Login is the default. Create swaps the form to name-only. |
| `token-gate-user-token` | the User Token `<input>` | Login mode only; absent in create mode (the token is minted for you). |
| `token-gate-name` | the name `<input>` | Both modes. Login needs both fields non-empty to submit. |
| `token-gate-use-saved` | "Use this device's saved User Token" | Rendered only when key 28 is set and differs from the field (a D-239 convenience); disappears once clicked. |
| `token-gate-submit` | the primary submit | "Log in" / "Create account". Login → `setSyncCode` + `signIn` + full reload landing `/trips/`. Create → mint + persist + the show-once state. |
| `token-gate-invite` | the `?trip=` invitation note | Only when the URL carries a `?trip=` token; that Trip Token is held and `joinTrip`ed after log-in/create, landing `/` instead of `/trips/`. |
| `user-token-show-once` / `-value` / `-copy` / `-confirm` | the shared show-once block (`user-token-show-once.tsx`) | Prefix is configurable (`testIdPrefix`), so the /trips upgrade mounts it as `trips-hub-finish-account-show-once-*`. The wall is held mounted across `signIn` so this screen cannot be skipped; only `-confirm` moves on. |
| `trips-hub-copy-token-{i}` | per-row "Trip Token" copy `<button>` | Copies the raw Trip Token (the `?trip=` link stays on `trips-hub-copy-{i}`). Logged-in only (D-238); absent when a row has no shareable token (dormant default pack). |
| `trips-hub-finish-account` / `-mint` | the D-239 grandfathered upgrade card | Rendered only while `traveler && getSyncCode() === null`. `-mint` mints a User Token (key 28 only, leaving identity, registry and pointer untouched) and swaps the card to the show-once block. Never rendered for a guest. |

Deleted here: `settings-sync-enter-input` / `settings-sync-enter-submit` (the Settings
"Enter a code" form; entering a User Token is logging in, so the front door owns it, and
switching accounts means sign out then log in). `settings-sync-*` and `settings-group-sync` keep
their ids (the group is now titled "Your User Token").

## Issue #3: `data-tier` marker, `components/page-hero.tsx` (routes: `/guides`, `/nepal`, `/japan`, `/map`, `/journal`, `/flights`)

Not a `data-testid` but a containment marker, the same idiom as `data-scroll-driven`
above. Those six routes get exactly one loud surface — the full-bleed photographic page
header — and are calm everywhere below it. The attribute is what makes that checkable
without judgement, because it names the subtree the allowance applies to instead of
leaving it to a reviewer's eye.

| attribute | element | notes |
|---|---|---|
| `data-tier="2-header"` | the `<header class="photo-header">` each of those six routes opens with | Exactly one per route. Duotone photography, the two scrim ramps, the country gradient and the route's accent are legal INSIDE this element; the same tokens anywhere else on the route are a defect. A route in that list with no such element has no allowance at all. `/plan` and `/more` render the same component's calm glass-panel branch, which carries no `data-tier` — so the attribute's absence is meaningful too. |
| `data-country="np"` \| `"jp"` | the same `<header>` | Selects the duotone pair (`--duo-np-*` / `--duo-jp-*`) the grade uses. It follows the PHOTOGRAPH's country, not the route's: `/map`'s header photo is Shibuya, so `/map` is `jp` even though the route has no country of its own. |

There is deliberately no `data-testid` here. `header[data-tier="2-header"]` is already a
stable, meaningful selector, and the existing visual baselines locate the masthead as
`page.locator('header').first()`, which is unchanged.
