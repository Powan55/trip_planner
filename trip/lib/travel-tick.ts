'use client';

// — ONE shared tick source for `/travel`. Replaces the four independent
// per-card `setInterval(…, 1000)` clocks (hero / agenda / tonight / date-picker) with a single
// module-level interval every subscribing card reads from. A slow base cadence covers every
// time label ("in 2h", agenda, next-up, tonight, day-strip); the ONE genuinely per-second thing
// (the current-activity progress bar) requests a fast rate while it is on screen and releases it
// on unmount. Time VALUES are unchanged — each tick re-reads the real clock (`getNow()` via each
// card's existing recompute), we only changed HOW OFTEN that recompute runs.
//
// A module singleton (not a React context) because `/travel`'s client root — `travel-date-picker`
// — itself needs the clock AND renders the subscribing children, so there is no wrapper node above
// it to host a provider without splitting that component. A subscribable module fits the existing
// tree with the smallest diff (the simplest shape that fits).
//
// Does NOT touch `lib/trip-now.ts`, the 60s presence heartbeat, the wake-lock, or
// the HOME countdown — all out of scope.

import { useEffect, useState } from 'react';

// base cadence 20s — the tunable. Most `/travel` labels don't move per-second; 20s keeps
// "in N min"/day-boundary self-correction feeling live while cutting ~19 wakeups in 20 vs 1 Hz.
// Drop it if a future label needs finer idle granularity.
const BASE_MS = 20_000;
const FAST_MS = 1_000;

type Cb = () => void;

const subscribers = new Set<Cb>();
let fastCount = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let currentMs = 0; // the interval period currently scheduled; 0 == no timer running

function fire() {
  // Copy so a subscriber unsubscribing mid-tick can't mutate the set we're iterating.
  for (const cb of [...subscribers]) cb();
}

/** (Re)schedule the single interval to the rate the current state demands. Idempotent:
 * a no-op when already running at the right period, so escalate/relax only pays a
 * clearInterval+setInterval when the rate ACTUALLY changes. SSR-safe (no window → no timer). */
function reschedule() {
  if (typeof window === 'undefined') return;
  const want = subscribers.size === 0 ? 0 : fastCount > 0 ? FAST_MS : BASE_MS;
  if (want === currentMs) return;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  currentMs = want;
  if (want !== 0) timer = setInterval(fire, want);
}

/** Subscribe to the shared tick. Returns an unsubscribe; the interval stops when the last
 * subscriber leaves. Cards recompute from the real clock inside their own effect keyed on the
 * tick counter (see `useTravelTick`). */
export function subscribeTravelTick(cb: Cb): () => void {
  subscribers.add(cb);
  reschedule();
  return () => {
    subscribers.delete(cb);
    reschedule();
  };
}

/** Ref-counted request for the fast (1s) cadence — held by the current-activity progress bar
 * while it is on screen. The rate escalates to 1s while ≥1 request is held and relaxes to the
 * base cadence once all are released. Returns the release fn (use as an effect cleanup). */
export function requestFastTick(): () => void {
  fastCount += 1;
  reschedule();
  let released = false;
  return () => {
    if (released) return; // idempotent release — double-cleanup must not underflow the count
    released = true;
    fastCount = Math.max(0, fastCount - 1);
    reschedule();
  };
}

/** Introspection for the unit test: the scheduled period in ms, or `null` when idle. */
export function currentTravelTickMs(): number | null {
  return timer === null ? null : currentMs;
}

/** Test-only reset of the module singleton between cases. */
export function __resetTravelTick(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  currentMs = 0;
  subscribers.clear();
  fastCount = 0;
}

/**
 * Hook: returns a counter that increments on every shared tick. A subscribing card recomputes
 * from `getNow()` in an effect keyed on this value (plus its own inputs, e.g. `date`), so a slow
 * tick still reads the REAL clock — correctness intact, only the frequency drops.
 */
export function useTravelTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => subscribeTravelTick(() => setN((v) => v + 1)), []);
  return n;
}
