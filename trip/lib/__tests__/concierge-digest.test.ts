// @vitest-environment jsdom
//
// S244 — the trip-context digest (`hooks/use-concierge-chat.ts::buildTripDigest`, not exported;
// exercised indirectly via a real `send()` call, mirroring `use-concierge-chat.test.ts`'s driver).
// Proves: the POST body carries a `context` field built from the SAME storage path
// `components/itinerary-provider.tsx` uses (`itineraryStoragePort.load()`), capped at 1500 chars,
// and that `history` sent on the wire is capped at the last 12 turns.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const gate = vi.hoisted(() => ({ url: 'https://concierge.example.workers.dev' }));
vi.mock('@/lib/concierge-config', () => ({
  get CONCIERGE_URL() {
    return gate.url;
  },
  isConciergeConfigured: () => Boolean(gate.url),
}));

import { useConciergeChat } from '@/hooks/use-concierge-chat';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function renderConciergeChat(fetchImpl: typeof fetch) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref: { current: ReturnType<typeof useConciergeChat> | null } = { current: null };

  function Probe() {
    ref.current = useConciergeChat(fetchImpl);
    return null;
  }
  act(() => {
    root.render(createElement(Probe));
  });

  return {
    async send(m: string) {
      await act(async () => {
        await ref.current!.send(m);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('trip-context digest (S244)', () => {
  beforeEach(() => {
    gate.url = 'https://concierge.example.workers.dev';
    window.localStorage.clear();
  });

  it('sends a capped plain-text context digest alongside the message', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('What should I pack?');

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string) as { message: string; history: unknown[]; context: string };

    expect(typeof body.context).toBe('string');
    expect(body.context.length).toBeLessThanOrEqual(9500); // DIGEST_CAP raised 7000→9500 (S362)
    expect(body.context).toContain('Trip:');
    // S362: the wire really carries the enriched per-item encoding, not just the titles. Pinned on
    // the header line the Worker's system prompt is written against, plus a real timed seed item.
    expect(body.context).toContain('Each item is "HH:MM category Title #id".');
    expect(body.context).toContain('05:30 transportation Depart Syracuse');
    console.log('--- assembled digest sample (first 400 chars) ---\n' + body.context.slice(0, 400));

    h.unmount();
  });

  it('caps outgoing history at the last 12 turns', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    // 14 turns of send/receive so historyRef accumulates 28 ChatTurn entries before the 15th send.
    for (let i = 0; i < 14; i++) {
      await h.send(`turn ${i}`);
    }

    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(call[1].body as string) as { history: unknown[] };
    expect(body.history.length).toBeLessThanOrEqual(12);

    h.unmount();
  });

  it('S362: a long conversation is bounded by CHARACTERS too, so the whole body clears the 16 KB 413', async () => {
    // The turn cap alone bounds the COUNT, not the size — 12 long turns plus a 9000-char digest is
    // exactly the combination that would have started 413ing at the Worker's MAX_BODY_BYTES once
    // DIGEST_CAP went 7000 → 9000. This asserts on the REAL wire body, not on `capHistory` alone.
    const fetchImpl = vi.fn(async () =>
      new Response(sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    const long = 'pasted itinerary blob '.repeat(40); // ~880 chars per user turn
    for (let i = 0; i < 14; i++) await h.send(`${i} ${long}`);

    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [
      string,
      RequestInit,
    ];
    const raw = call[1].body as string;
    const body = JSON.parse(raw) as { history: { content: string }[] };

    expect(JSON.stringify(body.history).length).toBeLessThanOrEqual(3000); // HISTORY_CHAR_CAP
    expect(body.history.length).toBeLessThan(12); // the char bound bit before the turn cap did
    // Oldest-dropped-first: the 13th send's user turn survives, the 1st send's does not. (The
    // assistant turns are empty here — this stub returns an SSE body the JSON parser rejects.)
    const userTurns = body.history.filter((t) => t.content !== '').map((t) => t.content);
    expect(userTurns.at(-1)).toContain('12 pasted itinerary blob');
    expect(userTurns.some((c) => c.startsWith('0 '))).toBe(false);
    // The end of the line: the whole serialized POST body clears the Worker's 413 ceiling.
    expect(new TextEncoder().encode(raw).length).toBeLessThan(16 * 1024);

    h.unmount();
  });
});
