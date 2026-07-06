/**
 * Core ports — the framework-free boundary interfaces the app's adapters implement.
 * "Port" in the hexagonal sense: `core/` states WHAT it
 * needs from the outside world as a plain-TS interface, and a thin `lib/` adapter
 * supplies the actual I/O (URL / web-storage / real clock). Core never imports React,
 * Next, `window`, or `date-fns`-of-the-app — only these contracts.
 *
 * ── ClockPort ───────────────────────────────────────────────────────────────
 * The single "what instant is it, right now" boundary. `core/clock` decomposition
 * (`computeCountdown`) and `core/dates` day-math are PURE — they take a `now: Date` and
 * never read a clock. The impurity (reading the real clock AND resolving the `?today=`
 * simulation override) is confined to the adapter that implements this
 * port: `lib/trip-now.ts`. Keeping the read behind a one-method port is what lets the
 * override precedence + once-per-load timing live in exactly one place while the math
 * stays deterministically testable.
 */
export interface ClockPort {
  /**
   * The app-wide "now". Returns the active `?today=` / sessionStorage override (local
   * noon of the overridden day) when one is resolved this page load, otherwise the real
   * `new Date()`. A FRESH Date each call so live-ticking callers (the countdown) keep
   * advancing. SSR returns the real clock (no override resolved server-side).
   */
  now(): Date;
}

/**
 * ── StoragePort<T> ───────────────────────────────────────────────────────────
 * The single "read/write the persisted domain value" boundary. `core/itinerary` states
 * WHAT it needs (load the freshest persisted value, save a value, ask whether anything was
 * ever persisted) as this plain-TS contract; the framework layer supplies the actual I/O.
 *
 * Production impl: the Vault-backed itinerary gateway —
 * `loadPlans` / `savePlans` / `hasStoredPlans` from `lib/itinerary-storage.ts`, whose
 * internals are the Trip Vault. The three-state key-presence contract, the
 * `[]`-survives guarantee, and the quarantine all live INSIDE that impl —
 * this port is agnostic to them, it just reads/writes `T`. `load()` returning the FRESHEST
 * persisted state is what makes the store's read-modify-write commit compose; the
 * adapter reads its base via `load()`, never a stale closure.
 *
 * Generic over the payload so it is reusable, but the itinerary wires `T = DayPlan[]`.
 */
export interface StoragePort<T> {
  /** The freshest persisted value (or the seed/fallback the impl defines when absent). */
  load(): T;
  /** Persist a value verbatim — including an empty one; no length gate. */
  save(value: T): void;
  /** Has a value ever been persisted to this browser? (key-presence.) */
  has(): boolean;
}

/**
 * ── SyncPort<T> ──────────────────────────────────────────────────────────────
 * The remote-sync boundary. Two directions, both per-day-DELTA-shaped to match the
 * Firestore-compatible per-day granularity:
 *
 *   push(prev, next)  — local→remote fan-out, invoked ONLY from the store's single
 *                       `commit()` choke-point AFTER the local `save()`. Diffs
 *                       `prev`→`next` per day; for each changed day it performs the
 *                       merge-aware write. No-op when not
 *                       configured. Never throws (degrades local-only).
 *   subscribe(onApplied) — remote→local read direction. Opens the long-lived Firestore
 *                       `onSnapshot`; on each snapshot it MERGES incoming remote days
 *                       against the current local view and applies via
 *                       `savePlans()`+dispatch DIRECTLY — NEVER via `commit()` — so the
 *                       snapshot path can never re-push (echo-suppression). Returns
 *                       an unsubscribe fn; a no-op unsub when not configured.
 *   isConfigured()    — the dormant/config gate surfaced through the port.
 *
 * The remote→local direction is first-class on the port so the whole sync surface is ONE
 * contract. The provider still owns WHEN it subscribes (mount + identity gates) — the port
 * just exposes the operation.
 *
 * Production impl: the adapter in `lib/itinerary-ports.ts` delegating to
 * `lib/itinerary-remote.ts`'s `pushPlans` / `subscribeRemote`, each reached via a DYNAMIC
 * `import()` gated on `isRemoteConfigured()` so the dormant build never pulls firebase onto
 * the hot path. This port must NEVER be implemented by a module that
 * statically imports firebase.
 *
 * ECHO-SUPPRESSION: `push` is invoked ONLY from genuine local mutations
 * (`commit()`), NEVER from the remote snapshot-ingest path. `subscribe`'s handler applies
 * remote via `savePlans()`+dispatch directly and never pushes. Both are best-effort and
 * self-degrading — the impl swallows its own failures and never throws, so a remote failure
 * can never break a local edit.
 */
export interface SyncPort<T> {
  /** Best-effort per-delta push of `prev`→`next`; never throws. */
  push(prev: T, next: T): Promise<void>;
  /**
   * Open the remote→local subscription (merge + `savePlans()`+dispatch, never `commit()`).
   * `onApplied` (optional) fires with the merged value after each applied snapshot.
   * Returns an unsubscribe fn; a no-op unsub when `isConfigured()` is false.
   */
  subscribe(onApplied?: (mergedValue: T) => void): () => void;
  /** The dormant/config gate surfaced through the port. */
  isConfigured(): boolean;
}
