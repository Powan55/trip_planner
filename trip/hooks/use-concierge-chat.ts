'use client';

import { useCallback, useRef, useState } from 'react';
import { useOnline } from '@/hooks/use-online';
import { getActiveTripId } from '@/core/storage/gateway';
import { getActiveTrip, isDefaultTrip } from '@/core/trips';
import { getKnownTrip } from '@/core/trips/registry';
import { CONCIERGE_URL } from '@/lib/concierge-config';
import { workerAuthHeader } from '@/lib/worker-auth';
import { TRIP_DATE_LABEL, TRIP_DATES } from '@/core/dates/trip-dates';
import { getCityForDate } from '@/core/dates/trip-cities';
import { effectiveStartMinutes, formatTimeAmPm } from '@/core/dates/item-time';
import { getNowAtTrip, getTodayInTrip } from '@/lib/trip-now';
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
  // which model answered, Worker-stamped and
  // shown as the raw id with no friendly-name map. Absent on user turns, and on ANY assistant
  // turn when the field wasn't a non-empty string on the wire — the deployed Worker (v1.4.0) sends
  // no `model` yet, and that must render as nothing, not a placeholder.
  model?: string;
}

// Client digest char cap. Coupled to the Worker's CONTEXT_TRUNCATE_LENGTH (worker/src/
// providers.ts) — BOTH are CHARACTER caps, and the Worker re-slices `context` to its own
// ceiling before folding it into the system prompt. This cap MUST stay ≤ the Worker ceiling.
// raised BOTH to 7000 (from 2000) so the whole fully-planned 32-day digest fits
// without mid-trip truncation. raised BOTH to 9500, because the digest now carries a
// per-item time + category prefix. MEASURED, not estimated:
// fully-planned 32-day sample trip, 261 items: 10043 chars BEFORE → 14842 AFTER (the Japan leg
// rebuild moved the seed 180 → 261 items; the pair before it was 7514 → 10747).
// Both numbers are pinned EXACTLY by the "MEASUREMENT" test in
// lib/__tests__/concierge-digest-s327.test.ts (constants MEASURED_DIGEST_BEFORE/AFTER), so the
// slack claim below is backed by a test that goes red rather than by a run someone did once —
// change what the digest emits and that test fails and asks you to re-measure.
//
// ⚠️ THE SLACK IS GONE, AND IT CANNOT BE BOUGHT BACK FROM THIS FILE. #12 spent 402 of it:
// +351 taking the per-item times 24-hour → 12-hour (`18:30` → `6:30 PM`, the bug), and +51
// making the date line unconditional. #18 then spent 26 more, and NOT by changing this format:
// D-327 retitled a seed item, the title is in the digest, and the digest grew. The note here used
// to say ~39 chars were left and that the next seed edit would probably break the cap. It did:
// the Nepal leg rebuild took the seed 158 → 180 items and the fully-planned digest to 10747 chars,
// 1247 OVER this cap. The Japan leg rebuild then took it to 261 items and 14842 chars, 5342 over.
// At a pre-trip clock the overflow path now drops 14 of the 32 days — Dec 27 to Jan 9, the whole
// Tokyo leg. Re-measured, and pinned, in that same test file.
// If a future change needs more room, DIGEST_CAP and the Worker's CONTEXT_TRUNCATE_LENGTH move
// TOGETHER, in a Worker deploy. Raising this one alone does not buy room, it just moves the
// truncation server-side where nothing turns red (see the coupling note below).
//
// So the overflow BEHAVIOUR changed instead of the number. `buildTripDigest` no longer slices the
// string mid-line; it drops whole day lines, furthest in time from today first, and appends one
// line naming what it dropped. The cap test in that file walks all 32 clock days and checks that
// degradation rather than the old "never truncates" invariant, which the trip itself made false.
// Keep these two constants equal; a higher client cap would ship bytes the server silently
// discards. (They land + deploy together per the coupling; don't raise one without
// the other.)
// WHY THAT COUPLING IS THE WHOLE PROTECTION: while the two are equal, the server's
// `context.slice(0, CONTEXT_TRUNCATE_LENGTH)` (worker/src/providers.ts) is structurally
// UNREACHABLE — `context` IS this digest, so the client cannot send more than the server keeps.
// That guard has therefore never fired in production and no test covers it, nor can one while
// the caps match. Raise the client cap alone and the branch flips from inert to silently active
// with nothing turning red — and it degrades WITH TRIP SIZE, so small fixtures stay under the
// limit and only real, fully-planned trips lose their tail. The equality is the protection;
// the slice() is not a backstop.
const DIGEST_CAP = 9500;

