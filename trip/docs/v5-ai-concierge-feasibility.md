# v5 Phase-4 Feasibility Spike — AI Concierge & Web Push

**Slice:** S197 · **Date:** 2026-07-16 · **Milestone:** M19 (v5) Phase 4
**Status:** research/decision deliverable, no application code. Locked the provider + push-protocol choices for S198+. **Historical — see "Outcome" below for what shipped.**

This spike answers three questions before any Worker code is written:
1. Do the free-tier quotas (Gemini primary → Groq fallback) comfortably cover a real trip party's concierge use?
2. Which Web Push protocol do we lock, raw VAPID or FCM?
3. Explicit go / no-go per feature.

Scope fence: anything paid or card-required is out of v5 (`V5-DEVPLAN.md`). Both providers below are free-tier, no-card. If either turns out to require billing at key-creation time, that is an automatic no-go for that provider, not a judgment call.

Privacy carry-over (D-152 LOCKED posture): the concierge must never see journal content. The chat context builder in S199 has to exclude gateway key 12 entirely.

---

## 0. Outcome (added at the final documentation pass, 2026-08-10)

- **AI concierge: shipped.** The Cloudflare Worker went live on **2026-08-09** as
  `trip-planner-concierge` v1.8.0, recorded with its Version ID in `lib/concierge-config.ts` and
  pinned by `lib/__tests__/travel-concierge-gating.test.ts`. The client half is gated by
  `isConciergeConfigured()` and covered by `e2e/concierge.spec.ts`.
- **Web Push: not built.** The raw-VAPID GO verdict in section 4 was never acted on. There is no
  `PushManager` subscribe, no `applicationServerKey`, and no `push`/`notificationclick` handler in
  `scripts/gen-sw.mjs`. The morning-briefing push does not exist.
- **The `<PASTE LIVE RPD HERE>` and `<UNVERIFIED — confirm before S198>` markers below were never
  filled.** The Worker shipped without them, and the S315 annotation in section 2 has since
  replaced the model ladder they were sizing. Read every quota number here as the 2026-07-16
  estimate it was; none of it is a live figure.
- Section 5's manual setup steps were carried out — the Worker is live against a real provider key
  — and are kept only as the record of what was done.

---

## 1. Quota table

### Gemini (Google AI Studio, free tier, no card required to generate a key)

Per the official docs (`ai.google.dev/gemini-api/docs/rate-limits`), exact RPM/TPM/RPD are dynamic per-project and only shown live in AI Studio's rate-limit dashboard (`aistudio.google.com/rate-limit`); the static docs page publishes no fixed table. Public aggregators (2026) converge on the estimates below. Treat them as estimates to verify, not locked numbers.

| Model | RPM | RPD | Source / confidence |
|---|---|---|---|
| gemini-2.5-flash | ~10 | ~250 | aggregator estimate, `<UNVERIFIED — confirm before S198>` |
| gemini-2.5-flash-lite | ~15 | ~1,000 | aggregator estimate, `<UNVERIFIED — confirm before S198>` |

**Primary model choice:** `gemini-2.5-flash-lite`. The higher RPD (~1,000 vs ~250) makes it the right default for a chat concierge; flash is the escalation option if answer quality on lite proves weak (a Worker-side model-string swap, no re-decision).

> **The live RPD was never pasted in here** (see the Outcome block above). The go/no-go did not block on it; the estimate was enough to reason about headroom, and the Worker shipped on that basis.

### Groq (`console.groq.com`, free tier, no card required): confirmed

Confirmed via official docs (`console.groq.com/docs/rate-limits`) this session. Matches `V5-DEVPLAN.md`'s draft numbers exactly, no discrepancy.

| Model | RPM | RPD | TPM | TPD |
|---|---|---|---|---|
| llama-3.3-70b-versatile | 30 | 1,000 | 12,000 | 100,000 |
| llama-3.1-8b-instant | 30 | 14,400 | 6,000 | 500,000 |

