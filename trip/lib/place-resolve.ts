// Client caller for the Worker's `GET /resolve?url=…` place-link resolver ( plan
// `docs/plans/place-link-import-plan.md`). Reuses the concierge client's worker-origin/token
// plumbing: the same deployed Worker (`CONCIERGE_URL` from `lib/concierge-config.ts`) and the same
// `x-trip-token: getActiveTripId()` header the chat route uses ( — token-possession IS
// the authorization). No new secret, no new dependency.
//
// NEVER THROWS — degrades to `null` on ANY failure (unconfigured Worker, 404/non-200, timeout,
// abort, bad JSON, `ok:false`). This total contract is WHY ships before the Worker's
// `/resolve` route exists: with `CONCIERGE_URL` unset (today's dormant default) this returns
// `null` immediately, so the import sheet simply falls back to manual entry — never a dead end.
// The client treats every returned field as a best-effort hint.

import { CONCIERGE_URL } from '@/lib/concierge-config';
import { getActiveTripId } from '@/core/storage/gateway';
import { workerAuthHeader } from '@/lib/worker-auth';

/** Best-effort resolution hints. Every field optional — the sheet pre-fills whatever it gets. */
export interface PlaceResolveHints {
  finalUrl?: string;
  name?: string;
  lat?: number;
  lng?: number;
}

function cleanStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}
function cleanNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export interface ResolveOptions {
  /** Injectable for tests (mirrors `use-concierge-chat`'s `fetchImpl`). */
  fetchImpl?: typeof fetch;
  /** The Worker origin. Defaults to the configured concierge URL; overridable for tests. */
  origin?: string;
  /** Abort timeout in ms. */
  timeoutMs?: number;
}

/**
 * Resolve a Google place link into pre-fill hints, or `null` when nothing usable came back.
 * TOTAL — never throws (see the module note). Returns `null` synchronously when the Worker is not
 * configured, so the dormant build makes NO network call.
 */
export async function resolvePlaceLink(
  url: string,
  { fetchImpl = fetch, origin = CONCIERGE_URL, timeoutMs = 8000 }: ResolveOptions = {},
): Promise<PlaceResolveHints | null> {
  if (!origin || !url) return null;
  const base = origin.replace(/\/+$/, '');
  try {
    // #10 — same Worker, same new requirement: a Firebase ID token when there is a session, and
    // nothing at all when there isn't (see lib/worker-auth.ts). Inside the try, so a failure here
    // degrades to `null` like every other one rather than throwing out of a total function.
    const auth = await workerAuthHeader();
    const res = await fetchImpl(`${base}/resolve?url=${encodeURIComponent(url)}`, {
      method: 'GET',
      headers: { 'X-Trip-Token': getActiveTripId(), ...auth },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    if (!data || data.ok !== true) return null;
    return {
      finalUrl: cleanStr(data.finalUrl),
      name: cleanStr(data.name),
      lat: cleanNum(data.lat),
      lng: cleanNum(data.lng),
    };
  } catch {
    return null;
  }
}
