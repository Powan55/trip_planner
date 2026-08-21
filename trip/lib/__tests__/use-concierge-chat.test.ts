// @vitest-environment jsdom
//
// S237 (rewritten S329) — `hooks/use-concierge-chat.ts`, exercised by RENDERING the real hook
// (the renderHook shim over react-dom/client + act, mirrors `use-sync-status.test.ts`).
// `fetch` is injected as a fake returning a real `Response` so the driver's parse path runs
// exactly as in production — no live network.
//
// As of D-234/S329 the concierge turn is ONE `application/json` `{reply, ops}` object, NOT SSE.
// Proves: (1) the reply text lands in the assistant message and the raw `ops` are surfaced on the
// turn (unvalidated — the component validates against live plans); (2) a non-200 JSON error
// surfaces OUR OWN status-class sentence — never the response body (#13) — and drops the empty
// in-flight bubble; (3) `CONCIERGE_URL` unset short-circuits with no fetch; (4) blank/concurrent
// sends are guarded.

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

// A controllable remote gate. v6.0.2 removed send()'s last read of it, so nothing in the hook
// branches on this any more — the mock stays for the transitive importers that do, and `false`
// mirrors the real vitest environment (no firebase env).
const remote = vi.hoisted(() => ({ on: false }));
vi.mock('@/lib/firebase-config', () => ({
  FIREBASE_CONFIG: {},
  isRemoteConfigured: () => remote.on,
  // The hook never calls these two; they exist so transitive importers (ports/outbox) resolve.
  isTripRemoteConfigured: () => false,
  getTripId: () => '',
}));

// #10 — the Worker's Authorization header. Default `{}` mirrors the real vitest environment (no
// firebase ⇒ no session ⇒ no header), so every pre-#10 assertion in this file runs unchanged; ONE
// test flips a session on to prove the header is actually wired to the request.
const workerAuth = vi.hoisted(() => ({ header: {} as Record<string, string>, calls: 0, stall: false }));
vi.mock('@/lib/worker-auth', () => ({
  workerAuthHeader: async () => {
    workerAuth.calls += 1;
    // `stall: true` is the CONCIERGE-4 case: a token refresh against securetoken.googleapis.com
    // that neither resolves nor rejects (captive portal / dead cell handoff). The real
    // `workerAuthHeader` catches rejections but cannot catch a pending promise.
    if (workerAuth.stall) await new Promise(() => {});
    return workerAuth.header;
  },
}));

import { useConciergeChat, buildTripDescriptor, type ChatTurn, type ChatStatus } from '@/hooks/use-concierge-chat';
import { setActiveTripId } from '@/core/storage/gateway';
import { setTripConfig, renameKnownTrip } from '@/core/trips/registry';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// S389-C: the offline pre-check reads the SAME `navigator.onLine` signal as `hooks/use-online.ts`
// (S154). Set it BEFORE rendering — the hook corrects its SSR-safe `true` default in a mount effect.
function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value, writable: true, configurable: true });
}

interface Handle {
  messages: ChatTurn[];
  status: ChatStatus;
  error: string | null;
  send: (m: string) => Promise<void>;
  retry: () => Promise<void>;
  goOnline: () => Promise<void>;
  sendConcurrent: (a: string, b: string) => Promise<void>;
  unmount: () => void;
}