**Fallback ladder:** on a Gemini 429/5xx/timeout, fall through to Groq `llama-3.3-70b-versatile` (quality-comparable), then to `llama-3.1-8b-instant` (the deep well: 14,400 RPD) if the 70b daily cap is hit. Keys are Worker-only: never in the client bundle or the static `out/` export (D-004 boundary).

---

## 2. Usage-headroom sanity check

> **Annotation (S315, 2026-07-25):** Groq deprecates `llama-3.3-70b-versatile`
> and `llama-3.1-8b-instant` on 2026-08-16; the ladder now runs
> `openai/gpt-oss-120b` → `openai/gpt-oss-20b` (both free-tier). The old
> headroom math below leaned on the 8b model's 14,400 RPD, and the gpt-oss
> family lacks that deep well (each is ~1,000 RPD free-tier), so the **combined
> free budget drops from ~16,400 to ~3,000 RPD** (Gemini-lite ~1,000 + 120b
> ~1,000 + 20b ~1,000). The GO verdict still holds: ~3,000 RPD is still ~15×
> the heavy worst case (200 turns/day) and ~25× the generous case (120/day),
> and Gemini stays primary so Groq is only drawn on when Gemini is unavailable.
> Read the numbers below with this ceiling in mind; the conclusion is unchanged.

**Party model (generous):** 4 people (top of the 2–4 range), ~32-day trip window (Dec 9 → Jan 9), each person up to a few dozen concierge messages/day. Take **30 messages/day/person** as the generous steady case and **50/day/person** as a heavy worst case. One concierge turn = one LLM request (SSE streams a single request per turn).

| Scenario | Turns/day | vs Gemini-lite alone (~1,000 RPD) | vs combined budget (~16,400 RPD) |
|---|---|---|---|
| Generous (4 × 30) | 120 | **12%** | **0.7%** |
| Heavy worst case (4 × 50) | 200 | **20%** | **1.2%** |

Combined daily budget = Gemini-lite ~1,000 + Groq 70b 1,000 + Groq 8b 14,400 ≈ **16,400 requests/day**, and the fallback only draws on Groq when Gemini is unavailable, so in the normal path the party uses ~12% of Gemini alone and never touches Groq.

**Per-minute (RPM):** the binding limit is Gemini-lite's ~15 RPM. Concierge use is human-paced and interactive; a 4-person party firing 15+ turns inside the same 60-second window is not a realistic pattern for trip-planning chat. On the rare simultaneous burst, the Groq fallback (30 RPM each model) absorbs overflow. Comfortable.

**Tokens (Groq TPM, the tightest dimension on fallback):** a concierge turn with trip context is on the order of **~1,500–3,000 tokens** in+out (`<UNVERIFIED — depends on final S199 context-builder size; confirm before S198>`). Against Groq 70b's 12,000 TPM that is ~4–8 turns/minute on the fallback path, which is ample for a 4-person party, and the 8b model's headroom (500k TPD) backstops a sustained day.

**Verdict:** the daily and per-minute budgets are comfortable with a wide margin (an order of magnitude on RPD even against Gemini alone). The only figure that could move this is the live Gemini RPD coming in far below the ~1,000 estimate. Even at the ~250 RPD of gemini-2.5-flash, the generous 120 turns/day is still under half the cap, and Groq's 15,400 RPD fallback covers any Gemini shortfall entirely. Headroom does not gate the build.

---

## 3. Push protocol comparison & locked recommendation

Two real options for the morning-briefing push:

| Dimension | (a) Raw Web Push + VAPID | (b) Firebase Cloud Messaging (FCM) Web Push |
|---|---|---|
| Service worker | A `push`/`notificationclick` handler in the app's **existing** SW (`scripts/gen-sw.mjs` output) | Expects its own `firebase-messaging-sw.js` at origin scope, or an `importScripts` merge into the app SW |
| SW collision risk | None: one hand-maintained SW stays one SW (D-073) | **Real**: a second SW file or an awkward merge into the single generated SW; scope/registration collision risk |
| Client dependency | None: standard `PushManager.subscribe({applicationServerKey})` | Firebase web SDK (a new client dep) |
| Server side | Worker signs payloads with VAPID keys it holds; a `web-push`-style sender | FCM server key + FCM send API |
| iOS installed-PWA (16.4+) | Supported: standard Web Push API + VAPID is the documented A2HS path | Also works, but via the heavier SDK path |
| Free / no-card | Yes: pure web-platform + self-held keys | Yes on Spark, but adds SDK + a second SW surface |

