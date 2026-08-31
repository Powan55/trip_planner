'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { m } from 'framer-motion';
import { MessageSquare, Send, AlertTriangle, Check, WifiOff, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useActiveTraveler } from '@/hooks/use-active-traveler';
import { isConciergeConfigured } from '@/lib/concierge-config';
import { FADE_FLOOR } from '@/lib/motion';
import { useOnline } from '@/hooks/use-online';
import { useConciergeChat } from '@/hooks/use-concierge-chat';
import { useItinerary } from '@/hooks/use-itinerary';
import {
  validateOps,
  describeOp,
  applyOp,
  clashForOp,
  dropReason,
  type DropCode,
  type Op,
} from '@/lib/concierge-ops';
import { describeClash } from '@/lib/sort-items-by-time';
import { showUndoToast } from '@/lib/undo-toast';
import { isSafeHref } from '@/lib/safe-href';

/**
 * One alternation, tried left to right, so precedence falls out of the order:
 * `code` → [text](url) → **bold** → *italic*
 * Code first so a marker inside a code span is never re-interpreted. `**` before `*` so bold wins
 * at the same index, and the bold body is LAZY `.+?` (not the old `[^*]+`) so `**a*b**` bolds
 * "a*b" instead of falling through as raw punctuation. Italic requires a non-space char on both
 * inner edges so arithmetic like `2 * 3 * 4` is not italicised.
 */
const INLINE = /`([^`]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)(.+?)\*\*|\*(?=\S)([^*\n]*[^\s*])\*/g;

const CODE_CLASS =
  'rounded-r1 bg-[rgb(var(--surface-overlay))] px-1 py-0.5 font-code text-[0.9em] text-ink-hi';
// Block-sized counterpart to CODE_CLASS above — same code palette, fenced-block padding;
// a fenced reply renders as one `<pre>` instead of one pill per line.
// The focus ring pairs with the `tabIndex={0}` at the render site: a fenced block scrolls
// horizontally but contains only plain text, so nothing inside it can take focus.
const FENCE_CLASS =
  'my-2 block overflow-x-auto whitespace-pre-wrap rounded-r2 border-hair border-[color:hsl(var(--border))] bg-[rgb(var(--surface-overlay))] px-3 py-2 font-code text-[0.9em] text-ink-hi outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Inline spans within ONE line. Non-recursive on purpose — INLINE is a global (stateful) regex. */
function renderInline(text: string, keyPrefix: number): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${m.index}`;
    const [raw, code, linkText, href, bold, italic] = m;
    if (code !== undefined) {
      out.push(
        <code key={key} className={CODE_CLASS}>
          {code}
        </code>,
      );
    } else if (linkText !== undefined) {
      out.push(
        isSafeHref(href) ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[color:hsl(var(--accent))] underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {linkText}
          </a>
        ) : (
          raw
        ),
      );
    } else if (bold !== undefined) {
      out.push(<strong key={key}>{bold}</strong>);
    } else {
      out.push(<em key={key}>{italic}</em>);
    }
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface Block {
  type: 'fence' | 'ul' | 'ol' | 'heading' | 'para';
  lines: string[];
}

const FENCE_MARKER = /^\s*```/;
const HEADING_RE = /^#{1,6}\s+(.*)$/;
// Bullet/numbered markers REQUIRE trailing whitespace, so a line starting `*italic*` / `**bold**`
// is never eaten as a list item.
const BULLET_RE = /^\s*[*-]\s+(.*)$/;
const NUMBERED_RE = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Pass 1 - split the raw reply into lines and group consecutive lines of the SAME kind into
 * one block. A blank line always closes whatever block is open (it carries no content of its own);
 * there is no more "did I see a gap" bookkeeping for MARGIN purposes - every block gets a fixed
 * class for its type, so spacing can never depend on whether the model happened to blank-line
 * between bullets. Nested bullet indentation is intentionally flattened to one level - Worker
 * prompt clause already tells the model never to emit sub-bullets, so there is nothing left to
 * preserve nesting for.
 */
function groupBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let fenced = false;
  let fenceLines: string[] = [];
  let boundary = true; // true = the next matched line must start a NEW block, never merge into the last

  const open = (type: Block['type'], line: string) => {
    const last = blocks[blocks.length - 1];
    if (!boundary && last && last.type === type) last.lines.push(line);
    else blocks.push({ type, lines: [line] });
    boundary = false;
  };

  for (const raw of text.split('\n')) {
    if (FENCE_MARKER.test(raw)) {
      if (fenced) {
        blocks.push({ type: 'fence', lines: fenceLines });
        fenceLines = [];
        boundary = false;
      }
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      fenceLines.push(raw);
      continue;
    }
    if (!raw.trim()) {
      boundary = true;
      continue;
    }

    const heading = HEADING_RE.exec(raw);
    if (heading) {
      open('heading', heading[1]);
      continue;
    }
    const bullet = BULLET_RE.exec(raw);
    if (bullet) {
      open('ul', bullet[1]);
      continue;
    }
    const numbered = NUMBERED_RE.exec(raw);
    if (numbered) {
      open('ol', numbered[1]);
      continue;
    }
    open('para', raw);
  }
  // An unterminated fence (reply cut off mid-block) still renders whatever it collected rather than
  // silently swallowing it.
  if (fenced && fenceLines.length > 0) blocks.push({ type: 'fence', lines: fenceLines });

  return blocks;
}

/**
 * Multiple raw lines merged into one block (heading/para) render on separate visual lines, but EACH
 * line is still fed through `renderInline` ON ITS OWN - never joined into one string first - so an
 * accidental construct (e.g. a stray backtick) can never span two originally-separate lines.
 */
function renderLines(lines: string[], keyBase: number): ReactNode {
  return lines.map((line, j) => (
    <Fragment key={j}>
      {j > 0 && <br />}
      {renderInline(line, keyBase * 1000 + j)}
    </Fragment>
  ));
}

/**
 * Markdown-lite renderer for a reply — NOT a markdown parser, just the constructs that actually
 * come back on the wire, grouped in two passes. Pass 1
 * (`groupBlocks`) turns the raw lines into `fence`/`ul`/`ol`/`heading`/`para` blocks; this pass
 * renders each as REAL HTML (`<ul>/<ol>/<li>`, one `<pre>` per fenced block) instead of the old
 * one-`<span>`-per-line-with-a-typed-bullet-glyph shape - the markers become CSS
 * (`list-disc`/`list-decimal`) and inter-item spacing becomes a real `space-y` utility instead of a
 * blank-line-conditional margin.
 *
 * `renderInline` (inline code/bold/italic/links, incl. the href allow-list) is UNCHANGED - this
 * rewrite is the block grouper AROUND it, not a touch to the inline renderer itself. Pure over the
 * assembled string - safe to re-run on every streamed delta.
 */
export function renderAssistantContent(text: string): ReactNode[] {
  return groupBlocks(text).map((block, i) => {
    switch (block.type) {
      case 'fence':
        return (
          <pre key={i} tabIndex={0} className={FENCE_CLASS}>
            {block.lines.join('\n') || ' '}
          </pre>
        );
      case 'ul':
        return (
          <ul key={i} className="my-2 space-y-1.5 pl-4 list-disc marker:text-ink-lo">
            {block.lines.map((line, j) => (
              <li key={j}>{renderInline(line, i * 1000 + j)}</li>
            ))}
          </ul>
        );
      case 'ol':
        return (
          <ol key={i} className="my-2 space-y-1.5 pl-4 list-decimal marker:text-ink-lo">
            {block.lines.map((line, j) => (
              <li key={j}>{renderInline(line, i * 1000 + j)}</li>
            ))}
          </ol>
        );
      case 'heading':
        return (
          <strong key={i} className="pr pr--l mt-3 block text-ink-hi first:mt-0">
            {renderLines(block.lines, i)}
          </strong>
        );
      case 'para':
        return (
          <p key={i} className="mt-2 first:mt-0">
            {renderLines(block.lines, i)}
          </p>
        );
      default:
        return null;
    }
  });
}

// The privacy label's id, declared once so the `<p>` and the input's `aria-describedby` can never
// drift apart (a dangling `aria-describedby` is silent — it degrades to no description at all).
const PRIVACY_NOTE_ID = 'concierge-privacy-note';

// Starter prompts — three real, tappable suggestions so a first-time user has something to
// press instead of staring at an empty input.
const STARTER_PROMPTS = [
  "What's the plan for tomorrow?",
  'Best clubs in Shibuya?',
  'Add ramen to the 20th',
];

