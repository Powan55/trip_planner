// @vitest-environment jsdom
//
// S342 — the REAL `ConciergeChat` panel, driven end to end in jsdom against a stubbed Worker
// response: open the sheet, send a message, and assert what the user actually sees for a turn whose
// ops are PARTLY invalid — the surviving proposal chip AND the new "didn't match the current plan"
// line. Before S342 a dropped op produced nothing at all, which is exactly the "the concierge can't
// modify my plans" symptom reported by the owner (D-234 drops silently by design).
//
// Everything below the component is real: `useConciergeChat`, `validateOps`, `describeOp`. Only the
// network (global fetch), the traveler/config gates and the undo toast are stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { TRIP_DATES } from '@/core/dates';
import { ITINERARY_STORAGE_KEY } from '../itinerary-storage';
import type { DayPlan } from '../trip-data';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/hooks/use-active-traveler', () => ({
  useActiveTraveler: () => ({ traveler: { name: 'Nadia', token: 'nadia-token', accent: '#f0c760' } }),
}));
vi.mock('@/lib/concierge-config', () => ({
  CONCIERGE_URL: 'https://mock.example.workers.dev',
  isConciergeConfigured: () => true,
}));
vi.mock('@/lib/undo-toast', () => ({ showUndoToast: vi.fn() }));

import { ConciergeChat } from '@/components/concierge-chat';

const DAY = TRIP_DATES[3];
const SEED: DayPlan[] = [
  { date: DAY, city: 'Kathmandu', country: 'nepal', items: [{ id: 'seed-1', title: 'Boudhanath Stupa', category: 'sightseeing' }] },
];