**The generated-SW collision is the deciding factor.** This app has exactly one hand-maintained service worker doing precaching (D-073); FCM's web SDK wants its own `firebase-messaging-sw.js` or an `importScripts` merge, which risks a scope/registration collision or forces an awkward merge. Raw VAPID is just a `push` event handler added to the existing SW, which S202's plan already anticipates ("SW push/notificationclick handlers merged into gen-sw output behind a dormant-unless-configured gate"), with the Worker signing payloads server-side. No FCM SDK, no second SW file, no extra client dependency.

iOS Safari installed-PWA (16.4+) supports the standard Web Push API + VAPID for A2HS apps, a well-established web-platform fact, so raw VAPID does not sacrifice iOS reach.

**Locked recommendation: raw Web Push + VAPID.** No FCM. The VAPID keypair is a Worker-only secret (the public key ships to the client as the `applicationServerKey`, which is by design public; the private key never leaves the Worker).

---

## 4. Go / No-Go verdict per feature

| Feature | Verdict | One-sentence reasoning |
|---|---|---|
| **AI concierge** (Gemini free tier primary → Groq fallback) | **GO** | Free-tier, no-card quotas cover a generous 4-person / 32-day party at ~12% of Gemini's estimated daily budget with a ~15,400 RPD Groq fallback behind it: an order-of-magnitude headroom that does not depend on the exact live Gemini number. |
| **Web Push** (morning briefing) | **GO** | Raw VAPID is a free, standard-web-platform path that adds a single `push` handler to the existing SW with zero new client deps and no FCM service-worker collision, and is supported on iOS 16.4+ installed PWAs. |

Both GO verdicts are conditional on the no-card check at key-creation time (see section 5): if Google AI Studio or Groq demands a payment card to issue a key, that provider flips to no-go per the scope fence above. Neither is expected to (both issue free keys without a card as of this research), but the check still has to be done by hand.

---

## 5. Manual setup steps (≈5 minutes — carried out before S198; kept as the record)

**A. Gemini key + live quota number**
1. Sign in at `aistudio.google.com` and create (or select) a project. Confirm no payment card is requested; if it is, stop and flag it as a no-go.
2. Generate an API key (AI Studio → "Get API key" → create key). Keep it secret; it will live only as a Worker secret (S198), never in the repo or client.
3. Open `aistudio.google.com/rate-limit`, read the **gemini-2.5-flash-lite** row's live **RPD** (and RPM).
4. Paste that number in two places: replace **`<PASTE LIVE RPD HERE>`** in section 1 above, and update the D-174 draft's quota note in `DECISIONS.md`.

**B. Groq key**
1. Sign in at `console.groq.com` and create an API key. Confirm no payment card is requested.
2. Keep it secret: Worker secret only (S198). No dashboard number to copy back; the docs figures in section 1 are already confirmed.

**C. VAPID keypair** (can wait for S198, listed here for completeness)
- Generate a VAPID keypair (e.g. `web-push generate-vapid-keys`); the private key becomes a Worker secret, the public key is the client `applicationServerKey`. No account, no card.

Once A + B are done and the no-card checks pass, S198 (the Cloudflare Worker) is unblocked. Anything touching `pushSubs` also waits on FU-18 (rules deploy).

---

## 6. Notes for downstream slices
- **S199 (chat context builder):** exclude journal (gateway key 12) from all concierge context, per the D-152 privacy posture. No journal text ever reaches the Worker.
- **S198 (Worker):** keys are Worker-only secrets; nothing reaches the client bundle or `out/` (D-004 boundary).
- **S202 (SW):** raw-VAPID `push`/`notificationclick` handlers merge into the gen-sw output behind a dormant-unless-configured gate, with no second SW file.