/**
 * What happened to a proposal once the traveller decided. Kept per chip so applied and
 * dismissed stay two visibly different receipts rather than both collapsing to "gone", and the
 * label is captured AT DECISION TIME: `describeOp` reads the live plans, so a confirmed
 * `removeItem` would otherwise re-describe itself as “item” the moment its target is deleted.
 */
interface Resolution {
  state: 'applied' | 'dismissed';
  label: string;
}

/**
 * Issue #13 — the sentence for one `DropCode`. The copy lives HERE and the code lives in
 * `lib/concierge-ops.ts`, which is what makes D-234's surviving invariant structural: no rule
 * number, field name, JSON or other machine text can reach a traveller, because none of it
 * crosses the seam in the first place. Same reason-code → copy switch as
 * `components/photo-attach.tsx::reasonMessage`.
 *
 * Each clause completes "…didn't match the current plan: <clause>", so they are lower-case
 * fragments, phrased as what the SUGGESTION got wrong — never as an instruction, because there is
 * nothing for the traveller to press here (the op is gone; asking again is the whole recourse).
 */
function dropMessage(code: DropCode): string {
  switch (code) {
    case 'date-not-in-trip':
      return 'it named a day outside the trip';
    case 'no-title':
      return 'it had no name for the plan';
    case 'bad-category':
      return 'it used a category this app doesn’t have';
    case 'no-such-item':
      return 'the plan it pointed at isn’t on your itinerary';
    case 'nothing-to-change':
      return 'it didn’t actually change anything';
    case 'bad-time':
      return 'the time wasn’t a real time of day';
    case 'bad-duration':
      return 'the length wasn’t a real duration';
    case 'already-there':
      return 'that plan is already on that day';
    case 'unknown-verb':
    case 'unreadable':
      return 'it asked for something this app can’t do';
  }
  // No `default:` here, deliberately. With all ten codes listed the switch is exhaustive and this
  // compiles; an ELEVENTH `DropCode` makes it fall off the end and TS2366 fails the build. A
  // `default` would instead have silently rendered the generic sentence for a code that deserves
  // its own — the same fail-open asymmetry `clashForOp` is guarded against in D-316.
}

/**
 * The concierge panel — the client surface for the Cloudflare Worker's `POST` relay. Mounted once
 * in the persistent navbar chrome (`components/navbar.tsx`), next to the Travel Mode entry. It is
 * a panel, not a route or a mode, so a trigger button plus `Sheet` open state is the whole thing —
 * no push/replace history machinery.
 *
 * THE PRODUCT RULE, AND IT IS A DESIGN REQUIREMENT AND NOT A CAPTION: this surface PROPOSES and
 * the traveller APPLIES. A proposal renders as an unapplied form — stamped, stating in words that
 * nothing has changed — and `confirmOp` is the only path in this file that can write. Applied,
 * proposed and dismissed are three different materials so a suggestion can never be mistaken for a
 * change that already happened.
 *
 * GATING — fully invisible unless BOTH hold (no separate gate duplicated at any call site,
 * mirrors `SyncStatusBadge`'s self-contained render-null pattern):
 * 1. `isConciergeConfigured()`: `NEXT_PUBLIC_CONCIERGE_URL` is set. Unset in a plain local
 * build, which is the dormant state the tests cover. A DEPLOY can no longer be dormant: since
 * issue #41, `deploy.yml` fails the build instead of shipping without the variable.
 * 2. A resolved traveler (`traveler !== null` — with no guest mode, this is the only
 * identity state that exists once past the front door).
 * `useActiveTraveler()` is SSR-safe (server snapshot `{traveler:null}`), so this never flashes
 * on an SSR frame — it simply renders nothing until resolved.
 *
 * CORS NOTE: the Worker only answers requests whose `Origin` matches its configured
 * `ALLOWED_ORIGIN` (the real deployed GitHub Pages origin) — so a live call only works from that
 * deployed origin, never from `localhost` in dev. This is expected and not worked around here.
 */
