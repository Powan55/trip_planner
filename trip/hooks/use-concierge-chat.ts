'use client';

import { useCallback, useRef, useState } from 'react';
import { getActiveTripId } from '@/core/storage/gateway';
import { CONCIERGE_URL } from '@/lib/concierge-config';
import { TRIP_DATE_LABEL, TRIP_DATES } from '@/core/dates/trip-dates';
import { getCityForDate } from '@/core/dates/trip-cities';
import { itineraryStoragePort } from '@/lib/itinerary-ports';
import type { Op } from '@/lib/concierge-ops';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  // the RAW ops the Worker attached to this (assistant) turn, as received — NOT yet
  // validated. Validation is STATE-dependent and must
  // run against the LIVE itinerary at chip-render time, which this hook has no access to; so the
  // consuming component (`concierge-chat.tsx`) runs `validateOps(turn.ops, plans)` before showing a
  // chip. Absent on user turns and on assistant turns that carried no ops (pure chat).
  ops?: Op[];
}

// Client digest char cap. Coupled to the Worker's CONTEXT_TRUNCATE_LENGTH (worker/src/
// providers.ts) — BOTH are CHARACTER caps, and the Worker re-slices `context` to its own
// ceiling before folding it into the system prompt. This cap MUST stay ≤ the Worker ceiling.
// raised BOTH to 7000 (from 2000) so the whole fully-planned 32-day digest —
// measured it at 6517 chars — fits without mid-trip truncation. Keep these two constants equal;
// a higher client cap would ship bytes the server silently discards. (They land + deploy together
// per the coupling; don't raise one without the other.)
const DIGEST_CAP = 7000;
const HISTORY_CAP = 12;

/**
 * Compact plain-text trip-context digest — sent as `context`
 * alongside each concierge call so the model can answer trip-specific questions without the client
 * hand-rolling a bespoke prompt format. Reads the SAME storage path
 * `components/itinerary-provider.tsx`'s store is built on (`itineraryStoragePort.load()` — the
 * Vault gateway, `core/storage/gateway` beneath it) rather than duplicating the load logic;
 * dates/cities come straight from `core/dates`, so there is exactly one source for
 * each fact. Filters tombstoned items (`deleted === true`) the same way `use-itinerary.ts`'s
 * `visiblePlans` does, since the raw Vault load can carry them under sync.
 *
 * format changes (client-only, read-only — no write, no extra request):
 * - Each planned item carries its STABLE `ItineraryItem.id` compactly as ` #<id>` so the agent
 * can address items by real id, never a positional index.
 * - UNPLANNED days are OMITTED entirely instead of printing a `date (city): unplanned` line each
 * (32 empty lines wasted ~hundreds of chars). The header states the full range + that any
 * unlisted date is unplanned, so no information is lost — the model mostly needs the frame plus
 * the PLANNED items. For a realistically-planned trip (many empty days) this reclaims most of
 * the budget for real content.
 * Hard-capped at `DIGEST_CAP` chars (truncate + '…') — a token-budget guard for the Worker call.
 * NOTE: for a FULLY-planned 32-day trip the whole digest still exceeds 2000 chars, so it truncates
 * mid-trip; full-trip visibility is completed by D2/ (raise the coupled server+client caps).
 */
export function buildTripDigest(): string {
  const lines: string[] = [
    `Trip: ${TRIP_DATE_LABEL} (${TRIP_DATES.length} days). Any date not listed below is unplanned. Items tagged #id.`,
  ];

  const plans = itineraryStoragePort.load();
  const byDate = new Map(plans.map((d) => [d.date, d]));

  for (const date of TRIP_DATES) {
    const day = byDate.get(date);
    const items = (day?.items ?? []).filter((i) => i.deleted !== true);
    if (items.length === 0) continue; // omit unplanned days (frame already covers them)
    const city = day?.city ?? getCityForDate(date);
    const entries = items.map((i) => `${i.title} #${i.id}`).join('; ');
    lines.push(`${date} ${city}: ${entries}`);
  }

  const digest = lines.join('\n');
  return digest.length > DIGEST_CAP ? `${digest.slice(0, DIGEST_CAP - 1)}…` : digest;
}

