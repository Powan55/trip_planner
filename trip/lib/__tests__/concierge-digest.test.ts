// @vitest-environment jsdom
//
// S244 — the trip-context digest (`hooks/use-concierge-chat.ts::buildTripDigest`, not exported;
// exercised indirectly via a real `send()` call, mirroring `use-concierge-chat.test.ts`'s driver).
// Proves: the POST body carries a `context` field built from the SAME storage path
// `components/itinerary-provider.tsx` uses (`itineraryStoragePort.load()`), capped at 1500 chars,
// and that `history` sent on the wire is capped at the last 12 turns.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { ITINERARY_STORAGE_KEY } from '../itinerary-storage';
import type { DayPlan } from '../trip-data';

const gate = vi.hoisted(() => ({ url: 'https://concierge.example.workers.dev' }));
vi.mock('@/lib/concierge-config', () => ({
  get CONCIERGE_URL() {
    return gate.url;
  },
  isConciergeConfigured: () => Boolean(gate.url),
}));

import { useConciergeChat } from '@/hooks/use-concierge-chat';

// The stub used to answer with an SSE body — a leftover from before D-234 made the turn ONE
// `{reply, ops}` JSON object. It only survived because a 200-that-isn't-the-envelope used to
// degrade to an empty reply and an 'idle' status; that is now an error turn, and an error turn does
// not append to `historyRef` — which is the exact thing the two history tests below measure.
function jsonEnvelope(reply: string): Response {
  return new Response(JSON.stringify({ reply, ops: [] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
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
      jsonEnvelope('ok'),
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
    // the header line that teaches the model the format, plus a real timed seed item.
    // #12: both moved from 24-hour to 12-hour.
    expect(body.context).toContain('Each item is "h:mm AM/PM category Title #id".');
    expect(body.context).toContain('5:29 AM transportation Depart Syracuse');
    console.log('--- assembled digest sample (first 400 chars) ---\n' + body.context.slice(0, 400));

    h.unmount();
  });

  it('caps outgoing history at the last 12 turns', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonEnvelope('ok'),
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
    // Exactly 12, not "≤ 12": with the old SSE stub every turn failed, so `historyRef` never grew
    // and this assertion was satisfied by a history of length 0.
    expect(body.history.length).toBe(12);

    h.unmount();
  });

  it('S362: a long conversation is bounded by CHARACTERS too, so the whole body clears the 16 KB 413', async () => {
    // The turn cap alone bounds the COUNT, not the size — 12 long turns plus a 9000-char digest is
    // exactly the combination that would have started 413ing at the Worker's MAX_BODY_BYTES once
    // DIGEST_CAP went 7000 → 9000. This asserts on the REAL wire body, not on `capHistory` alone.
    const fetchImpl = vi.fn(async () =>
      jsonEnvelope('ok'),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    const long = 'pasted itinerary blob '.repeat(40); // ~880 chars per user turn
    for (let i = 0; i < 14; i++) await h.send(`${i} ${long}`);

    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [
      string,
      RequestInit,
    ];
    const raw = call[1].body as string;
    const body = JSON.parse(raw) as { history: { role: string; content: string }[] };

    expect(JSON.stringify(body.history).length).toBeLessThanOrEqual(3000); // HISTORY_CHAR_CAP
    expect(body.history.length).toBeLessThan(12); // the char bound bit before the turn cap did
    // Oldest-dropped-first: the 13th send's user turn survives, the 1st send's does not. Selected
    // by `role` — the stub answers a real envelope now, so the assistant turns carry text too.
    const userTurns = body.history.filter((t) => t.role === 'user').map((t) => t.content);
    expect(userTurns.at(-1)).toContain('12 pasted itinerary blob');
    expect(userTurns.some((c) => c.startsWith('0 '))).toBe(false);
    // The end of the line: the whole serialized POST body clears the Worker's 413 ceiling.
    expect(new TextEncoder().encode(raw).length).toBeLessThan(16 * 1024);

    h.unmount();
  });
});

