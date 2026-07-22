'use client';

import { Fragment, useState, type FormEvent } from 'react';
import { m } from 'framer-motion';
import { Sparkles, Send, AlertTriangle } from 'lucide-react';
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

/**
 * Tiny inline markdown-lite renderer for assistant replies — NOT a markdown parser,
 * just the handful of things the model actually emits that were rendering as raw punctuation
 * in a single text node: `**bold**` spans, `# heading` / `* `/`- ` bullet LINES. Runs per-line
 * so it composes with the bubble's `whitespace-pre-wrap` (each line still wraps/breaks as
 * plain text; this only swaps `**…**` runs for a `<strong>` and normalizes bullet markers).
 * Pure over the assembled string — safe to re-run on every streamed delta.
 */
function renderAssistantContent(text: string) {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    let content = line;
    let isHeading = false;
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(content);
    if (headingMatch) {
      content = headingMatch[1];
      isHeading = true;
    }
    const bulletMatch = /^[*-]\s+(.*)$/.exec(content);
    if (bulletMatch) {
      content = `• ${bulletMatch[1]}`;
    }

    // Split on **bold** runs, keeping the delimited groups so we can map them to <strong>.
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((part, j) => {
      const boldMatch = /^\*\*([^*]+)\*\*$/.exec(part);
      if (boldMatch) return <strong key={j}>{boldMatch[1]}</strong>;
      return <Fragment key={j}>{part}</Fragment>;
    });

    const rendered = isHeading ? <strong>{parts}</strong> : parts;
    return (
      <Fragment key={i}>
        {rendered}
        {i < lines.length - 1 ? '\n' : null}
      </Fragment>
    );
  });
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

  if (!isConciergeConfigured() || !traveler) return null;

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
            <m.div
              key={i}
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
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={status === 'streaming'}
            placeholder="Ask the concierge…"
            autoComplete="off"
            className="min-h-[44px] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/35 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 disabled:opacity-60"
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
