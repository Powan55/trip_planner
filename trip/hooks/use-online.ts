'use client';

import { useEffect, useState } from 'react';

/**
 * Connectivity signal behind the app-wide offline banner
 * (`components/offline-banner.tsx`) and the Home "Connection" tile
 * (`components/home-bento.tsx`).
 *
 * `navigator.onLine` alone is NOT the truth: it reports that a network interface
 * exists, not that anything is reachable. On captive-portal wifi, a dead uplink, or a
 * hotel AP that resolves nothing it stays `true`, so the banner never rendered and the
 * tile read "Online" while weather, the currency rate, Firestore sync and the concierge
 * were all failing — the one moment the banner exists for.
 *
 * So: `navigator.onLine` stays the fast NEGATIVE (it is reliable when `false`), and the
 * POSITIVE is corroborated by the outcome of requests the app already makes. No probe,
 * no polling, no new dependency.
 *
 * The corroborated negative EXPIRES — see `REACHABILITY_SUSPECT_MS`. It is inferred from
 * one failed request rather than read off the device, and the app stops making requests
 * once it believes it is offline, so a permanent version of it can never be disproved.
 *
 * SSR-safe: the server has no network state, so the initial value is always `true`
 * (matching the server-rendered / first-client-paint DOM, where the banner renders
 * nothing). A mount effect corrects it to the real reading and then tracks live changes.
 */

// Two signals, both module-level because they are properties of the network rather than
// of any one component: the link-layer flag, and reachability corroborated from real
// traffic. Online means BOTH.
let linkUp = true;
let reachable = true;
const subscribers = new Set<(v: boolean) => void>();

/**
 * How long an UNCORROBORATED outage stands before it expires back to optimistic.
 *
 * The negative here is a guess, not a reading: one cross-origin failure can be an ad
 * blocker, a dead host, a DNS blip or a request the caller gave up on, none of which mean
 * the device is offline. Without an expiry that guess latched for the whole session,
 * because the app then STOPS making the requests that would disprove it —
 * `hooks/use-concierge-chat.ts` refuses to send while `online` is false, so the concierge
 * could never produce the evidence that clears its own false negative. The `online` event
 * is no rescue: it does not fire on a link that never dropped.
 *
 * 30s, deliberately shorter than the concierge's own 45s request deadline, so a traveller
 * who was told "you're offline" can retry and actually be heard. A REAL outage re-arms
 * this on the very next failed request, so the cost of guessing wrong the other way is one
 * banner flicker, not a dead feature.
 */
export const REACHABILITY_SUSPECT_MS = 30_000;
let suspectTimer: ReturnType<typeof setTimeout> | null = null;

function publish() {
  const next = linkUp && reachable;
  for (const notify of subscribers) notify(next);
}

function setReachable(next: boolean) {
  if (suspectTimer !== null) {
    clearTimeout(suspectTimer);
    suspectTimer = null;
  }
  // Re-armed on every failure, so a run of them holds the banner open rather than
  // expiring mid-outage; cleared by any success or by a real link-layer transition.
  if (!next) {
    suspectTimer = setTimeout(() => {
      suspectTimer = null;
      setReachable(true);
    }, REACHABILITY_SUSPECT_MS);
  }
  if (reachable === next) return;
  reachable = next;
  publish();
}

// Only CROSS-ORIGIN outcomes are evidence, in both directions. Same-origin requests are
// answered by the service worker's cache, which resolves happily while the network is
// dead (a false positive) and returns Response.error() for a plain miss (a false
// negative) — neither says anything about reachability. Cross-origin requests are
// returned untouched by the worker, and a captive portal's interception of one fails
// CORS, which surfaces as a rejection.
//
// KNOWN CEILING: api.frankfurter.dev is the worker's one stale-while-revalidate
// exception, so a cached rate can resolve cross-origin without touching the network.
// One host, one request per rate read; not worth teaching this module the worker's
// routing table.
function isCrossOrigin(input: RequestInfo | URL): boolean {
  try {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

let witnessInstalled = false;

// One wrapper around `fetch`, installed once, so every network client corroborates
// without any of them knowing this module exists. It observes and re-throws; it never
// alters a result.
function installFetchWitness() {
  if (witnessInstalled || typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return;
  }
  witnessInstalled = true;
  const native = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const crossOrigin = isCrossOrigin(input);
    try {
      const res = await native(input, init);
      if (crossOrigin) setReachable(true);
      return res;
    } catch (err) {
      // An abort is the caller hanging up, not the network failing — React effect
      // cleanups and superseded requests abort constantly. `AbortSignal.timeout()` rejects
      // with `TimeoutError`, NOT `AbortError`, and it is the same statement: OUR deadline
      // ran out. The concierge's is 45s (`hooks/use-concierge-chat.ts` matches on that exact
      // name itself), against a cross-origin Worker, so reading it as an outage took the
      // concierge offline app-wide on one slow answer.
      const name = (err as { name?: unknown } | null)?.name;
      if (crossOrigin && name !== 'AbortError' && name !== 'TimeoutError') setReachable(false);
      throw err;
    }
  };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    installFetchWitness();
    subscribers.add(setOnline);
    linkUp = navigator.onLine;
    setOnline(linkUp && reachable);
    // An 'online' event is a real link-layer transition, so it re-arms the optimistic
    // assumption: the interface is back and reachability is unknown again, to be settled
    // by the next cross-origin outcome. Without that reset one failed request would pin
    // the banner open for the rest of the session.
    const goOnline = () => {
      linkUp = true;
      setReachable(true); // through the setter, so a pending suspicion timer is cleared with it
      publish();
    };
    const goOffline = () => {
      linkUp = false;
      publish();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      subscribers.delete(setOnline);
    };
  }, []);

  return online;
}