// ── #12: the clock and the time format, checked on the WIRE ────────────────────────────────
//
// Both halves of #12 are things the model is TOLD, so the only assertion that means anything is
// one on the JSON body that actually leaves the device. `lib/__tests__/concierge-digest-s327.ts`
// covers the same ground against `buildTripDigest()` directly; this file is the end of the wire.
//
// `toFake: ['Date']` and not a full fake-timer install: `send()` is async and takes an
// `AbortSignal.timeout`, so faking setTimeout/queueMicrotask here would hang the test rather than
// test anything. Only Date needs to move.
describe('#12: the digest carries the real current date and time, and 12-hour times', () => {
  beforeEach(() => {
    gate.url = 'https://concierge.example.workers.dev';
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    // The ?today= test below persists its override to sessionStorage and rewrites the URL. Undo
    // both here rather than at the end of that test, so a failure cannot leak a simulated clock.
    window.history.replaceState({}, '', '/');
    window.sessionStorage.clear();
  });

  const okStream = () =>
    vi.fn(async () =>
      jsonEnvelope('ok'),
    ) as unknown as typeof fetch;

  /** The `context` string as the Worker would receive it, from one real `send()`. */
  async function contextOnTheWire(): Promise<string> {
    const fetchImpl = okStream();
    const h = renderConciergeChat(fetchImpl);
    await h.send('what should I do tonight?');
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    h.unmount();
    return (JSON.parse(init.body as string) as { context: string }).context;
  }

  function seed(plans: DayPlan[]) {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(plans));
  }

  // THE REPORTED BUG. Asked in August, the assistant answered as if it were December 9, because
  // the date line was only built when today fell inside Dec 9 to Jan 9, and outside it the digest
  // went out with no date at all, leaving the first day of the trip as the model's only anchor.
  it('BEFORE the trip window: the wire carries the real date, not silence', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-10T12:00:00Z'));

    const context = await contextOnTheWire();
    expect(context).toContain('Today is 2026-08-10 5:45 PM (before the trip).');
    expect(context).not.toContain('Day 1 of 32'); // the wrong answer it used to fall back to
  });

  it('INSIDE the trip window: the real date, the time, and where that sits in the trip', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-15T12:00:00Z')); // Nepal leg, +345 → 17:45 local

    // Dec 15 reads Chitlang since the Nepal rebuild put the Chandragiri/Chitlang day here; it was
    // Kathmandu before. Day 7 of 32 is unchanged (Dec 9..Dec 15 inclusive).
    expect(await contextOnTheWire()).toContain('Today is 2026-12-15 5:45 PM (Day 7 of 32, Chitlang).');
  });

  it('AFTER the trip window: still a real date, and it says the trip is over', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-03-04T12:00:00Z')); // clamps to the last leg, Japan +540

    const context = await contextOnTheWire();
    expect(context).toContain('Today is 2027-03-04 9:00 PM (after the trip).');
    expect(context).not.toContain('Day 1 of 32');
  });

  it('sends 12-hour times, and gets MIDNIGHT and NOON right (the two a naive %12 breaks)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-15T12:00:00Z'));
    seed([
      {
        date: '2026-12-15',
        city: 'Kathmandu',
        country: 'nepal',
        items: [
          { id: 'z-1', title: 'Midnight bus', category: 'transportation', startMinutes: 0 },
          { id: 'z-2', title: 'Noon dumplings', category: 'food', startMinutes: 720 },
          { id: 'z-3', title: 'Evening walk', category: 'free', startMinutes: 18 * 60 + 30 },
        ],
      },
    ]);

    const context = await contextOnTheWire();
    expect(context).toContain('12:00 AM transportation Midnight bus #z-1'); // not 0:00 AM
    expect(context).toContain('12:00 PM food Noon dumplings #z-2'); // not 12:00 AM
    expect(context).toContain('6:30 PM free Evening walk #z-3'); // the ticket's own example
    expect(context).not.toContain('18:30'); // nothing 24-hour survives on the wire
    expect(context).not.toContain('00:00');
  });

  it('the ?today= simulation override still drives the digest (D-075 stays intact)', async () => {
    // The digest reads the clock through `lib/trip-now.ts` and never `new Date()`, so a simulated
    // day produces a digest FOR that day. `trip-now` resolves the override once per module load
    // and caches it, so this needs a fresh module graph, not just a fresh URL.
    window.history.replaceState({}, '', '/?today=2026-12-20');
    vi.resetModules();
    const { buildTripDigest } = await import('@/hooks/use-concierge-chat');

    // Dec 20 is Day 12, the Japan leg. The override Date is LOCAL NOON of the simulated day, so
    // the time reads 12:00 PM, the same demo-noon convention `getNowUtcMsForPlace` documents.
    expect(buildTripDigest()).toContain('Today is 2026-12-20 12:00 PM (Day 12 of 32,');
  });
});