function renderConciergeChat(fetchImpl: typeof fetch): Handle {
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
    get messages() {
      return ref.current!.messages;
    },
    get status() {
      return ref.current!.status;
    },
    get error() {
      return ref.current!.error;
    },
    async send(m: string) {
      await act(async () => {
        await ref.current!.send(m);
      });
    },
    async retry() {
      await act(async () => {
        await ref.current!.retry();
      });
    },
    async goOnline() {
      setNavigatorOnLine(true);
      await act(async () => {
        window.dispatchEvent(new Event('online'));
        await Promise.resolve();
      });
    },
    async sendConcurrent(a: string, b: string) {
      await act(async () => {
        const p1 = ref.current!.send(a);
        const p2 = ref.current!.send(b);
        await Promise.all([p1, p2]);
      });
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('useConciergeChat (S329 — {reply, ops} JSON envelope)', () => {
  beforeEach(() => {
    localStorage.clear(); // #10: the account-gate tests drive the real registry/pointer
    gate.url = 'https://concierge.example.workers.dev';
    remote.on = false; // the environment every pre-#10 test was written against
    setNavigatorOnLine(true); // every pre-S389 test in this file assumes a connection
  });

  it('parses the JSON reply into the assistant message and surfaces the raw ops on the turn', async () => {
    const ops = [
      { type: 'addItem', date: '2026-12-20', title: 'Ramen dinner', category: 'food', startMinutes: 1140 },
    ];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'Added a ramen dinner idea for you.', ops }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('Plan me a ramen dinner on the 20th');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://concierge.example.workers.dev');
    expect((init.headers as Record<string, string>)['X-Trip-Token']).toEqual(expect.any(String));
    expect(JSON.parse(init.body as string)).toMatchObject({ message: 'Plan me a ramen dinner on the 20th' });

    expect(h.status).toBe('idle');
    expect(h.error).toBeNull();
    expect(h.messages[0]).toEqual({ role: 'user', content: 'Plan me a ramen dinner on the 20th' });
    expect(h.messages[1].role).toBe('assistant');
    expect(h.messages[1].content).toBe('Added a ramen dinner idea for you.');
    expect(h.messages[1].ops).toEqual(ops);
    h.unmount();
  });

  it('#10 — attaches NO authorization header when there is no session', async () => {
    workerAuth.calls = 0;
    workerAuth.header = {};
    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('hello');

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect('authorization' in headers).toBe(false);
    // The trip token is unchanged — the new header sits BESIDE it, it does not replace it.
    expect(headers['X-Trip-Token']).toEqual(expect.any(String));
    expect(workerAuth.calls).toBe(1); // the seam really ran (an empty header is not a skipped one)
    h.unmount();
  });

  it('#10 — attaches the bearer token beside X-Trip-Token once there IS a session', async () => {
    workerAuth.header = { authorization: 'Bearer id-token-xyz' };
    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('hello');

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer id-token-xyz');
    expect(headers['X-Trip-Token']).toEqual(expect.any(String));
    expect(headers['content-type']).toBe('application/json');
    workerAuth.header = {};
    h.unmount();
  });

  it('a token refresh that STALLS still ends the turn — the abort ceiling covers the turn, not just the fetch', async () => {
    // The signal used to be constructed inside the `fetchImpl(...)` call, with two unbounded awaits
    // ahead of it (the lazy `import('./itinerary-remote')` and the token refresh). A stall in either
    // meant `send()` never settled, so `finally` never ran: status pinned on 'streaming', sendingRef
    // stuck true, `error` null so the "Try again" row never mounted. Only a reload recovered.
    workerAuth.stall = true;
    // `AbortSignal.timeout` is a real 45 s timer that vitest's fake timers do not reach (see the
    // `toFake: ['Date']` note in concierge-digest.test.ts) — so the ceiling itself is stubbed short.
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('signal timed out', 'TimeoutError')), 10);
      return c.signal;
    });
    // A fetch double that HONOURS the signal the way the real one does: reject with its reason.
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const s = init.signal as AbortSignal;
          if (s.aborted) reject(s.reason);
          else s.addEventListener('abort', () => reject(s.reason), { once: true });
        }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    const outcome = await Promise.race([
      h.send('hello').then(() => 'settled'),
      new Promise((r) => setTimeout(() => r('HUNG'), 3000)),
    ]);

    expect(outcome).toBe('settled'); // before the fix this promise never resolved
    expect(h.status).toBe('error');
    expect(h.error).toContain('took too long');
    expect(h.messages).toEqual([{ role: 'user', content: 'hello' }]);

    timeoutSpy.mockRestore();
    workerAuth.stall = false;
    h.unmount();
  });

  it('pure-chat reply (ops: []) surfaces an empty ops array', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'Kathmandu is chilly in December — pack layers.', ops: [] }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('What should I pack?');

    expect(h.messages[1].content).toBe('Kathmandu is chilly in December — pack layers.');
    expect(h.messages[1].ops).toEqual([]);
    expect(h.status).toBe('idle');
    h.unmount();
  });

  // CHANGED DELIBERATELY. This used to be `'a malformed body (no reply/ops) degrades to an empty
  // reply + empty ops, not an error'` and asserted `status === 'idle'` with an empty message — a
  // chosen contract, but one that rendered a FAILED turn as a successful one: a blank grey bubble,
  // no error row, no "Try again", and that empty turn shipped as history on every later turn. The
  // canonical producer of a 200-that-isn't-the-envelope is a captive portal or an interposing
  // proxy, i.e. the same "foreign mobile data" case the rest of this file treats as normal.
  it('a 200 whose body is not the {reply, ops} envelope is an ERROR turn, not an empty bubble', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('not json at all', { status: 200, headers: { 'content-type': 'text/plain' } }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('hello');

    expect(h.status).toBe('error');
    expect(h.error).toContain('Try again'); // the retry row mounts, which is the whole point
    expect(h.messages).toEqual([{ role: 'user', content: 'hello' }]); // the blank bubble is popped
    h.unmount();
  });

  it('…and so is a 200 that parses but carries no string reply (a 200 {"error":…})', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: 'upstream exploded' })) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('hello');

    expect(h.status).toBe('error');
    expect(h.error).not.toContain('upstream exploded'); // #13 still holds: never the body's words
    h.unmount();
  });

  it('two byte-identical ops in one reply are deduped on arrival — they are one proposal', async () => {
    // The chip key is content-derived (`${turnIndex}::${JSON.stringify(op)}`, concierge-chat.tsx)
    // so it survives validateOps re-running each render. Two equal ops therefore shared ONE key:
    // both chips rendered under it, Confirm on either resolved both, one applyOp ran, and the
    // second proposal vanished with no chip, no undo entry and no "didn't match" line.
    const op = { type: 'addItem', date: '2026-12-20', title: 'Ramen', category: 'food' };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'Twice, apparently.', ops: [op, { ...op }, { type: 'removeItem', itemId: 'x' }] }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('add ramen on the 20th');

    expect(h.messages[1].ops).toEqual([op, { type: 'removeItem', itemId: 'x' }]);
    h.unmount();
  });

  // ── #13 — a non-2xx says OUR sentence, never the body's ────────────────────────────────────
  // CHANGED DELIBERATELY. This test used to assert `h.error === 'missing trip token'`, i.e. the
  // Worker's own `{error}` string rendered verbatim. The Worker writes every one of those strings
  // itself (`worker/src/index.ts::jsonError`), but the status code does not separate the readable
  // ones from the machine ones — 401 is `missing trip token` (jargon, and D-239 bans an unqualified
  // "token" in UI copy) while the one genuinely traveller-ready sentence sits on the 502 — and the
  // client cannot tell our Worker's body from a proxy's anyway. So the body is no longer read.
  it('#13 — a non-200 says our own sentence, never the response body, and drops the empty bubble', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: 'missing trip token' }, 401),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('hello');

    expect(h.status).toBe('error');
    expect(h.error).not.toContain('missing trip token');
    expect(h.error).toContain('Sign in again'); // an auth failure gets the action that can fix it…
    expect(h.messages).toEqual([{ role: 'user', content: 'hello' }]);
    h.unmount();
  });

  it('#13 — the copy follows the status CLASS: too-long, auth, and everything else differ', async () => {
    const at = async (status: number) => {
      const h = renderConciergeChat(
        vi.fn(async () => jsonResponse({ error: 'context must be a string' }, status)) as unknown as typeof fetch,
      );
      await h.send('hello');
      const text = h.error!;
      h.unmount();
      return text;
    };

    expect(await at(413)).toBe('That message was too long to send. Shorten it and try again.');
    expect(await at(403)).toContain('Sign in again');
    expect(await at(502)).toBe('The concierge is having trouble right now. Try again in a moment.');
    // …and no status leaks the body it came with.
    for (const status of [400, 401, 403, 405, 413, 429, 500, 502]) {
      expect(await at(status)).not.toContain('context must be a string');
    }
  });

  // The defect the issue names: a dead/unreachable provider while the device believes it is ONLINE
  // (Worker deleted, DNS/TLS failure, CORS rejection) rejects with `TypeError: Failed to fetch`,
  // and that exact machine string used to reach the traveller through the catch's `err.message`.
  it('#13 — a dead provider while online never shows the raw "Failed to fetch"', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch'); // what a real browser rejects with
    }) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('what is on for tomorrow?');

    expect(fetchImpl).toHaveBeenCalledTimes(1); // ← online: the request really was attempted
    expect(h.status).toBe('error');
    expect(h.error).not.toContain('Failed to fetch');
    expect(h.error).toBe('The concierge couldn’t be reached. Check your connection and try again.');
    expect(h.messages).toEqual([{ role: 'user', content: 'what is on for tomorrow?' }]);
    h.unmount();
  });

  it('S362: the POST carries an abort signal, so a hung upstream cannot pin the UI in streaming', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'ok', ops: [] }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('hello');

    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal!.aborted).toBe(false); // a fast reply is never aborted
    h.unmount();
  });

  it('S362: a timeout abort surfaces a FRIENDLY error and pops the empty bubble, not a raw DOMException', async () => {
    // What AbortSignal.timeout(CHAT_TIMEOUT_MS) actually rejects fetch with. Raw, its message is
    // "signal timed out" — useless to a traveler, so the hook swaps in its own text.
    const fetchImpl = vi.fn(async () => {
      throw new DOMException('signal timed out', 'TimeoutError');
    }) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('what should I do tomorrow evening?');

    expect(h.status).toBe('error');
    expect(h.error).toBe('The concierge took too long to respond. Try again.');
    expect(h.error).not.toContain('signal timed out');
    // The in-flight assistant bubble is popped — the user is left with their own message only.
    expect(h.messages).toEqual([{ role: 'user', content: 'what should I do tomorrow evening?' }]);
    h.unmount();
  });

  it('short-circuits to an error with no fetch call when the concierge is unconfigured', async () => {
    gate.url = '';
    const fetchImpl = vi.fn();
    const h = renderConciergeChat(fetchImpl as unknown as typeof fetch);
    await h.send('hello');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(h.status).toBe('error');
    expect(h.error).toBe('Concierge is not configured.');
    h.unmount();
  });

  it('ignores a blank/whitespace-only send, and a concurrent second send while one is in flight', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'ok', ops: [] }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);

    await h.send('   ');
    expect(fetchImpl).not.toHaveBeenCalled();

    await h.sendConcurrent('first', 'second while streaming');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.messages[0]).toEqual({ role: 'user', content: 'first' });
    expect(h.messages[1].content).toBe('ok');
    h.unmount();
  });

  // ── S389-C — offline send + retry ──────────────────────────────────────────────────────────
  // The load-bearing assertion is `fetchImpl` NOT being called. A test that only checked the copy
  // would pass on code that still hits the network and merely dresses up the rejection afterwards
  // — which is the shape of the defect (the raw browser `TypeError: Failed to fetch` reached the
  // traveller through the catch's `err.message` pass-through).
  it('S389-C: an offline send never touches the network and says so in plain words', async () => {
    setNavigatorOnLine(false);
    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('add ramen to the 20th');

    expect(fetchImpl).not.toHaveBeenCalled(); // ← the point: no request left the device
    expect(h.status).toBe('error');
    expect(h.error).toContain('offline');
    expect(h.error).not.toContain('Failed to fetch');
    // Nothing was sent, so no user turn and no blank in-flight assistant bubble are left behind.
    expect(h.messages).toEqual([]);
    h.unmount();
  });

  // ── #13 — the other half of the same defect ────────────────────────────────────────────────
  // The online-but-dead TypeError case is asserted above, against the exact sentence
  // (`a dead provider while online never shows the raw "Failed to fetch"`). Two earlier specs
  // stood here and were removed rather than reconciled: one duplicated that case with a looser
  // substring, and the other asserted that a Worker `{error}` body reaches the traveller
  // unchanged — which is the behaviour `statusMessage` deliberately replaced. Its rationale and
  // the spec that pins it ("no status leaks the body it came with") are above; keeping a test
  // asserting the old contract would have made the suite disagree with itself.

  it('S389-C: "Try again" re-sends the last attempted turn once the connection is back', async () => {
    setNavigatorOnLine(false);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'Added it.', ops: [] }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('add ramen to the 20th');
    expect(fetchImpl).not.toHaveBeenCalled();

    await h.goOnline();
    await h.retry();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({ message: 'add ramen to the 20th' });
    expect(h.status).toBe('idle');
    expect(h.error).toBeNull();
    expect(h.messages[0]).toEqual({ role: 'user', content: 'add ramen to the 20th' });
    expect(h.messages[1].content).toBe('Added it.');
    h.unmount();
  });

  it('S389-C: retry re-sends a turn that failed at the SERVER too, not just an offline one', async () => {
    // One control covers every error the panel can show — the last attempted message is recorded
    // before the request, so a 500 is as retryable as a lost connection.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'upstream exploded' }, 500))
      .mockResolvedValueOnce(jsonResponse({ reply: 'second time lucky', ops: [] })) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('what is on for tomorrow?');
    // #13, changed deliberately: this asserted `h.error === 'upstream exploded'` — the response
    // body, verbatim. Our own Worker emits no 500 at all, so a 500 body is machine text from
    // something else in the path. What the retry control needs is that an error is SHOWN.
    expect(h.error).toBe('The concierge is having trouble right now. Try again in a moment.');
    expect(h.error).not.toContain('upstream exploded');

    await h.retry();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(h.status).toBe('idle');
    // The failed turn left only the user's message; the retry appends a fresh user+assistant pair.
    expect(h.messages.at(-1)!.content).toBe('second time lucky');
    h.unmount();
  });

  it('S363: parses `model` onto the assistant turn when the Worker sends one', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'Try Ichiran in Shibuya.', ops: [], model: 'gemini-2.5-flash-lite' }),
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('Where should I eat ramen?');

    expect(h.messages[1].model).toBe('gemini-2.5-flash-lite');
    h.unmount();
  });

  it('S363/R3: a reply with no `model` leaves it undefined, and does not throw or surface an error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ reply: 'Try Ichiran in Shibuya.', ops: [] }), // the real deployed (v1.4.0) shape
    ) as unknown as typeof fetch;

    const h = renderConciergeChat(fetchImpl);
    await h.send('Where should I eat ramen?');

    expect(h.messages[1].model).toBeUndefined();
    expect(h.status).toBe('idle'); // no throw surfaced as an error state
    expect(h.error).toBeNull();
    h.unmount();
  });

  it('S363/R3: a blank or non-string `model` also collapses to undefined, never an empty badge', async () => {
    const blank = vi.fn(async () =>
      jsonResponse({ reply: 'ok', ops: [], model: '   ' }),
    ) as unknown as typeof fetch;
    const h1 = renderConciergeChat(blank);
    await h1.send('hello');
    expect(h1.messages[1].model).toBeUndefined();
    h1.unmount();

    const wrongType = vi.fn(async () =>
      jsonResponse({ reply: 'ok', ops: [], model: 42 }),
    ) as unknown as typeof fetch;
    const h2 = renderConciergeChat(wrongType);
    await h2.send('hello');
    expect(h2.messages[1].model).toBeUndefined();
    h2.unmount();
  });
});

