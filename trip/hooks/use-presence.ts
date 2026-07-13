'use client';

import { useEffect, useState } from 'react';
import { isRemoteConfigured } from '@/lib/firebase-config';
import { getActiveTraveler, IDENTITY_CHANGED_EVENT, TRAVELERS } from '@/lib/token-auth';
import type { PresenceRecord } from '@/lib/presence';

/**
 * Reactive view of "who else is active on the trip right now".
 *
 * Subscribes to the presence collection via `lib/presence.ts` and returns the currently
 * active travelers (filtered by `isActive`), excluding the signed-in viewer themselves (the
 * bar shows *others*). Each entry is enriched with the traveler's brand accent.
 *
 * Dormant / guest-safe (the headline guarantee here): `lib/presence.ts` (and through
 * it, firebase) is reached only via a dynamic `import()` inside the effect, behind the gate
 * `isRemoteConfigured() && getActiveTraveler()` — the same gate the provider uses for the
 * remote `days` subscribe. So the module body never lands in the first-load chunk (mirrors
 * how `itinerary-provider` lazy-imports `itinerary-remote`); only the pure, firebase-free
 * modules (`firebase-config`, `token-auth`) are statically imported here. Dormant (no env)
 * or guest (no token) means the effect short-circuits before any `import('@/lib/presence')`, so
 * no firebase is loaded and the hook returns an empty list. It re-evaluates on the same-tab
 * `IDENTITY_CHANGED_EVENT`: sign-in opens the subscribe live; sign-out tears it down
 * and clears the list.
 *
 * A "stale eviction" tick re-filters on an interval so a traveler whose tab went away
 * (heartbeat stopped) ages off the bar even with no new snapshot — bounded by the active
 * window, well above the 30s free-tier floor, so it costs no reads (pure client re-filter).
 *
 * SSR-safe: returns `[]` on the server and first client paint (the subscribe runs in an
 * effect, after mount). Never writes — the write/heartbeat side is owned by the provider.
 */

/** An active traveler as surfaced to the presence bar. */
export interface ActivePresence {
  uid: string;
  name: string;
  /** Brand accent for this traveler (from TRAVELERS); falls back to gold if unknown. */
  accent: string;
  lastSeen: number | null;
}

const FALLBACK_ACCENT = '#f0c760'; // gold (brand primary) — only if a name doesn't resolve
const ACTIVE_WINDOW_MS = 3 * 60_000; // mirror lib/presence ACTIVE_WINDOW_MS (eviction tick)

/** Map a traveler name → its brand accent. Case-insensitive, defensive. */
function accentFor(name: string): string {
  const match = TRAVELERS.find((t) => t.name.toLowerCase() === name.trim().toLowerCase());
  return match?.accent ?? FALLBACK_ACCENT;
}

/** Recent-enough heartbeat → "active now". Pure; a pending (null) lastSeen counts active. */
function recordIsActive(lastSeen: number | null, now: number): boolean {
  if (lastSeen == null) return true;
  return now - lastSeen <= ACTIVE_WINDOW_MS;
}

export function usePresence(): ActivePresence[] {
  const [records, setRecords] = useState<PresenceRecord[]>([]);
  // A monotonically-increasing tick that forces a re-filter so stale travelers age off the
  // bar even without a new snapshot. Stored as state so a change re-renders + re-derives.
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let evictTimer: ReturnType<typeof setInterval> | null = null;

    const teardown = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (evictTimer !== null) {
        clearInterval(evictTimer);
        evictTimer = null;
      }
      setRecords([]); // clear immediately on sign-out / unmount
    };

    const activate = () => {
      // Same gate as the provider's remote subscribe: configured and a token
      // traveler. Guest / dormant short-circuits before any `import('@/lib/presence')`, so no
      // firebase loads, and the presence module body stays off the first-load chunk.
      if (!(isRemoteConfigured() && getActiveTraveler())) return;
      if (unsubscribe) return; // already subscribed for the current identity
      import('@/lib/presence')
        .then(({ subscribePresence }) => {
          if (cancelled) return;
          if (unsubscribe) return; // a concurrent activate already won
          unsubscribe = subscribePresence((next) => setRecords(next));
          // Re-filter periodically so a vanished traveler ages off even with no new
          // snapshot (pure client re-filter; no reads).
          evictTimer = setInterval(() => setTick((t) => t + 1), ACTIVE_WINDOW_MS);
        })
        .catch((err) => {
          console.warn('[use-presence] presence unavailable:', err);
        });
    };

    // Open on mount for a returning signed-in traveler...
    activate();

    // ...and re-evaluate on identity change (sign-in opens live, sign-out tears down).
    const onIdentityChanged = () => {
      teardown();
      activate();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
    }

    return () => {
      cancelled = true;
      if (typeof window !== 'undefined') {
        window.removeEventListener(IDENTITY_CHANGED_EVENT, onIdentityChanged);
      }
      teardown();
    };
  }, []);

  // Derive the active OTHERS: active window + exclude self + named, enriched with accent.
  const me = getActiveTraveler();
  const now = Date.now();
  const active: ActivePresence[] = [];
  for (const r of records) {
    if (!r.name) continue;
    if (!recordIsActive(r.lastSeen, now)) continue;
    // Exclude the viewer's own heartbeat — the bar shows who else is here. Match by name
    // (soft identity); a traveler signed in on two tabs collapses to one entry below.
    if (me && r.name.trim().toLowerCase() === me.name.trim().toLowerCase()) continue;
    active.push({ uid: r.uid, name: r.name, accent: accentFor(r.name), lastSeen: r.lastSeen });
  }

  // Collapse duplicates by name (same traveler on multiple tabs/uids) — keep the freshest.
  const byName = new Map<string, ActivePresence>();
  for (const p of active) {
    const key = p.name.trim().toLowerCase();
    const existing = byName.get(key);
    if (!existing || (p.lastSeen ?? Infinity) > (existing.lastSeen ?? -Infinity)) {
      byName.set(key, p);
    }
  }
  return Array.from(byName.values());
}