export type ChatStatus = 'idle' | 'streaming' | 'error';

/**
 * Drives one concierge turn against the deployed Worker.
 *
 * SESSION-ONLY HISTORY (a judgment call — flagged in the not nailed down by the
 * brief): messages live in component state only, cleared on reload. says the Worker never
 * persists or logs chat content, and there's no product ask for cross-device history, so adding
 * a new gateway/sync-domain key for this would be scope the brief explicitly said to avoid
 * absent a real need. The in-flight turn's own history (this session's prior turns) IS sent as
 * `ChatRequestBody.history` on each call, so the model has conversational context within a
 * session — that's a pure in-memory pass-through, not persistence.
 *
 * `fetchImpl` is injectable (mirrors `lib/currency-rate.ts`'s `fetchCurrencyRate`) so tests
 * drive the network + stream deterministically — no live call is ever made in a test.
 */
export function useConciergeChat(fetchImpl: typeof fetch = fetch) {
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const historyRef = useRef<ChatTurn[]>([]);
  // A REF (not the `status` state) guards re-entrancy: React batches state updates, so two
  // `send()` calls fired synchronously back-to-back (before a re-render commits) would both read
  // the SAME stale `status` closure value and both slip past a state-only check. A ref mutates
  // immediately, so the second call in the same tick is reliably rejected.
  const sendingRef = useRef(false);

  const send = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || sendingRef.current) return;
      if (!CONCIERGE_URL) {
        setStatus('error');
        setError('Concierge is not configured.');
        return;
      }
      sendingRef.current = true;

      const history = historyRef.current;
      const userTurn: ChatTurn = { role: 'user', content: trimmed };
      setMessages((prev) => [...prev, userTurn, { role: 'assistant', content: '' }]);
      setStatus('streaming');
      setError(null);

      try {
        const context = buildTripDigest();
        const res = await fetchImpl(CONCIERGE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Trip-Token': getActiveTripId() },
          body: JSON.stringify({ message: trimmed, history: history.slice(-HISTORY_CAP), context }),
        });

        if (!res.ok) {
          const raw = await res.text().catch(() => '');
          let reason = `Concierge is unavailable (${res.status}).`;
          try {
            const parsed = JSON.parse(raw) as { error?: string };
            if (parsed.error) reason = parsed.error;
          } catch {
            /* non-JSON error body (or no body) — keep the status-based reason */
          }
          throw new Error(reason);
        }

        // the structured turn returns ONE `application/json` object `{reply, ops}`, not
        // SSE (constrained JSON can't cleanly interleave streamed prose + a terminal ops block).
        // `lib/concierge-sse.ts` is now unused for this route — left in place, flagged for later
        // removal per the brief (do NOT delete this slice).
        const data = (await res.json().catch(() => ({}))) as { reply?: unknown; ops?: unknown };
        const reply = typeof data.reply === 'string' ? data.reply : '';
        // Surface ops RAW (unvalidated) on the assistant turn — the component validates against the
        // LIVE itinerary at chip-render time (see the ChatTurn.ops comment). Keep only a plain array.
        const ops: Op[] = Array.isArray(data.ops) ? (data.ops as Op[]) : [];

        setMessages((prev) => {
          const next = prev.slice();
          next[next.length - 1] = { role: 'assistant', content: reply, ops };
          return next;
        });
        // History carries the reply text only.
        historyRef.current = [...history, userTurn, { role: 'assistant', content: reply }];
        setStatus('idle');
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Concierge is unavailable.');
        // Drop the empty in-flight assistant bubble so the error state doesn't leave a blank turn.
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        sendingRef.current = false;
      }
    },
    [fetchImpl],
  );

  const reset = useCallback(() => {
    historyRef.current = [];
    setMessages([]);
    setStatus('idle');
    setError(null);
  }, []);

  return { messages, status, error, send, reset };
}