// Outgoing-history caps — TWO bounds, both applied (see `capHistory`).
// `HISTORY_CAP` is the conversational one: the last 12 turns, unchanged since.
// `HISTORY_CHAR_CAP` is the BYTE-BUDGET one and exists only to protect the Worker's
// `MAX_BODY_BYTES = 16 * 1024` (worker/src/index.ts:24), which 413s on the WHOLE JSON string —
// digest AND history AND message together. 12 turns bounds the turn COUNT but not their length,
// so one long pasted exchange was the wildcard that could push a request over the limit; raising
// DIGEST_CAP 7000 → 9500 ate 2500 chars of what used to be slack, which is what makes bounding it
// worth doing now.
//
// SIZED AGAINST THE CLIENT'S OWN `DIGEST_CAP` (9500), NOT the Worker's CONTEXT_TRUNCATE_LENGTH.
// That distinction is load-bearing: the Worker's 413 check runs on the raw request body BEFORE it
// truncates `context`, so a smaller server-side context ceiling buys this budget nothing at all —
// the bytes still have to leave the client. Budget measured, not guessed (the MEASUREMENT test in
// lib/__tests__/concierge-digest-s327.test.ts builds the real worst-case body and asserts it):
// 9500 digest (multi-byte inflated) + ≤3000 history + 2000 message + JSON keys/escapes
// ≈ 14.1 KB of 16384, leaving ~2.2 KB of genuine headroom.
// 3000 rather than 4000 for that extra ~1 KB of margin: JSON escaping inflates unpredictably, and
// a normal 12-turn conversation (~80-char asks, ~400-char replies ≈ 2.9 KB) still fits whole, so
// the bound only bites on the long pasted exchanges that are the actual 413 risk.
const HISTORY_CAP = 12;
const HISTORY_CHAR_CAP = 3000;

// Abort ceiling for the chat POST. The sibling `lib/place-resolve.ts` uses AbortSignal.timeout
// (8s) for a link resolve; this call is NOT comparable — it waits on a language model, and the
// Worker's fallback ladder (worker/src/providers.ts: Gemini → Groq 120b → Groq 20b) can try three
// providers SEQUENTIALLY with no per-leg timeout of its own, so this client abort is the only
// bound on the whole ladder. 45s ≈ three ~15s legs: a legitimately slow full fall-through still
// completes, and anything past it is genuinely hung. Without it a hung upstream pinned the UI in
// its (misnamed) 'streaming' state forever with no way out.
const CHAT_TIMEOUT_MS = 45_000;

// ── / owner ruling Q6 — the trip descriptor on the wire ─────────────────────────────────
//
// MUST equal the Worker's `TRIP_LABEL_MAX` (worker/src/providers.ts). The Worker truncates too,
// but that is NOT the same guarantee and cannot replace this one: its 16 KB `MAX_BODY_BYTES` 413
// runs on the RAW BODY BEFORE any parse, so bytes we send are bytes that count against the cap
// whatever the Worker later does with them. Bounding it here is what keeps the worst-case body
// computable — and the measured worst case is already ~14.1 KB of 16 KB.
const TRIP_LABEL_MAX = 120;

/** Exactly what the Worker's `normalizeTrip` accepts (worker/src/providers.ts `TripDescriptor`). */
export interface TripDescriptor {
  label: string;
  /** Inclusive ISO 'YYYY-MM-DD' — this becomes the model's op date fence verbatim. */
  start: string;
  end: string;
}

