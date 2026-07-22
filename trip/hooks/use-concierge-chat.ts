'use client';

import { useCallback, useRef, useState } from 'react';
import { getActiveTripId } from '@/core/storage/gateway';
import { CONCIERGE_URL } from '@/lib/concierge-config';
import { SSELineBuffer, extractDeltaText } from '@/lib/concierge-sse';
import { TRIP_DATE_LABEL, TRIP_DATES } from '@/core/dates/trip-dates';
import { getCityForDate } from '@/core/dates/trip-cities';
import { itineraryStoragePort } from '@/lib/itinerary-ports';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const DIGEST_CAP = 1500;
const HISTORY_CAP = 12;

/**
 * Compact plain-text trip-context digest — sent as `context` alongside each concierge
 * call so the model can answer trip-specific questions without the client hand-rolling a
 * bespoke prompt format. Reads the SAME storage path `components/itinerary-provider.tsx`'s
 * store is built on (`itineraryStoragePort.load()` — the Vault gateway, `core/storage/gateway`
 * beneath it) rather than duplicating the load logic; dates/cities come straight from
 * `core/dates`, so there is exactly one source for each fact. Filters tombstoned
 * items (`deleted === true`) the same way `use-itinerary.ts`'s `visiblePlans` does, since the
 * raw Vault load can carry them under sync. Hard-capped at `DIGEST_CAP` chars (truncate + '…')
 * — this is a token-budget guard for the Worker call, not a data-shape decision.
 */
function buildTripDigest(): string {
  const lines: string[] = [`Trip: ${TRIP_DATE_LABEL}`];

  const plans = itineraryStoragePort.load();
  const byDate = new Map(plans.map((d) => [d.date, d]));

  for (const date of TRIP_DATES) {
    const day = byDate.get(date);
    const city = day?.city ?? getCityForDate(date);
    const items = (day?.items ?? []).filter((i) => i.deleted !== true);
    const titles = items.map((i) => i.title).join(', ');
    lines.push(titles ? `${date} (${city}): ${titles}` : `${date} (${city}): unplanned`);
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

        if (!res.ok || !res.body) {
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

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const buffer = new SSELineBuffer();
        let assembled = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const events = buffer.push(decoder.decode(value, { stream: true }));
          for (const evt of events) {
            const delta = extractDeltaText(evt);
            if (!delta) continue;
            assembled += delta;
            const snapshot = assembled;
            setMessages((prev) => {
              const next = prev.slice();
              next[next.length - 1] = { role: 'assistant', content: snapshot };
              return next;
            });
          }
        }

        historyRef.current = [...history, userTurn, { role: 'assistant', content: assembled }];
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
