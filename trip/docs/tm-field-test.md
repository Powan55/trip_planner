# Travel Mode: real-iPhone field-test script (S192, M19 Phase 2)

A hand-run validation of Travel Mode on a **physical iPhone**, covering the things the
emulated Playwright net (`e2e/tm-acceptance.spec.ts`, TM-1…12) cannot prove on a Linux CI
runner driving chromium-emulated iPhone viewports: real iOS Safari rendering, a genuine
installed PWA, the Dynamic Island, a real airplane-mode relaunch, and the real Firebase
sync round-trip on reconnect.

**Who runs it:** whoever is carrying the travel iPhone, on that device.
**When:** once **post-ship (~Nov 9, 2026)** to shake out install/offline behaviour early, and
again **~Dec 1, 2026** (just before the Dec 9 departure) as the go/no-go check.

Notes before you start:
- Use the **deployed** site (the GitHub Pages URL), not a dev server: the service worker and
  installed-PWA behaviour only exist on the real deployed origin.
- The trip clock is real. To exercise the in-trip states before Dec 9, append `?today=2026-12-10`
  (a Nepal day) or `?today=2026-12-19` (an Osaka day) to any URL. That is the D-075 simulation
  override, and the only way to see the live in-trip hero before the trip actually starts.
- "PASS" = the expected result verbatim. Anything else = "FAIL"; note exactly what you saw.

---

## Step 1: Add to Home Screen (A2HS install)

1. Open the deployed site in **Safari** (not Chrome; iOS only installs PWAs from Safari).
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.
3. Launch the app from the **new Home Screen icon** (not from Safari).

- **PASS:** the icon shows the trip artwork (not a generic Safari screenshot); launching it opens
  **full-screen with no Safari address bar / toolbar** (standalone display mode). The splash uses
  the app's dark theme, not a white flash.
- **FAIL looks like:** a generic/blank icon; the app opens inside Safari chrome (address bar
  visible) → the `display: standalone` manifest or the icons didn't take; a white/blank splash.

## Step 2: Dynamic Island / status-bar check

1. With the installed app open, look at the **top of the screen** (the Dynamic Island / notch area)
   on a Pro/Pro Max device.
2. Enter Travel Mode (Step 3) and confirm the top of the Travel Mode screen too.

- **PASS:** no app content is hidden **behind** the Dynamic Island or the rounded corners. There is
  clear padding at the very top and bottom (the `env(safe-area-inset-*)` safe-area padding). The
  status-bar time/battery remain legible over the app's dark background.
- **FAIL looks like:** the hero heading, the exit **X**, or the day-strip is clipped under the
  Dynamic Island or the home-indicator; content runs edge-to-edge with no top/bottom inset.

## Step 3: Travel Mode walkthrough

1. From any page, tap the **Travel Mode** button (top-right of the nav).
2. Add `?today=2026-12-10` to the URL first if you want the live in-trip card before Dec 9.
3. Exercise: read the **Now / Next** hero; tap it to **expand** details; tap a few **day-strip**
   chips to move across the trip; toggle the **outdoor high-legibility** button; scroll to the
   **Essentials** (weather / currency / emergency numbers / flight links); tap the **exit X**.

- **PASS:** every state renders a designed card (never a blank). Day-strip taps re-center smoothly
  and update the hero + agenda. The legibility toggle visibly brightens/enlarges the text. Tapping a
  `tel:` emergency number offers to call. The exit **X** returns you to the page you came from, and
  the app chrome (nav/tab-bar) is back, with no way for Back to bounce you into `/travel` again.
- **FAIL looks like:** any blank/placeholder card; a day tap that does nothing or shows the wrong
  leg (e.g. Dec 19 still saying Kathmandu); the legibility toggle doing nothing; exit landing on the
  wrong page or trapping you in Travel Mode.

## Step 4: Airplane-mode relaunch (offline cold start)

1. In the installed app, open **Travel Mode** once (so it arms and the service worker is warm).
2. Turn on **Airplane Mode** (Wi-Fi + cellular off).
3. **Fully close** the app (swipe it away from the app switcher).
4. **Relaunch** it from the Home Screen icon while still offline.

- **PASS:** the app opens offline and lands **back in Travel Mode** automatically (the relaunch
  re-enter). The hero, agenda, day header and Essentials shell all render from cache. Weather and
  currency tiles show a cached value or a quiet "unavailable", never a crash, error page, or
  spinner that never resolves.
- **FAIL looks like:** the browser's "You're offline" / cannot-open-page screen; a white screen; a
  crash; or Travel Mode opening but with a broken/empty layout.

## Step 5: Offline edit, then sync on reconnect

1. Still **offline** (from Step 4), in Travel Mode toggle an activity **done** (or edit an item on
   `/plan`). Note which item you changed.
2. Force-close and relaunch **while still offline**, and confirm the edit is **still there**.
3. Turn **Airplane Mode off** (reconnect). Leave the app open a few seconds.
4. If you have a second device/browser signed into the same trip, open it and check the same day.

- **PASS:** the edit survives the offline relaunch (localStorage is the source of truth). On
  reconnect, the sync-status indicator settles to a **"Synced"** state within a few seconds (no
  stuck "pending"). On the second device, the same item shows the change after it syncs.
- **FAIL looks like:** the offline edit is lost after relaunch; on reconnect the status stays
  "pending"/"offline" indefinitely; or the second device never reflects the change.

## Step 6: Push receipt (notification round-trip)

> Only if push has been enabled for this build. If the app never asks for notification permission,
> record this step as **N/A**: push is not wired for this device yet.

1. In the app, enable notifications when prompted (**Allow**), granting iOS permission.
2. Trigger the app's test/confirmation push (or send one from the second device).
3. Background the app and wait.

- **PASS:** iOS shows the notification on the lock/Home screen; tapping it **opens the installed
  app** (not Safari) to the relevant screen.
- **FAIL looks like:** the permission prompt never appears; permission granted but no notification
  arrives; or the notification opens Safari / a wrong screen. (On iOS, push requires the app to be
  installed to the Home Screen first; if it failed, re-confirm Step 1.)

---

### Quick record sheet

| Step | Run 1 (~Nov 9) | Run 2 (~Dec 1) | Notes |
|------|----------------|----------------|-------|
| 1 A2HS install            |  |  |  |
| 2 Dynamic Island / insets |  |  |  |
| 3 TM walkthrough          |  |  |  |
| 4 Airplane-mode relaunch  |  |  |  |
| 5 Offline edit → sync     |  |  |  |
| 6 Push receipt            |  |  |  |