/**
 * The active trip as a compact descriptor — or `null`, meaning "say nothing and let the Worker
 * use its own default persona".
 *
 * 🔴 NULL ON THE DEFAULT TRIP, AND THAT IS THE POINT, NOT AN OVERSIGHT. The Worker's
 * `buildSystemPrompt(null)` is the RICHER prompt for this trip: the Nepal × Japan boys-trip voice
 * plus the `LOCAL_KNOWLEDGE` paragraph (Thamel, Shibuya/Shinjuku/Roppongi, the last train) that a
 * trip-aware prompt deliberately omits, because no human has verified the ground anywhere else.
 * Sending `{label:'Nepal × Japan 2026', …}` here would be *correct data* that nonetheless
 * DOWNGRADES the default trip to the generic persona the moment the Worker is deployed — a
 * regression on the only trip that has a concierge today. So the default path stays byte-identical
 * to what ships now: no `trip` key at all.
 *
 * THREE FIELDS ONLY. `vibe` / `legs` / `currency` / `id` are ignored by `normalizeTrip` and would
 * only eat body budget, and the date range and cities are already on the wire inside the digest.
 *
 * `label` is the one field here this device does not author — it comes off the trip's meta doc,
 * which any member of the trip writes. The slice bounds its LENGTH; `oneLine` (below) is what
 * bounds its STRUCTURE, and the prompt it lands in is line-oriented. `start`/`end` need neither:
 * `sanitizeTripConfig` already pins them to `YYYY-MM-DD`.
 */
export function buildTripDescriptor(): TripDescriptor | null {
  if (isDefaultTrip()) return null;
  const trip = getActiveTrip();
  return { label: oneLine(trip.label).slice(0, TRIP_LABEL_MAX), start: trip.start, end: trip.end };
}

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
 * format change — each item is now `HH:MM category Title #id` instead of bare `Title #id`.
 * Titles alone told the model *that* something sits on Dec 20 but not *when* or *what kind*, so it
 * could not answer "what should I do tomorrow evening?" without risking a double-booking, nor spot
 * a free afternoon. Costs ~2400 chars on a fully-planned trip (6611 → 9025 measured, hence
 * DIGEST_CAP 7000 → 9500) and
 * no extra request. Deliberately NOT abbreviated: the full ISO date stays on every day line even
 * though `12-20` would save ~160 chars, because a non-ISO date echoed back into an op is dropped
 * silently by `validateOps` — the bug class, not worth reintroducing.
 *
 * Hard-capped at `DIGEST_CAP` chars — a token-budget guard for the Worker call. Overflow drops
 * WHOLE day lines, furthest in time from today first, and appends one line naming the omitted
 * dates; it no longer slices mid-line. See the overflow block at the bottom of the function.
 */
// The digest is a LINE-oriented format ("date city: item; item") assembled by interpolation, and
// every field it interpolates reaches storage from paths no `<input>` constrains: a restored backup
// (`parseItineraryPayloadStrict`'s per-item rule is a bare `z.string()`) and a Firestore snapshot
// written by the other member's device. A stored title carrying `\n` therefore forged its own row,
// indistinguishable to the model from a real one — enough to steer the reply into a phishing link
// that `renderInline` turns into a real anchor. Strip the two delimiters where the line is built:
// one place, and every digest consumer routes through it.
const oneLine = (s: string): string => s.replace(/[\r\n;]+/g, ' ');