// ── S395 / owner ruling Q6 — the `trip` descriptor on the wire ───────────────────────────────
//
// `@/core/trips` is deliberately NOT mocked here: these tests drive the real gateway pointer +
// trip registry through jsdom's localStorage, so what they exercise is the same resolution path
// the browser runs. The load-bearing assertions are (a) the ABSENCE of the key on the default
// trip and (b) the EXACT key set when it is present — an over-broad descriptor is a body-budget
// regression that only shows up as a 413 on a long conversation.
describe('S395 — the trip descriptor on the POST body', () => {
  const CUSTOM = {
    start: '2027-03-01',
    end: '2027-03-05',
    destinations: ['Reykjavik'],
    vibe: 'mountain',
    currency: 'ISK',
    updatedAt: 1000,
  };

  function useCustomTrip(name: string) {
    setTripConfig('custom-iceland', CUSTOM);
    renameKnownTrip('custom-iceland', name);
    setActiveTripId('custom-iceland');
  }

  function bodyOf(fetchImpl: unknown) {
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    return JSON.parse(init.body as string) as Record<string, unknown>;
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    gate.url = 'https://concierge.example.workers.dev';
    remote.on = false; // #10 — each account-gate case sets its own build shape
    setNavigatorOnLine(true);
  });

  it('the DEFAULT trip sends NO `trip` key at all — the Worker keeps its richer N×J persona', async () => {
    // Not `trip: null`, not `trip: {label:'Nepal × Japan 2026'…}`: ABSENT. `buildSystemPrompt(null)`
    // (worker/src/providers.ts) is the prompt that still carries LOCAL_KNOWLEDGE (Thamel, the last
    // train); sending a descriptor here would downgrade the one trip that has a concierge today.
    expect(buildTripDescriptor()).toBeNull();

    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;
    const h = renderConciergeChat(fetchImpl);
    await h.send('what is on tomorrow?');

    const body = bodyOf(fetchImpl);
    expect('trip' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['context', 'history', 'message']);
    h.unmount();
  });

  it('a CUSTOM trip sends exactly { label, start, end } — the Worker `normalizeTrip` shape', async () => {
    useCustomTrip('Iceland ring road');
    expect(buildTripDescriptor()).toEqual({
      label: 'Iceland ring road',
      start: '2027-03-01',
      end: '2027-03-05',
    });

    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;
    const h = renderConciergeChat(fetchImpl);
    await h.send('where should I eat?');

    const body = bodyOf(fetchImpl);
    // The exact key set, not just a subset: `vibe`/`legs`/`currency`/`id` are ignored by the
    // Worker and would be pure body-budget waste, so adding one must fail here.
    expect(Object.keys(body.trip as object).sort()).toEqual(['end', 'label', 'start']);
    expect(body.trip).toEqual({ label: 'Iceland ring road', start: '2027-03-01', end: '2027-03-05' });
    h.unmount();
  });

  it("#10: an UNKNOWN custom trip (pointer set, never joined) is refused — no digest, no fetch", async () => {
    // The registry does not know this id: nothing ever joinTrip'd it, so it is not on the
    // account. The refusal must happen BEFORE any request forms — the load-bearing assertion is
    // fetchImpl never being called, same shape as the S389-C offline test.
    setActiveTripId('ghost-trip-nobody-joined');

    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;
    const h = renderConciergeChat(fetchImpl);
    await h.send('plan my day');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(h.status).toBe('error');
    expect(h.error).toBe("This trip isn't on your account, so the concierge can't help with it.");
    expect(h.messages).toEqual([]); // no user turn, no blank in-flight bubble
    h.unmount();
  });

  it('#10: a KNOWN custom trip still sends (the registry entry is what admits it)', async () => {
    useCustomTrip('Iceland ring road'); // setTripConfig + rename register it in the registry
    remote.on = true; // a configured build: a registered custom trip has always sent, and still does

    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;
    const h = renderConciergeChat(fetchImpl);
    await h.send('where should I eat?');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.status).toBe('idle');
    h.unmount();
  });

  it('v6.0.2: the DEFAULT trip sends — the sample is a concierge trip again', async () => {
    // v6.0.0 refused here whenever firebase was configured, which is every deployed build, so the
    // concierge was dead on the trip a first-time visitor lands on. send() no longer reads that
    // gate at all, which is why this sets it and asserts the SAME outcome the default `false`
    // gives: the sample sends either way now, and that equivalence IS the fix.
    remote.on = true; // the deployed-site shape; the hook is now blind to it
    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;
    const h = renderConciergeChat(fetchImpl);
    await h.send('plan my day');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.status).toBe('idle');
    expect(h.error).toBeNull();
    // The sample sends NO `trip` descriptor, which is what selects the Worker's rich built-in
    // persona — the one that actually describes this pack. Absent, never null.
    expect(bodyOf(fetchImpl)).not.toHaveProperty('trip');
    h.unmount();
  });

  it('an unbounded trip name is cut to the Worker`s TRIP_LABEL_MAX (120) BEFORE it leaves the device', async () => {
    // `renameKnownTrip` (core/trips/registry.ts) imposes no length bound, so this is reachable.
    // The Worker truncates too, but its 16 KB 413 runs on the RAW body first — only a client-side
    // bound keeps the worst-case body computable.
    useCustomTrip('Z'.repeat(500));

    const fetchImpl = vi.fn(async () => jsonResponse({ reply: 'ok', ops: [] })) as unknown as typeof fetch;
    const h = renderConciergeChat(fetchImpl);
    await h.send('hi');

    const trip = bodyOf(fetchImpl).trip as { label: string };
    expect(trip.label).toHaveLength(120);
    expect(trip.label).toBe('Z'.repeat(120));
    h.unmount();
  });
});
