'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { m } from 'framer-motion';
import { Sparkles, Send, AlertTriangle, Check, X } from 'lucide-react';
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
import { useConciergeChat } from '@/hooks/use-concierge-chat';
import { useItinerary } from '@/hooks/use-itinerary';
import { validateOps, describeOp, applyOp, type Op } from '@/lib/concierge-ops';
import { showUndoToast } from '@/lib/undo-toast';

// Model output is UNTRUSTED input: only these href schemes become a real <a>; anything else
// (`javascript:`, `data:`) renders as the literal `[text](url)` source text instead.
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;

/**
 * One alternation, tried left to right, so precedence falls out of the order:
 * `code` → [text](url) → **bold** → *italic*
 * Code first so a marker inside a code span is never re-interpreted. `**` before `*` so bold wins
 * at the same index, and the bold body is LAZY `.+?` (not the old `[^*]+`) so `**a*b**` bolds
 * "a*b" instead of falling through as raw punctuation. Italic requires a non-space char on both
 * inner edges so arithmetic like `2 * 3 * 4` is not italicised.
 */
const INLINE = /`([^`]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*(?=\S)(.+?)\*\*|\*(?=\S)([^*\n]*[^\s*])\*/g;

const CODE_CLASS = 'rounded bg-white/10 px-1 py-0.5 font-mono text-[0.9em] text-gold-100/90';

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
        SAFE_HREF.test(href) ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-gold-200 underline underline-offset-2 outline-none hover:text-gold-100 focus-visible:ring-2 focus-visible:ring-gold-400"
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

/**
 * Markdown-lite renderer for assistant replies — NOT a markdown parser, just
 * the constructs the model actually emits, which made load-bearing by deleting the Worker
 * prompt's "plain text only" clause. Per line, one BLOCK element each ( — the old version
 * emitted inline fragments joined by `\n` text nodes, which made indentation and paragraph spacing
 * impossible); the bubble keeps `whitespace-pre-wrap` for code lines and stray leading spaces, but
 * no `\n` nodes are emitted anymore so nothing double-spaces.
 *
 * Handles: `# heading`, `- `/`* ` bullets (one level of nesting), `1.`/`1)` numbered lists,
 * ``` fenced blocks, `inline code`, **bold** (incl. `**a*b**`), *italic*, [links](url) with an
 * href allow-list, and a blank line as a paragraph break. Everything else stays plain text.
 * Pure over the assembled string — safe to re-run on every streamed delta.
 */
export function renderAssistantContent(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let fenced = false;
  let gap = false; // a blank line was seen — the next block carries the paragraph margin

  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      return;
    }
    const block = gap && out.length > 0 ? 'block mt-2' : 'block';

    if (fenced) {
      out.push(
        <span key={i} className={`${block} ${CODE_CLASS}`}>
          {line || ' '}
        </span>,
      );
      gap = false;
      return;
    }
    if (!line.trim()) {
      gap = out.length > 0;
      return;
    }
    gap = false;

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      out.push(
        <strong key={i} className={block}>
          {renderInline(heading[1], i)}
        </strong>,
      );
      return;
    }

    // A bullet marker REQUIRES trailing whitespace, so a line starting `*italic*` / `**bold**`
    // is never eaten as a list item.
    const bullet = /^(\s*)[*-]\s+(.*)$/.exec(line);
    const numbered = bullet ? null : /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const indent = (bullet ?? numbered!)[1].length >= 2 ? 'pl-8' : 'pl-4';
      const marker = bullet ? '•' : `${numbered![2]}.`;
      const body = bullet ? bullet[2] : numbered![3];
      out.push(
        // -indent-4 hangs the marker so wrapped text lines up under the text, not the bullet.
        <span key={i} className={`${block} ${indent} -indent-4`}>
          {`${marker} `}
          {renderInline(body, i)}
        </span>,
      );
      return;
    }

    out.push(
      <span key={i} className={block}>
        {renderInline(line, i)}
      </span>,
    );
  });

  return out;
}

/**
 * AI concierge chat — the client surface for the Cloudflare Worker's `POST` relay
 * Mounted once in the persistent
 * navbar chrome (`components/navbar.tsx`), next to the Travel Mode entry — the "durable entry
 * point mounted once, everywhere" shape established, deliberately WITHOUT that slice's
 * push/replace history machinery (this is a panel, not a route/mode — a trigger button + `Sheet`
 * open state is enough, per the brief).
 *
 * GATING — fully invisible unless BOTH hold (no separate gate duplicated at any call site,
 * mirrors `SyncStatusBadge`'s self-contained render-null pattern):
 * 1. `isConciergeConfigured()` — `NEXT_PUBLIC_CONCIERGE_URL` is set. Unset in EVERY build today
 * (the Worker isn't deployed, `worker/README.md`) — this is the default, dormant state.
 * 2. A resolved, non-guest trip token (`traveler !== null`, guest-wall posture —
 * mirrors `useEnterTravelMode`'s guest check). A guest sees no affordance at all.
 * `useActiveTraveler()` is SSR-safe (server snapshot `{traveler:null,isGuest:false}`), so this
 * never flashes for a guest/SSR frame — it simply renders nothing until resolved.
 *
 * CORS NOTE: the Worker only answers requests whose `Origin` matches its configured
 * `ALLOWED_ORIGIN` (the real deployed GitHub Pages origin) — so a live call only works from that
 * deployed origin, never from `localhost` in dev. This is expected and not worked around here
 *.
 */