export function ConciergeChat({ side = 'right' }: { side?: 'right' | 'bottom' }) {
  const { traveler } = useActiveTraveler();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { messages, status, error, send, retry } = useConciergeChat();
  // The app-wide offline banner is `fixed` at z-40 and this panel's overlay is z-50, so while the
  // sheet is open that banner is behind it and invisible — this surface has to state the condition
  // itself. Same reading as the banner (`useOnline`), not a second signal.
  const online = useOnline();
  // The itinerary store is read directly here (not via useItineraryContext) so this self-contained
  // navbar panel stays independently mountable/testable. createReactiveStore backs both instances
  // on the SAME localStorage + `itinerary:changed` event bus, so a write here re-reads into
  // the context copy the calendar/dashboard show — fully consistent, no divergence.
  const store = useItinerary();
  const { plans } = store;
  // Which proposal chips the user has already acted on, and which way. Keyed per turn + op content
  // (validateOps re-runs each render against LIVE plans, so a positional index would be unstable;
  // content is stable regardless of which ops survive).
  const [resolvedOps, setResolvedOps] = useState<Record<string, Resolution>>({});
  // Issue #19 — the refusal for the last blocked Confirm, per chip (same `opKey`), or absent.
  // It is the result of pressing Confirm, exactly like a form validation message: it stays until
  // that chip is confirmed again (which re-checks against live plans) or dismissed. Deliberately
  // NOT auto-cleared on a `plans` change — `useItinerary` rebuilds `plans` on every render
  // (`visiblePlans(plans)` is a fresh array each time), so an effect keyed on it would fire in a
  // loop rather than on a real edit.
  const [clashByOp, setClashByOp] = useState<Record<string, string>>({});

  // — "every time I send a message I have to re-click the textbox". Root cause was
  // `disabled={status==='streaming'}` on the input: disabling blurs it and nothing ever restored
  // focus, so Enter-to-send worked exactly once per pointer click. The `disabled` is gone (both
  // re-entrancy guards — handleSubmit's status check and the hook's sendingRef — already prevent a
  // double send, and typing the next message while a reply streams is now possible), and this
  // effect restores focus on the streaming→idle edge for the pointer-send path, where focus sits on
  // the send button. Guarded so it never STEALS focus: only if focus is nowhere (body) or still
  // inside this panel. Hooks run before the gate below — this must stay above that early return.
  const inputRef = useRef<HTMLInputElement>(null);
  const prevStatus = useRef(status);
  useEffect(() => {
    const was = prevStatus.current;
    prevStatus.current = status;
    if (was !== 'streaming' || status === 'streaming') return;
    const el = inputRef.current;
    if (!el || document.activeElement === el) return;
    const active = document.activeElement;
    const inPanel = el.closest('[data-testid="concierge-panel"]');
    if (!active || active === document.body || (inPanel && inPanel.contains(active))) el.focus();
  }, [status]);

  if (!isConciergeConfigured() || !traveler) return null;

  const opKey = (turnIndex: number, op: Op) => `${turnIndex}::${JSON.stringify(op)}`;
  const resolve = (key: string, state: Resolution['state'], label: string) =>
    setResolvedOps((prev) => ({ ...prev, [key]: { state, label } }));

  // Execute ONLY on explicit confirm: route through useItinerary(), then
  // offer undo capturing pre-state. Dismiss just drops the chip — nothing mutates.
  const confirmOp = (key: string, op: Op, label: string) => {
    // Issue #19 / D-316 — the concierge's Confirm was the one authoring surface Slice A left
    // unguarded. On a collision NOTHING is applied and `resolve(key)` is NOT called, so the chip
    // stays on screen and the proposal is still there to confirm once the clash is settled — the
    // "not add anything until that's settled" half, which is the non-negotiable part. The check
    // is here and not in `isValidOp` on purpose: `validateOps` drops silently, so a conflicting
    // suggestion would have vanished from the chat instead of explaining itself.
    const clash = clashForOp(op, plans);
    if (clash) {
      setClashByOp((prev) => ({
        ...prev,
        // `describeClash` is the same fragment the five surfaces D-316 guards use, so the two
        // refusals can never name the same collision differently.
        [key]: `Nothing changed — this overlaps ${describeClash(clash)}. Ask me for a different time, or change that plan first, then confirm again.`,
      }));
      return;
    }
    const { message, undo } = applyOp(op, store, plans);
    showUndoToast(message, undo);
    resolve(key, 'applied', label);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || status === 'streaming') return;
    const toSend = draft;
    setDraft('');
    void send(toSend);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          data-testid="concierge-trigger"
          aria-label="Open trip concierge chat"
          className="inline-flex min-h-tap min-w-tap items-center justify-center gap-1.5 rounded-r1 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface-low))] px-2.5 font-sans text-t-label font-semibold text-ink-hi outline-none transition-colors hover:bg-[rgb(var(--surface-overlay))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3.5"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Concierge</span>
        </button>
      </SheetTrigger>
      {/* `p-0` and the per-band padding below are what let the rows run edge to edge; `pr-16` on
          the header reserves the Radix close control's 44px box at `right-4`. */}
      <SheetContent
        side={side}
        data-testid="concierge-panel"
        className="sheet-surface flex h-[100dvh] w-full flex-col gap-0 p-0 sm:max-w-lg"
      >
        <SheetHeader className="shrink-0 space-y-1.5 border-b-hair border-[color:hsl(var(--border))] px-gut pb-3 pr-16 pt-5 text-left">
          {/* Not `.sec`: its `.sec h2` (0,1,1) beats SheetTitle's own (0,1,0) type utilities and
              printed this title uppercase at 12.75px. `.sub` goes with it — it needs a `.sec`. */}
          <div className="flex items-baseline justify-between gap-3">
            <SheetTitle>Trip concierge</SheetTitle>
            {/* The product rule, printed in the running head rather than left to be discovered:
                this surface proposes and the traveller applies. */}
            <span className="text-right text-t-micro font-medium text-[color:var(--text-lo)]">
              Proposes · you apply
            </span>
          </div>
          {/* (owner ruling Q5): the web-search leg is DELETED, so the old
              "AI and search services" is no longer true — and neither is the plural: the ladder
              is one provider (two of its models, `worker/src/providers.ts` GROQ_MODELS), so
              "services" would have been a second false note. "here" stays: it scopes the storage
              claim to this panel rather than reading as a claim about the whole data path
              */}
          <SheetDescription className="text-t-sm">
            Ask about the Nepal &amp; Japan itinerary. Your messages and trip details go to a
            third-party AI provider that may retain and review them on free plans — the model
            that answers is named under each reply. Nothing is stored here; the chat clears on
            reload.
          </SheetDescription>
        </SheetHeader>

        {/* The app-wide offline banner is `fixed` under this sheet's own overlay, so it cannot be
            read while the panel is open — this band is the panel's own copy of that condition, in
            its own material (dashed rule on the recessed step, never a tint of the panel). The
            region is mounted whatever the reading, so going offline is a TEXT change inside a live
            region rather than a node insertion, which is what gets it announced. */}
        <div role="status" aria-live="polite" className="shrink-0 empty:hidden">
          {!online && (
            <p
              data-testid="concierge-offline"
              className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b-hair border-dashed border-[color:var(--text-lo)] bg-[rgb(var(--surface-low))] px-gut py-2"
            >
              <WifiOff className="h-4 w-4 shrink-0 text-[color:var(--text-lo)]" aria-hidden="true" />
              <span className="pr">Net · Offline</span>
              <span className="text-t-sm text-ink-mid">
                Nothing can be sent until there is a signal. The thread stays on screen.
              </span>
            </p>
          )}
        </div>

        <div
          role="log"
          aria-live="polite"
          aria-label="Concierge conversation"
          data-testid="concierge-messages"
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-gut py-3"
        >
          {messages.length === 0 && (
            <div data-testid="concierge-empty">
              <p className="pr pr--lo">Thread · Empty</p>
              <p className="empty mt-1.5">
                Nothing asked yet. The concierge answers questions about this trip and can propose
                changes to the plan — it never applies one until you press Apply.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    data-testid="concierge-starter-chip"
                    onClick={() => void send(prompt)}
                    className="inline-flex min-h-tap items-center rounded-r1 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface-low))] px-3 text-t-sm text-ink-mid outline-none transition-colors hover:bg-[rgb(var(--surface-overlay))] hover:text-ink-hi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((turn, i) => {
            // Only the LAST turn can be the one in flight, so the streaming annunciator can never
            // land on an older reply that has already finished.
            const live = status === 'streaming' && i === messages.length - 1;
            return (
            <Fragment key={i}>
              {/* 🔴 opacity starts at FADE_FLOOR, NOT 0 — the same rule, and the same reason, as
                  every other reveal in the app (see lib/motion.ts). A wrapper opacity MULTIPLIES
                  its text's alpha, and the axe pass runs WITHOUT reduced motion, so it can and
                  does sample a frame mid-flight: this bubble was scanned at `opacity: 0` and its
                  text composited to #898491 on the panel, 4.06:1 — a serious
                  color-contrast violation on a turn that reads pure white to a human eye. The
                  slide (`y`) is the reveal anyone actually perceives; at 0.95 the fade is close
                  to imperceptible, which is exactly why it costs nothing to make it legal. */}
              <m.div
                initial={{ opacity: FADE_FLOOR, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                // ROLE IS MATERIAL, not a lighter tint of one surface: what the traveller said is a
                // filled block on the raised step, what came back is unfilled and carries a printed
                // rule instead. Each also names itself in words on the line above.
                //
                // The testid sits on the CONTENT node inside, never on this wrapper: three specs
                // read `concierge-turn-*`.textContent as the message itself, so a role label inside
                // that element would silently become part of the transcript they assert on.
                className={
                  turn.role === 'user'
                    ? 'ml-auto w-fit max-w-[86%] rounded-r2 bg-[rgb(var(--surface-overlay))] px-3 py-2'
                    : // `hsl(var(--accent))`, NOT `var(--accent)` — the token is a bare HSL
                      // TRIPLET, so a bare `var()` in a colour position is invalid CSS, the whole
                      // declaration is dropped and the rule silently falls back to currentColor.
                      `mr-4 border-l-2 pl-3 ${
                        live
                          ? 'border-[color:hsl(var(--accent))]'
                          : 'border-[color:var(--border-ui)]'
                      }`
                }
              >
                <p
                  className={
                    live && turn.role === 'assistant'
                      ? 'pr text-[color:hsl(var(--accent))]'
                      : 'pr pr--lo'
                  }
                >
                  {turn.role === 'user'
                    ? 'You'
                    : live
                      ? turn.content
                        ? 'Concierge · Receiving'
                        : 'Concierge · Thinking'
                      : 'Concierge'}
                </p>
                <div
                  data-testid={`concierge-turn-${turn.role}`}
                  className={`mt-1 break-words text-t-body text-ink-hi ${
                    turn.role === 'user' ? 'whitespace-pre-wrap' : ''
                  }`}
                >
                  {turn.role === 'assistant' ? (
                    turn.content ? (
                      renderAssistantContent(turn.content)
                    ) : live ? (
                      // The wait states its condition as a real text node, so there is nothing
                      // motion-dependent here for prefers-reduced-motion to have to switch off.
                      <span
                        data-testid="concierge-thinking"
                        className="load pr pr--lo inline-flex bg-[rgb(var(--surface-overlay))] px-2 py-1"
                      >
                        Waiting for the first words…
                      </span>
                    ) : null
                  ) : (
                    turn.content
                  )}
                </div>
              </m.div>

              {/* which model answered, small + low-emphasis, matching the panel's
                  established secondary tone. `turn.model` is already collapsed to "real non-empty
                  string, or undefined" in the hook — a plain truthiness check is the whole
                  guard, on purpose. Renders
                  nothing at all — no "unknown", no placeholder — when absent, which is the normal
                  case against the deployed v1.4.0 Worker. */}
              {turn.role === 'assistant' && turn.model && (
                <p
                  data-testid="concierge-turn-model"
                  className="mr-4 pl-3 font-machine text-t-micro tracking-[0.1em] text-ink-lo"
                >
                  {turn.model}
                </p>
              )}

              {/* Proposal chips — validated against LIVE plans at render time so a stale
                  op (target since deleted) drops, and says why it dropped (#13). Nothing
                  mutates until Confirm. */}
              {turn.role === 'assistant' &&
                turn.ops &&
                (() => {
                  const valid = validateOps(turn.ops!, plans);
                  // a drop used to be INVISIBLE — the model proposed a change, validation
                  // rejected it (bad date, mangled #id), and the user saw a reply with no chip and
                  // no explanation ("the concierge can't modify my plans"). Count only ops that
                  // neither survived nor were already acted on (a confirmed removeItem legitimately
                  // stops validating once its target is gone — that is not a drop).
                  const dropped = turn.ops!.filter(
                    (op) => !valid.includes(op) && !resolvedOps[opKey(i, op)],
                  );
                  // Issue #13 — and WHY, which is the half that was missing. Derived at RENDER
                  // time from `(rawOp, plans)`, never held in state: `useItinerary().plans` has a
                  // fresh identity every render, so an effect keyed on it is an infinite loop, not
                  // a cache (D-316's addendum records that trap). Deduped by CODE, so a model that
                  // fluffs three dates the same way says it once. `?? 'unreadable'` is
                  // unreachable — an op with no reason is by definition in `valid` — and exists
                  // only so the copy switch is total without a filter.
                  const reasons = [
                    ...new Set(dropped.map((op) => dropReason(op, plans) ?? 'unreadable')),
                  ].map(dropMessage);
                  return (
                    <>
                      {/* THREE STATES, THREE MATERIALS. A live proposal is a boxed form drawn on
                          the recessed step, stamped NOT APPLIED and carrying two real labelled
                          controls; an applied one becomes a struck receipt row; a dismissed one a
                          hollow receipt row. It iterates `turn.ops`, not `valid`, because a
                          confirmed removeItem stops validating the moment its target is gone and
                          its receipt has to survive that. */}
                      {turn.ops!.map((op) => {
                        const key = opKey(i, op);
                        const done = resolvedOps[key];
                        if (done) {
                          return (
                            <div
                              key={key}
                              data-testid="concierge-op-resolved"
                              data-state={done.state}
                              className="mr-4 flex items-start gap-2 border-b-hair border-[color:hsl(var(--border))] py-2"
                            >
                              <span
                                aria-hidden="true"
                                className={`mt-0.5 ${done.state === 'applied' ? 'mk mk--struck' : 'mk mk--hollow'}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="pr block">
                                  {done.state === 'applied' ? 'Applied' : 'Dismissed'}
                                </span>
                                <span
                                  className={`mt-0.5 block break-words text-t-sm ${
                                    done.state === 'applied' ? 'text-ink-mid' : 'text-ink-lo'
                                  }`}
                                >
                                  {done.label}
                                </span>
                              </span>
                            </div>
                          );
                        }
                        if (!valid.includes(op)) return null;
                        const label = describeOp(op, plans);
                        return (
                          <div
                            key={key}
                            role="group"
                            aria-label={`Proposed change: ${label}`}
                            data-testid="concierge-op-chip"
                            className="mr-4 border-2 border-[color:var(--border-ui)] bg-[rgb(var(--surface-low))] p-gut"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="stamp stamp--dry">Proposed</span>
                              <span className="pr pr--lo">Not applied</span>
                            </div>
                            <p className="mt-2 break-words text-t-body text-ink-hi">{label}</p>
                            <p className="mt-1 text-t-sm text-ink-mid">
                              Nothing on your itinerary changes until you apply this.
                            </p>
                            {/* Two labelled controls of equal weight — the confirm is a decision,
                                so it is never the only thing you can press and never an icon whose
                                meaning has to be guessed. */}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                data-testid="concierge-op-confirm"
                                onClick={() => confirmOp(key, op, label)}
                                aria-label={`Apply: ${label}`}
                                className="btn flex-1 basis-32"
                              >
                                <Check className="h-4 w-4" aria-hidden="true" />
                                Apply
                              </button>
                              <button
                                type="button"
                                data-testid="concierge-op-dismiss"
                                onClick={() => resolve(key, 'dismissed', label)}
                                aria-label={`Dismiss: ${label}`}
                                className="btn btn--2 flex-1 basis-32"
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                                Dismiss
                              </button>
                            </div>
                            {/* Issue #19 — the refusal, INSIDE its own chip so it can never be
                                read against the wrong proposal. A BLOCKED user action, so
                                `role="alert"` (assertive), not `role="status"` — the pattern
                                backup-restore.tsx / photo-attach.tsx and D-316's five surfaces
                                already use. Always mounted with one line of reserved height, so
                                the live region exists before it has anything to say and the
                                announcement is a text change rather than a node insertion — which
                                is what makes it reliably announced. (The chip does still grow when
                                the message wraps past that line; the reserve buys the live region,
                                not a fixed height.) Focus is deliberately NOT moved: it is already on the
                                Confirm button the user just pressed, which is where they act
                                next. No shake, no flash — nothing motion-dependent to reduce. */}
                            <p
                              role="alert"
                              data-testid="concierge-op-clash"
                              className="err mt-2 min-h-[1rem] text-t-sm"
                            >
                              {clashByOp[key]}
                            </p>
                          </div>
                        );
                      })}
                      {/* Issue #13 — ONE line, evolved rather than doubled: the count that
                          shipped at S342 plus the reason it was missing. A plain <p>, NOT
                          `role="alert"` — a drop is not a blocked user action, it is part of the
                          reply, and it is already inside the panel's `role="log" aria-live=
                          "polite"` region, so it is announced with the turn it belongs to. The
                          assertive region above is for the Confirm refusal, which answers a press. */}
                      {dropped.length > 0 && (
                        <p
                          data-testid="concierge-ops-dropped"
                          className="mr-4 border-hair border-dashed border-[color:var(--text-lo)] px-3 py-1.5 text-t-sm text-ink-mid"
                        >
                          {dropped.length} suggested change{dropped.length === 1 ? '' : 's'}{' '}
                          didn&rsquo;t match the current plan: {reasons.join('; ')}.
                        </p>
                      )}
                    </>
                  );
                })()}
            </Fragment>
            );
          })}
        </div>

        {/* Every error a mounted panel can show came from a real send attempt (the
            "not configured" branch is unreachable here — the whole panel is gated on the same
            `isConciergeConfigured()`), so a single "Try again" that re-sends the last turn is
            always the right next action. One control, no auto-retry, no backoff. */}
        {error && (
          <div
            role="alert"
            data-testid="concierge-error"
            className="shrink-0 border-t-2 border-[color:hsl(var(--destructive))] bg-[rgb(var(--surface-low))] px-gut py-2.5"
          >
            <p className="flex items-center gap-2">
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-[color:hsl(var(--destructive))]"
                aria-hidden="true"
              />
              {/* The condition in words as well as in colour — `.err` is destructive ink on the
                  recessed step, measured 5.58:1. */}
              <span className="pr err">Error</span>
            </p>
            <p className="mt-1 break-words text-t-sm text-ink-hi">{error}</p>
            <button
              type="button"
              data-testid="concierge-retry"
              onClick={() => void retry()}
              disabled={status === 'streaming'}
              className="btn btn--2 mt-2 w-full"
            >
              Try again
            </button>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex shrink-0 items-center gap-2 border-t-hair border-[color:hsl(var(--border))] px-gut pb-2 pt-3"
        >
          <label htmlFor="concierge-input" className="sr-only">
            Message the concierge
          </label>
          <input
            id="concierge-input"
            data-testid="concierge-input"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the concierge…"
            autoComplete="off"
            // — the privacy label's a11y association. The header disclosure is a Radix
            // `SheetDescription`, which Radix wires to the DIALOG via `aria-describedby`; a
            // second paragraph inherits NOTHING from that, so the label below is pointed at the
            // one control the user is actually typing into. Screen-reader order becomes:
            // "Message the concierge, edit text, Sent to a third-party AI — nothing stored here."
            aria-describedby={PRIVACY_NOTE_ID}
            className="min-h-tap min-w-0 flex-1 rounded-r1 border-hair border-[color:var(--border-ui)] bg-[rgb(var(--surface-low))] px-3 text-t-body text-ink-hi outline-none placeholder:text-ink-lo focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="submit"
            data-testid="concierge-send"
            disabled={!draft.trim() || status === 'streaming'}
            aria-label="Send message"
            className="btn min-w-tap shrink-0 px-3"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>

        {/* (owner ruling Q5, second half) — the small privacy label, sited at the input
            rather than buried in the header paragraph, because this is where the user decides
            what to type. `text-ink-mid` is the same tone the SheetDescription already uses and
            already clears the axe colour-contrast check on this panel. The bottom inset is what
            keeps it clear of the home indicator now the panel runs edge to edge. */}
        <p
          id={PRIVACY_NOTE_ID}
          data-testid="concierge-privacy-note"
          className="shrink-0 px-gut pb-[max(env(safe-area-inset-bottom),0.75rem)] text-t-micro text-ink-mid"
        >
          Sent to a third-party AI — nothing stored here.
        </p>
      </SheetContent>
    </Sheet>
  );
}

export default ConciergeChat;
