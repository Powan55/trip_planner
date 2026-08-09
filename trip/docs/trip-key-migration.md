# Trip Key migration runbook

Cut the one live Nepal×Japan trip over to the capability-token security model (D-205 / D-210).
Every step here is done by hand: no agent has console or CLI access and nothing here is
automated (D-044 LOCKED). No migration script or code is required. The app's existing
first-snapshot reconciliation does the data move for free.

## Background (why this is needed)

Under the new model a trip lives at `trips/{token}`, where `token` is a high-entropy secret and
whoever holds it can read+write that trip (a "link can edit" capability). The literal string
`nepal-japan-2026` is already public (committed throughout this repo), so it cannot be the
security boundary. The live trip must therefore move to a freshly-minted secret token, injected
into the build via the already-existing `NEXT_PUBLIC_TRIP_ID` env var. The default pack's **local**
localStorage id stays `nepal-japan-2026` forever (D-172 grandfather); only its **remote** path
changes.

## Steps

1. **Mint a new secret token.** In any browser console (offline, no app access needed):
   ```js
   crypto.randomUUID()
   ```
   Copy the result (a v4 UUID, e.g. `e1a9c2f4-7b3d-4c1a-9e2b-6f8a1d4c7b90`). This is the trip's
   new secret. Keep it private; treat it like a password.

2. **Deploy the new `firestore.rules`.** The rules text is already final and committed (it landed
   in S232). In the Firebase console (or via the Firebase CLI on your own machine), publish
   `firestore.rules` so the top-level `trips` `list` is denied and
   `trips/{tripId}/{document=**}` allows `get, list, write: if true` (no `request.auth`).

3. **Set `NEXT_PUBLIC_TRIP_ID` and redeploy.** In the static-site build environment (the deploy
   pipeline / GitHub Pages workflow env), set:
   ```
   NEXT_PUBLIC_TRIP_ID=<the secret from step 1>
   ```
   Then redeploy the site. From now on the default pack's `getTripId()` returns this secret, so all
   sync reads/writes hit `trips/{secret}/...` instead of the old public path.

4. **Seed the new path (recommended: you go first).** The first traveler to load the redeployed
   build triggers the existing "never synced → seed from local" path (`reconcileFirstSnapshot`,
   unchanged), which recreates the whole trip at `trips/{secret}` from that browser's own local
   mirror. Load the site yourself once, first, right after the cutover, so you are the
   deterministic single seeder. That avoids any ambiguity about whose local copy seeds if several
   friends reload near-simultaneously. (The merge logic converges either way, so this is a cheap
   precaution rather than a hard requirement.)

5. **Everyone else reloads.** Each friend's next load steady-state merges their local data into the
   new path (existing sync logic). That is safe by construction as long as normal sync kept every
   browser converged before the cutover. Nobody needs to paste a key: the default pack picks up the
   new remote token automatically from the build's env var.

6. **Recommended cleanup: delete the old path.** After verifying `trips/{secret}` is live and
   populated, manually delete the documents under `trips/nepal-japan-2026/**` in the Firebase
   console. Under the new rules that path is now technically writable by anyone (its id is public),
   so removing the stale data there closes a needless residual exposure. There is nothing of value
   left to protect once the real data has moved.

## Sharing a trip afterward

- To add a collaborator to the live trip, share its **Trip Key** (the secret) or a link of the
  form `https://<site>/?trip=<secret>`. Both are surfaced in the app under **Settings → Trip**.
- Opening a `?trip=` link prompts a confirm before switching; pasting a key in Settings → Trip
  → "Join a trip" does the same switch. Anyone with the key has full edit access, so share it only
  with the travelers.
- "Create a trip" (**Trips → `/trips/`**, not Settings) mints a brand-new secret for a fresh,
  separate trip. Settings had a second create button until S390-F; it was deleted because it made
  an unnamed, unconfigured trip whose details never reached anyone who joined it.