export function buildTripDigest(): string {
  const head: string[] = [
    // the header states the ISO format + the exact valid range explicitly. The human-readable
    // TRIP_DATE_LABEL alone was letting the model echo "Dec 20" or a wrong YEAR back in an op's
    // date, which `validateOps` then dropped silently — the user just saw a reply
    // with no proposal chip. Cheap (~55 chars, well inside DIGEST_CAP) and it costs no extra call.
    `Trip: ${TRIP_DATE_LABEL} (${TRIP_DATES.length} days). Dates are YYYY-MM-DD between ${TRIP_DATES[0]} and ${TRIP_DATES[TRIP_DATES.length - 1]}. Any date not listed below is unplanned.`,
    // one line teaching the per-item encoding, which also subsumes the old trailing
    // "Items tagged #id." It must describe what the lines below ACTUALLY carry or the model
    // mis-parses the digest, so #12's switch to 12-hour times moves this line with it. The
    // deployed Worker's PLAN_LINES still says "HH:MM"; that is stale and this line, which sits
    // directly above the data, corrects it in place with no Worker deploy. The half of PLAN_LINES
    // that matters for correctness is untouched: ops still carry integer `startMinutes`, never a
    // display string, and `validateOps` is what enforces it.
    'Each item is "h:mm AM/PM category Title #id". A missing time means no set time yet.',
  ];

  // The date+time stamp, and it is now UNCONDITIONAL (#12). It used to hang off
  // `getTodayInTrip()`, which is `null` outside Dec 9 to Jan 9, so every off-trip conversation
  // shipped a digest with no date in it at all and the model fell back to the first day of the
  // trip. It answered a question asked in August as if it were December 9. `getNowAtTrip()`
  // (lib/trip-now.ts) is the same clock+leg-offset adapter, minus that `null`: it reads the
  // destination-local wall-clock day and time (Nepal/Japan offset), not the device's, so a
  // traveler checking from bed gets the right calendar day. A Worker-side `new Date()` (UTC at
  // the edge) cannot do this. Both halves route through `getNow()`, so `?today=` still drives it.
  //
  // The time joins the date because the same bug had a second face: without it the model had no
  // idea whether "tonight" had already happened. 12-hour to match the items below and the rest of
  // the app (`formatTimeAmPm`, the one helper).
  //
  // The two branches carry the SAME date by construction (both resolve one clock at one offset);
  // in-trip it adds Day N + city, off-trip which side of the window we are on, which is the fact
  // the model was silently inventing.
  const now = getNowAtTrip();
  const today = getTodayInTrip();
  const stamp = `Today is ${now.date} ${formatTimeAmPm(now.minutes)}`;
  head.push(
    today
      // `today.city` resolves to a custom trip's own `destinations[0]`, which reaches the device
      // from its meta doc — the same kind of value as the day lines below, so the same strip.
      ? `${stamp} (Day ${today.dayNumber} of ${TRIP_DATES.length}, ${oneLine(today.city)}).`
      : `${stamp} (${now.date < TRIP_DATES[0] ? 'before' : 'after'} the trip).`,
  );

  const plans = itineraryStoragePort.load();
  const byDate = new Map(plans.map((d) => [d.date, d]));

  const days: { date: string; line: string }[] = [];
  for (const date of TRIP_DATES) {
    const day = byDate.get(date);
    const items = (day?.items ?? []).filter((i) => i.deleted !== true);
    if (items.length === 0) continue; // omit unplanned days (frame already covers them)
    const city = day?.city ?? getCityForDate(date);
    const entries = items
      .map((i) => {
        // `effectiveStartMinutes`, not a raw `i.startMinutes` read: it is the ONE range-validation
        // + legacy-`time` fallback point, and the SEED itinerary
        // (core/content/itinerary.ts, returned verbatim by the Vault fallback with no migration)
        // carries `time: '05:30'` and NO `startMinutes` at all — reading the raw field would emit
        // a timeless digest on every fresh device, i.e. the whole point of this change, silently
        // lost. Untimed items get NO token rather than `00:00`, which would read as midnight.
        // #12: `formatTimeAmPm`, not `minutesToHHMM`. The digest is DISPLAY text the model reads
        // back to the traveller, and it was handing over 24-hour times, so the assistant said
        // "18:30" where the app itself says "6:30 PM" everywhere else. `minutesToHHMM` is the
        // D-138 canonical STORAGE format and stays that, in the `time` field, untouched.
        const minutes = effectiveStartMinutes(i);
        const time = minutes === undefined ? '' : `${formatTimeAmPm(minutes)} `;
        // Every field of a stored item is a bare `z.string()` at the read boundary (permissive on
        // read, deliberately), so `category` and `id` reach this line as freely as `title` does.
        return `${time}${oneLine(i.category)} ${oneLine(i.title)} #${oneLine(i.id)}`;
      })
      .join('; ');
    days.push({ date, line: `${date} ${oneLine(city)}: ${entries}` });
  }

  const full = [...head, ...days.map((d) => d.line)].join('\n');
  if (full.length <= DIGEST_CAP) return full; // byte-identical to the pre-overflow output

  // OVER CAP. The old behaviour here was `digest.slice(0, DIGEST_CAP - 1) + '…'`, which cut the
  // string mid-line: the model was handed a half-written day it read as a whole one, and it always
  // lost the SAME end of the trip no matter when it was asked. The concierge is asked "what should
  // I do tomorrow?", so proximity to now is the relevance signal — drop WHOLE day lines, furthest
  // in time from today first, and say which ones went. Without that last line the model answers
  // confidently about a day it cannot see, and worse: the header above states that any unlisted
  // date is unplanned, which an omitted day would turn into a lie.
  //
  // `TRIP_DATES` is contiguous, so a date's index IS its day number and |Δindex| is the distance.
  // Off-trip, clamp to the nearer end of the window (before the trip, the first days matter; after
  // it, the last). Ties go to the earlier day, which is the one already spent.
  const lastDate = TRIP_DATES[TRIP_DATES.length - 1];
  const refDate =
    now.date < TRIP_DATES[0] ? TRIP_DATES[0] : now.date > lastDate ? lastDate : now.date;
  const ref = TRIP_DATES.indexOf(refDate);
  const dropOrder = days
    .map((d, i) => ({ i, dist: Math.abs(TRIP_DATES.indexOf(d.date) - ref) }))
    .sort((a, b) => b.dist - a.dist || a.i - b.i)
    .map((d) => d.i);

  // Re-measured after each drop rather than estimated: the omission line grows as it drops, and
  // "does the whole string fit" is the only thing that matters. ≤32 rebuilds of a ≤9500-char
  // string — not worth a smarter loop.
  const dropped = new Set<number>();
  for (const i of dropOrder) {
    dropped.add(i);
    const omitted = days.filter((_, j) => dropped.has(j)).map((d) => d.date);
    const out = [
      ...head,
      ...days.filter((_, j) => !dropped.has(j)).map((d) => d.line),
      `${omitted.length} day(s) omitted for length (they ARE planned, not unplanned): ${oneLine(omitted.join(', '))}`,
    ].join('\n');
    if (out.length <= DIGEST_CAP) return out;
  }

  // Every day dropped and still over cap — only reachable if the fixed header alone exceeds
  // DIGEST_CAP (it is ~250 chars against 9500). Slice as the last resort so the cap holds
  // unconditionally rather than depending on a header staying short.
  const bare = [...head, `${days.length} day(s) omitted for length.`].join('\n');
  return bare.length > DIGEST_CAP ? `${bare.slice(0, DIGEST_CAP - 1)}…` : bare;
}