export function ConciergeChat() {
  const { traveler } = useActiveTraveler();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const { messages, status, error, send } = useConciergeChat();
  // The itinerary store is read directly here (not via useItineraryContext) so this self-contained
  // navbar panel stays independently mountable/testable. createReactiveStore backs both instances
  // on the SAME localStorage + `itinerary:changed` event bus, so a write here re-reads into
  // the context copy the calendar/dashboard show — fully consistent, no divergence.
  const store = useItinerary();
  const { plans } = store;
  // Which proposal chips the user has already acted on (confirmed OR dismissed), so they don't
  // re-render. Keyed per turn + op content (validateOps re-runs each render against LIVE plans, so
  // a positional index would be unstable; content is stable regardless of which ops survive).
  const [resolvedOps, setResolvedOps] = useState<Set<string>>(new Set());

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
  const resolve = (key: string) =>
    setResolvedOps((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

  // Execute ONLY on explicit confirm: route through useItinerary(), then
  // offer undo capturing pre-state. Dismiss just drops the chip — nothing mutates.
  const confirmOp = (key: string, op: Op) => {
    const { message, undo } = applyOp(op, store, plans);
    showUndoToast(message, undo);
    resolve(key);
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
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full border border-gold-400/30 bg-gold-400/10 px-2.5 text-sm font-medium text-gold-200 outline-none transition-colors hover:bg-gold-400/20 hover:text-gold-100 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none sm:px-3.5"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Concierge</span>
        </button>
      </SheetTrigger>
      <SheetContent
        side="right"
        data-testid="concierge-panel"
        className="glass-card-dark flex w-full flex-col gap-0 border-white/10 text-white sm:max-w-md"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-white">Trip concierge</SheetTitle>
          <SheetDescription className="text-white/55">
            Ask about the Nepal &amp; Japan itinerary. This conversation is local to this session
            only — nothing is saved on reload.
          </SheetDescription>
        </SheetHeader>

        <div
          role="log"
          aria-live="polite"
          aria-label="Concierge conversation"
          data-testid="concierge-messages"
          className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1"
        >
          {messages.length === 0 && (
            <p className="text-sm text-white/40">
              Ask something like &ldquo;What should I pack for Kathmandu in December?&rdquo;
            </p>
          )}
          {messages.map((turn, i) => (
            <Fragment key={i}>
              <m.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                data-testid={`concierge-turn-${turn.role}`}
                className={
                  turn.role === 'user'
                    ? 'ml-6 whitespace-pre-wrap rounded-2xl rounded-br-sm bg-gold-400/15 px-3 py-2 text-sm text-white'
                    : 'mr-6 whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white/5 px-3 py-2 text-sm text-white/85'
                }
              >
                {turn.role === 'assistant'
                  ? turn.content
                    ? renderAssistantContent(turn.content)
                    : status === 'streaming'
                      ? '…'
                      : ''
                  : turn.content}
              </m.div>

              {/* Proposal chips — validated against LIVE plans at render time so a stale
                  op (target since deleted) silently drops. Nothing mutates until Confirm. */}
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
                    (op) => !valid.includes(op) && !resolvedOps.has(opKey(i, op)),
                  ).length;
                  return (
                    <>
                      {valid.map((op) => {
                        const key = opKey(i, op);
                        if (resolvedOps.has(key)) return null;
                        const label = describeOp(op, plans);
                        return (
                          <div
                            key={key}
                            role="group"
                            aria-label={`Proposed change: ${label}`}
                            data-testid="concierge-op-chip"
                            className="mr-6 flex items-center justify-between gap-2 rounded-xl border border-gold-400/25 bg-gold-400/5 px-3 py-2"
                          >
                            <span className="text-sm text-white/90">{label}</span>
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                type="button"
                                data-testid="concierge-op-confirm"
                                onClick={() => confirmOp(key, op)}
                                aria-label={`Confirm: ${label}`}
                                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg bg-gold-500 text-surface outline-none transition-colors hover:bg-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                              >
                                <Check className="h-4 w-4" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                data-testid="concierge-op-dismiss"
                                onClick={() => resolve(key)}
                                aria-label={`Dismiss: ${label}`}
                                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-white/15 bg-white/5 text-white/70 outline-none transition-colors hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {dropped > 0 && (
                        <p
                          data-testid="concierge-ops-dropped"
                          className="mr-6 px-3 text-xs text-white/50"
                        >
                          {dropped} suggested change{dropped === 1 ? '' : 's'} didn&rsquo;t match the
                          current plan.
                        </p>
                      )}
                    </>
                  );
                })()}
            </Fragment>
          ))}
        </div>

        {error && (
          <p
            role="alert"
            data-testid="concierge-error"
            className="mt-3 flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-4 flex items-center gap-2">
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
            className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/35 outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          />
          <button
            type="submit"
            data-testid="concierge-send"
            disabled={!draft.trim() || status === 'streaming'}
            aria-label="Send message"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-gold-500 text-surface outline-none transition-colors hover:bg-gold-400 focus-visible:ring-2 focus-visible:ring-gold-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export default ConciergeChat;