function stubFetch(ops: unknown[]) {
  const impl = vi.fn(async () =>
    new Response(JSON.stringify({ reply: 'Here you go.', ops }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', impl);
  return impl;
}

/**
 * Mount the panel and open the sheet. S341 split this out of `drive()` so a test can inspect the
 * panel BETWEEN sends (focus, disabled state) and send more than once.
 */
async function mount(ops: unknown[], fetchImpl?: () => Promise<Response>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  if (fetchImpl) vi.stubGlobal('fetch', vi.fn(fetchImpl));
  else stubFetch(ops);

  await act(async () => {
    root.render(createElement(ConciergeChat));
  });
  // Open the Sheet (its content is portalled into document.body).
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[data-testid="concierge-trigger"]')!.click();
  });

  const input = () => document.querySelector<HTMLInputElement>('[data-testid="concierge-input"]')!;

  return {
    input,
    /** Type + submit the form — what pressing Enter in the input does in a real browser. */
    async send(text: string) {
      const el = input();
      await act(async () => {
        // React controlled input: write through the native setter so React's onChange sees it.
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          'value',
        )!.set!;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await act(async () => {
        el.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
    },
    chips: () => Array.from(document.querySelectorAll('[data-testid="concierge-op-chip"]')),
    droppedLine: () => document.querySelector('[data-testid="concierge-ops-dropped"]'),
    turns: () => Array.from(document.querySelectorAll('[data-testid^="concierge-turn-"]')),
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Mount the panel, open the sheet, and send one message through the real hook. */
async function drive(ops: unknown[]) {
  const h = await mount(ops);
  await h.send('add ramen');
  return h;
}

describe('S342 — silent-drop feedback in the concierge panel', () => {
  beforeEach(() => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(SEED));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders the surviving chip AND one muted line naming how many changes were dropped, and why', async () => {
    const h = await drive([
      { type: 'addItem', date: DAY, title: 'Ramen', category: 'food', startMinutes: 1140 }, // valid
      { type: 'addItem', date: 'Dec 20', title: 'Late ramen', category: 'food' }, // non-ISO → dropped
      { type: 'updateItem', itemId: 'seed', date: DAY, notes: 'x' }, // truncated id → dropped
    ]);

    expect(h.chips()).toHaveLength(1);
    expect(h.chips()[0].textContent).toContain('Ramen');
    // #13 — the count line now carries the REASONS. Two different causes → two clauses, in the
    // order the ops arrived. (Pre-#13 this read "…didn’t match the current plan." and stopped.)
    expect(h.droppedLine()?.textContent).toBe(
      '2 suggested changes didn’t match the current plan: it named a day outside the trip; the plan it pointed at isn’t on your itinerary.',
    );
    h.unmount();
  });

  it('singularises the line for exactly one dropped op', async () => {
    const h = await drive([{ type: 'addItem', date: 'Dec 20', title: 'Late ramen', category: 'food' }]);
    expect(h.chips()).toHaveLength(0);
    expect(h.droppedLine()?.textContent).toBe(
      '1 suggested change didn’t match the current plan: it named a day outside the trip.',
    );
    h.unmount();
  });

  // #13 — the panel is where a DropCode becomes a sentence (`dropMessage` in
  // `components/concierge-chat.tsx`), so the copy is asserted HERE, through the real panel, rather
  // than in a lib test. One case per code: a code with no sentence of its own would silently fall
  // through the switch's default and this table is what catches it.
  const REASON_CASES: Array<{ code: string; op: unknown; sentence: string }> = [
    { code: 'unreadable', op: 'not even an object', sentence: 'it asked for something this app can’t do' },
    { code: 'unknown-verb', op: { type: 'clearDay', date: DAY }, sentence: 'it asked for something this app can’t do' },
    {
      code: 'bad-time',
      op: { type: 'addItem', date: DAY, title: 'Ramen', category: 'food', startMinutes: 1440 },
      sentence: 'the time wasn’t a real time of day',
    },
    {
      code: 'bad-duration',
      op: { type: 'addItem', date: DAY, title: 'Ramen', category: 'food', durationMinutes: 0 },
      sentence: 'the length wasn’t a real duration',
    },
    {
      code: 'date-not-in-trip',
      op: { type: 'addItem', date: 'Dec 20', title: 'Ramen', category: 'food' },
      sentence: 'it named a day outside the trip',
    },
    { code: 'no-title', op: { type: 'addItem', date: DAY, category: 'food' }, sentence: 'it had no name for the plan' },
    {
      code: 'bad-category',
      op: { type: 'addItem', date: DAY, title: 'Ramen', category: 'brunch' },
      sentence: 'it used a category this app doesn’t have',
    },
    {
      code: 'no-such-item',
      op: { type: 'removeItem', itemId: 'ghost-id' },
      sentence: 'the plan it pointed at isn’t on your itinerary',
    },
    {
      code: 'nothing-to-change',
      op: { type: 'updateItem', itemId: 'seed-1' },
      sentence: 'it didn’t actually change anything',
    },
    {
      code: 'already-there',
      op: { type: 'moveItem', itemId: 'seed-1', toDate: DAY },
      sentence: 'that plan is already on that day',
    },
  ];

  for (const { code, op, sentence } of REASON_CASES) {
    it(`says why a ${code} op was dropped`, async () => {
      const h = await drive([op]);
      expect(h.chips()).toHaveLength(0);
      expect(h.droppedLine()?.textContent).toBe(
        `1 suggested change didn’t match the current plan: ${sentence}.`,
      );
      h.unmount();
    });
  }

  it('says a shared reason ONCE, however many ops failed that way', async () => {
    const h = await drive([
      { type: 'addItem', date: 'Dec 20', title: 'Ramen', category: 'food' },
      { type: 'addItem', date: '12/21/2026', title: 'Katsu', category: 'food' },
      { type: 'addItem', date: DAY.replace('2026', '2025'), title: 'Soba', category: 'food' },
    ]);

    const text = h.droppedLine()!.textContent!;
    // The COUNT still counts ops; the REASON is deduped by code.
    expect(text).toBe('3 suggested changes didn’t match the current plan: it named a day outside the trip.');
    expect(text.match(/outside the trip/g)).toHaveLength(1);
    h.unmount();
  });

  it('never leaks rule names, field names or op JSON into the line (D-234, the surviving half)', async () => {
    const h = await drive([
      { type: 'addItem', date: 'Dec 20', title: 'Late ramen', category: 'brunch' },
      { type: 'updateItem', itemId: 'seed', notes: 'x' },
    ]);

    const text = h.droppedLine()!.textContent!;
    // Not `category`: that word is the traveller-facing name of a real concept in this app and the
    // copy is allowed to use it. What must never appear is a rule number, a wire field name, op
    // JSON, or any value lifted out of the op itself.
    for (const machine of ['Rule', 'startMinutes', 'itemId', 'addItem', 'updateItem', '{', 'Dec 20', 'seed']) {
      expect(text).not.toContain(machine);
    }
    h.unmount();
  });

  it('the dropped line is NOT an assertive alert — it is part of the reply, not a blocked action', async () => {
    const h = await drive([{ type: 'addItem', date: 'Dec 20', title: 'Late ramen', category: 'food' }]);
    const line = h.droppedLine()!;
    expect(line.tagName).toBe('P');
    expect(line.getAttribute('role')).toBeNull();
    // …and it sits inside the panel's polite log, so it is announced with the turn it belongs to.
    expect(line.closest('[data-testid="concierge-messages"]')?.getAttribute('aria-live')).toBe('polite');
    h.unmount();
  });

  it('renders NO line for pure chat (ops absent/empty) or when every op is valid', async () => {
    const empty = await drive([]);
    expect(empty.droppedLine()).toBeNull();
    empty.unmount();

    const allValid = await drive([{ type: 'addItem', date: DAY, title: 'Ramen', category: 'food' }]);
    expect(allValid.chips()).toHaveLength(1);
    expect(allValid.droppedLine()).toBeNull();
    allValid.unmount();
  });

  it('confirming a chip does NOT then report it as dropped (resolved ≠ dropped)', async () => {
    // A confirmed removeItem stops validating (its target is gone) — it must not flip into the
    // "didn't match" count. The old naive `ops.length - valid.length` would have.
    const h = await drive([{ type: 'removeItem', itemId: 'seed-1', date: DAY }]);
    expect(h.chips()).toHaveLength(1);
    expect(h.droppedLine()).toBeNull();

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="concierge-op-confirm"]')!.click();
    });
    expect(h.chips()).toHaveLength(0); // chip consumed
    expect(h.droppedLine()).toBeNull(); // and NOT reported as a drop
    h.unmount();
  });
});

/**
 * S341 — "every time I send a message I have to re-click the textbox to send chat again."
 * The input used to carry `disabled={status==='streaming'}`, which blurs it mid-turn with nothing
 * restoring focus. jsdom does not implement a form's IMPLICIT submission on Enter, so these drive
 * the form's `submit` event (exactly what Enter dispatches in a browser) with no pointer
 * interaction on the input, and assert `document.activeElement` around it.
 *
 * TWO jsdom limits, stated so the assertions aren't over-read (verified by re-adding `disabled` and
 * re-running): (1) jsdom does NOT blur a focused element when it becomes `disabled`, and (2) radix's
 * Sheet focus scope pulls focus back inside the panel on its own. So the assertion that BITES on the
 * real defect is `input.disabled === false` mid-stream; the `activeElement` assertions pin the
 * intended behaviour but a browser is needed to prove the blur is gone.
 */
describe('S341 — the concierge input never loses focus across sends', () => {
  beforeEach(() => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(SEED));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('restores focus to the input once a turn completes (pointer-send path)', async () => {
    const h = await mount([]);
    // Simulate sending by clicking the button: focus lands on the send button, not the input.
    document.querySelector<HTMLButtonElement>('[data-testid="concierge-send"]')!.focus();
    await h.send('what should I pack?');

    expect(document.activeElement).toBe(h.input());
    h.unmount();
  });

  it('round-trips a SECOND keyboard send with zero pointer interaction', async () => {
    const h = await mount([]);
    h.input().focus();

    await h.send('first question');
    expect(document.activeElement).toBe(h.input()); // still focused → Enter works again
    expect(h.input().value).toBe(''); // draft cleared

    await h.send('second question');
    expect(document.activeElement).toBe(h.input());

    // 2 user turns + 2 assistant replies actually made it through the real hook.
    const turns = h.turns().map((t) => t.textContent);
    expect(turns).toEqual(['first question', 'Here you go.', 'second question', 'Here you go.']);
    h.unmount();
  });

  it('leaves the input enabled+typable mid-stream while the SEND BUTTON stays disabled', async () => {
    let release: (() => void) | undefined;
    const reply = () =>
      new Response(JSON.stringify({ reply: 'Here you go.', ops: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const h = await mount([], () => new Promise<Response>((res) => (release = () => res(reply()))));
    h.input().focus();

    await h.send('slow one'); // resolves nothing yet — the turn is still streaming
    const input = h.input();
    const sendBtn = document.querySelector<HTMLButtonElement>('[data-testid="concierge-send"]')!;
    // THE regression: `disabled` on the input blurred it here, which is why Enter stopped working
    // and the textbox had to be re-clicked.
    expect(document.activeElement).toBe(input);
    expect(input.disabled).toBe(false);
    expect(sendBtn.disabled).toBe(true);

    // …and the user can type the next message while the reply is in flight.
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      setter.call(input, 'typed ahead');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(input.value).toBe('typed ahead');

    await act(async () => {
      release!();
    });
    expect(sendBtn.disabled).toBe(false);
    expect(input.value).toBe('typed ahead'); // the in-flight draft was not clobbered
    h.unmount();
  });
});

/**
 * S389-C — the error surface, driven through the REAL panel. Two things a traveller on foreign
 * mobile data needs and did not have: an offline send that says so in words instead of leaking the
 * browser's `Failed to fetch`, and one control that re-sends the turn they lost.
 *
 * jsdom limit, stated so the assertions aren't over-read: `navigator.onLine` is set directly here
 * (there is no network to actually pull), which is exactly what `hooks/use-online.ts` reads — the
 * pre-check under test. The load-bearing assertion is that `fetch` is never called.
 */
describe('S389-C — offline copy + the Try again control', () => {
  const setOnLine = (value: boolean) =>
    Object.defineProperty(window.navigator, 'onLine', { value, writable: true, configurable: true });

  beforeEach(() => {
    localStorage.setItem(ITINERARY_STORAGE_KEY, JSON.stringify(SEED));
    setOnLine(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setOnLine(true);
    document.body.innerHTML = '';
  });

  const errorText = () =>
    document.querySelector('[data-testid="concierge-error"]')?.textContent ?? '';
  const retryBtn = () => document.querySelector<HTMLButtonElement>('[data-testid="concierge-retry"]');

  it('an offline send shows plain-language copy, makes NO request, and offers Try again', async () => {
    setOnLine(false);
    const h = await mount([]);
    const fetchImpl = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    await h.send('add ramen to the 20th');

    expect(fetchImpl).not.toHaveBeenCalled(); // ← nothing left the device
    expect(errorText()).toContain('offline');
    expect(errorText()).not.toContain('Failed to fetch');
    expect(h.turns()).toHaveLength(0); // no user turn, no blank assistant bubble
    expect(retryBtn()).not.toBeNull();
    h.unmount();
  });

  it('clicking Try again once back online re-sends the lost turn and clears the error', async () => {
    setOnLine(false);
    const h = await mount([]);
    const fetchImpl = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await h.send('add ramen to the 20th');
    expect(fetchImpl).not.toHaveBeenCalled();

    setOnLine(true);
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await act(async () => {
      retryBtn()!.click();
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="concierge-error"]')).toBeNull();
    expect(h.turns().map((t) => t.textContent)).toEqual(['add ramen to the 20th', 'Here you go.']);
    h.unmount();
  });
});