/**
 * The outgoing history: the last `HISTORY_CAP` turns, then oldest-first dropped until the
 * serialized result fits `HISTORY_CHAR_CAP`. Both bounds matter — see the constants above.
 * Newest turns are the ones the model actually needs, so the drop order is never in question.
 */
export function capHistory(turns: ChatTurn[]): ChatTurn[] {
  let out = turns.slice(-HISTORY_CAP);
  while (out.length > 0 && JSON.stringify(out).length > HISTORY_CHAR_CAP) out = out.slice(1);
  return out;
}

export type ChatStatus = 'idle' | 'streaming' | 'error';

/**
 * Issue #13 — our OWN sentence for a non-2xx concierge response, chosen by status class. The
 * response body is never read: whatever `{error}` string came back does not reach the traveller.
 *
 * THE RULE, and the evidence for it. The Worker authors every `error` string it sends
 * (`worker/src/index.ts::jsonError`, `providers.ts`' 502) and never passes an upstream provider
 * body through — so "is this text ours?" was the question, and the answer is that the status code
 * does not separate the useful copy from the machine text. 401 carries `missing trip token`
 * (protocol jargon, and D-239 bans an unqualified "token" in UI copy), 400 carries
 * `context must be a string`, while the genuinely readable sentence sits on a 502; a 500 comes
 * from something that is not our Worker at all, since the Worker emits none. There is no clean
 * split to pass through, so nothing from the wire is rendered — which also holds if a proxy, a
 * CDN error page or a future Worker version answers instead.
 *
 * Copy convention (matching the offline + timeout lines below): name what happened, give the next
 * action, never show machine text. The buckets are the ones with DIFFERENT next actions — an
 * auth failure must not tell someone to press "Try again" forever.
 */
function statusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return 'The concierge couldn’t confirm this trip is yours. Sign in again, or open the trip from your trips list.';
  }
  if (status === 413) return 'That message was too long to send. Shorten it and try again.';
  return 'The concierge is having trouble right now. Try again in a moment.';
}

/**
 * Drives one concierge turn against the deployed Worker.
 *
 * SESSION-ONLY HISTORY: messages live in component state
 * only, cleared on reload. says the Worker never
 * persists or logs chat content, and there's no product ask for cross-device history, so adding
 * a new gateway/sync-domain key for this would be scope deliberately avoided
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
  // connectivity signal, reused — the same `navigator.onLine` reading behind the
  // app-wide offline banner, not a second one.
  const online = useOnline();
  // The last message the user tried to send, so `retry()` can re-send exactly that turn. A ref,
  // not state: nothing renders from it, and it must be readable from inside `send`'s closure.
  const lastMessageRef = useRef('');
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
      lastMessageRef.current = trimmed;

      //-C — fail fast, and in words, when there is no connection. Without this the fetch
      // rejects with the browser's own `TypeError: Failed to fetch`, which the catch below passes
      // straight through to the traveller as the error text. On foreign mobile data that is the
      // NORMAL case, not an edge one. Nothing leaves the device on this path — no request is made,
      // no in-flight bubble is pushed (so there is no blank turn to clean up), and `retry()`
      // re-sends this exact message once there is a signal again.
      if (!online) {
        setStatus('error');
        setError('You’re offline, so nothing was sent. Reconnect and try again.');
        return;
      }

      // #10 — the concierge serves only trips that are ON THIS ACCOUNT, checked BEFORE any digest
      // is built or a byte leaves the device: a custom trip the registry does not know (someone
      // drove the pointer to an arbitrary id without joining it) gets no digest and no POST,
      // because the digest would read whatever sits under that pointer's storage namespace.
      //
      // v6.0.2 removed a second refusal that stood here — the default pack on a configured build.
      // It was the client half of a membership gate (worker 1.9.0) that never deployed, so it
      // protected nothing and left the concierge dead on the trip a first-time visitor lands on.
      // Worker 1.9.0 must not ship without 1.10.0's sample-pack allowance or this comes back as a
      // 403: the sample has no Firestore trip doc, so membership can only answer no. See
      // docs/RELEASES.md, v6.0.2.
      if (!isDefaultTrip() && !getKnownTrip(getActiveTripId())) {
        setStatus('error');
        setError("This trip isn't on your account, so the concierge can't help with it.");
        return;
      }
      sendingRef.current = true;

      const history = historyRef.current;
      const userTurn: ChatTurn = { role: 'user', content: trimmed };
      setMessages((prev) => [...prev, userTurn, { role: 'assistant', content: '' }]);
      setStatus('streaming');
      setError(null);

      // The ONE failure exit, so every path that fails after the in-flight bubble was pushed pops
      // it and reports in the same words (issue #13 replaced a `throw`-and-read-`err.message`
      // round trip with this: there is now no expression anywhere below that can put a machine
      // string into `setError`).
      const fail = (reason: string) => {
        setStatus('error');
        setError(reason);
        // Drop the empty in-flight assistant bubble so the error state doesn't leave a blank turn.
        setMessages((prev) => prev.slice(0, -1));
      };

      try {
        // ONE signal for the whole TURN, not just the fetch. It used to be constructed inline in
        // the `fetchImpl(...)` call, which left two unbounded awaits ahead of it: the lazy
        // `import('./itinerary-remote')` inside `workerAuthHeader()` (lib/worker-auth.ts) and a
        // `securetoken.googleapis.com` token refresh, neither of which has a timeout of its own.
        // If either STALLS rather than rejecting, `send()` never
        // settles, so `finally` never runs — status stuck on 'streaming', sendingRef stuck true,
        // `error` still null so no "Try again" row ever mounts, and only a reload recovers. That is
        // the exact state CHAT_TIMEOUT_MS exists to prevent, on the exact connection (captive
        // portal, dead cell handoff) this file's other comments already treat as the normal case.
        const signal = AbortSignal.timeout(CHAT_TIMEOUT_MS);
        const context = buildTripDigest();
        const trip = buildTripDescriptor();
        // #10 — a Firebase ID token when there is a session to attach, nothing when there is not:
        // with no firebase configured (the dormant build and every browser test) this spreads to
        // nothing and the request is byte-identical to the one that shipped before. The membership
        // check it pairs with was built for Worker 1.9.0 and is not deployed, so nothing verifies
        // the token today and none of this is a security boundary. See lib/worker-auth.ts.
        //
        // Raced against the turn's own ceiling, resolving to NO header if it wins. Degrading to an
        // unauthenticated request on a token we couldn't get in time is already `workerAuthHeader`'s
        // documented behaviour (its catch does exactly this), so an empty header is the correct
        // fallback — and the fetch below then rejects on the same already-aborted signal, landing in
        // the catch with the timeout copy rather than hanging.
        const auth = await Promise.race([
          workerAuthHeader(),
          new Promise<Record<string, string>>((resolveHeader) => {
            signal.addEventListener('abort', () => resolveHeader({}), { once: true });
          }),
        ]);
        const res = await fetchImpl(CONCIERGE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Trip-Token': getActiveTripId(), ...auth },
          // `trip` is spread in only when there IS one — the key is ABSENT on the default trip,
          // not `null`. See `buildTripDescriptor`: absent is what selects the Worker's richer
          // default persona, and it also keeps the default body byte-identical to today's.
          body: JSON.stringify({
            message: trimmed,
            history: capHistory(history),
            context,
            ...(trip ? { trip } : {}),
          }),
          // The POST stays at the BARE origin with no path suffix — the Worker accepts `POST /`
          // specifically because of this. Do not "tidy" it into `${CONCIERGE_URL}/chat`.
          signal,
        });

        // Issue #13 — the body is not read at all. It used to be parsed and its `error` string
        // rendered verbatim, which put whatever the Worker (or anything in front of it) wrote in
        // front of a traveller. See `statusMessage` for the rule and the evidence behind it.
        if (!res.ok) {
          fail(statusMessage(res.status));
          return; // `finally` still clears sendingRef
        }

        // the structured turn returns ONE `application/json` object `{reply, ops}`, not
        // SSE (constrained JSON can't cleanly interleave streamed prose + a terminal ops block).
        // `model` joins the envelope, optional on the wire — a client shipped before
        // the Worker's model-stamping version receives replies with no `model` field at all.
        const data = (await res.json().catch(() => ({}))) as {
          reply?: unknown;
          ops?: unknown;
          model?: unknown;
        };
        // A 2xx whose body is not the envelope is a FAILED turn, and used to render as a successful
        // one: the parse failure was swallowed, `reply` defaulted to '', status went 'idle' and
        // `error` stayed null — so the panel showed a blank grey bubble with no error row and no
        // "Try again", and shipped that empty turn as history on every later turn. The canonical
        // producer is a captive portal or an interposing proxy answering 200 with HTML. "Did the
        // body parse into an envelope" is a different question from "was the request successful",
        // and this is the line that stops them being conflated. Deliberately changes the contract
        // the old `'a malformed body … degrades to an empty reply'` test pinned.
        if (typeof data.reply !== 'string') {
          fail(statusMessage(0)); // the default branch: "having trouble right now. Try again…"
          return;
        }
        const reply = data.reply;
        // Surface ops RAW (unvalidated) on the assistant turn — the component validates against the
        // LIVE itinerary at chip-render time (see the ChatTurn.ops comment). Keep only a plain array.
        //
        // DEDUPED ON ARRIVAL, by the same `JSON.stringify` the chip's `opKey` is built from
        // (components/concierge-chat.tsx). A model repeating itself within one reply is an ordinary
        // failure mode, and two byte-identical ops produced ONE key: both chips rendered under the
        // same React key, Confirm on either resolved both, only one `applyOp` ran, and the second
        // proposal vanished with no chip, no undo entry and no "didn't match" line. Two identical
        // ops are one proposal — dropping the duplicate here is what makes that true everywhere,
        // rather than making the key positional and asking the user to confirm the same thing twice.
        const seen = new Set<string>();
        const ops: Op[] = (Array.isArray(data.ops) ? (data.ops as Op[]) : []).filter((op) => {
          const key = JSON.stringify(op);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        // absent / non-string / blank all collapse to `undefined` HERE — the one place that
        // decides "is this a real model id" — so `concierge-chat.tsx` renders on plain truthiness
        // with no second guard to keep in sync (: a mechanism in one place, not a claim
        // repeated at two call sites).
        const model = typeof data.model === 'string' && data.model.trim() !== '' ? data.model : undefined;

        setMessages((prev) => {
          const next = prev.slice();
          next[next.length - 1] = { role: 'assistant', content: reply, ops, model };
          return next;
        });
        // History carries the reply text only.
        historyRef.current = [...history, userTurn, { role: 'assistant', content: reply }];
        setStatus('idle');
      } catch (err) {
        // A CHAT_TIMEOUT_MS abort surfaces as a DOMException whose raw message ("signal timed out")
        // is useless to a traveler — swap in a friendly, actionable one.
        // Matched on `.name` WITHOUT an `instanceof Error` guard on purpose: whether a DOMException
        // subclasses Error varies by implementation (jsdom's does not), and this must not depend on
        // that — `.name === 'TimeoutError'` is the part the spec actually pins.
        //
        // Issue #13 — EVERYTHING ELSE is our own sentence too; `err.message` is gone. A dead or
        // unreachable provider while `navigator.onLine` is true (Worker deleted, DNS/TLS failure,
        // CORS rejection, captive portal — common on foreign mobile data, not exotic) rejects with
        // `TypeError: Failed to fetch`, and that exact machine string was being rendered in the
        // panel's error row. The offline pre-check above only catches the case where the device
        // knows it is offline; online-but-dead lands here. Nothing is lost by not naming the
        // TypeError separately: the non-200 branch already returned through `fail` with the
        // Worker's own status message, so this catch has no case left that deserves distinct words.
        const timedOut = (err as { name?: unknown } | null)?.name === 'TimeoutError';
        fail(
          timedOut
            ? 'The concierge took too long to respond. Try again.'
            : 'The concierge couldn’t be reached. Check your connection and try again.',
        );
      } finally {
        sendingRef.current = false;
      }
    },
    [fetchImpl, online],
  );

  // ONE retry control: re-send the last turn the user tried. Deliberately not a backoff
  // policy, a queue, or an auto-retry — the traveller decides when they are back on a signal.
  const retry = useCallback(async () => {
    if (lastMessageRef.current) await send(lastMessageRef.current);
  }, [send]);

  const reset = useCallback(() => {
    historyRef.current = [];
    lastMessageRef.current = '';
    setMessages([]);
    setStatus('idle');
    setError(null);
  }, []);

  return { messages, status, error, send, retry, reset };
}
