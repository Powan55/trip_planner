'use client';

import * as React from 'react';
import {
  Calendar,
  Gauge,
  ListOrdered,
  Plane,
  Mountain,
  Compass,
  Camera,
  Wine,
  Map as MapIcon,
  Sparkles,
} from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command';

/**
 * ⌘K / Ctrl+K command palette (, M11).
 *
 * Keyboard-first navigation to any of the page's anchored sections. Mounted ONCE
 * at the app root (see app/layout.tsx) so the shortcut works from anywhere. It is
 * purely additive: jump-to-section only — jump-to-date / author-filter / add-item
 * are intentionally deferred (out of scope for this slice).
 *
 * A11y: built on the Radix Dialog primitive (via ui/dialog), which traps
 * focus and closes on Esc. Radix does NOT, however, restore focus when the dialog is
 * opened programmatically (no DialogTrigger) — verified in headless Chrome that focus
 * lands on <body> after Esc. So per the brief we add explicit focus-return: snapshot
 * document.activeElement when opening, and in DialogContent's onCloseAutoFocus
 * preventDefault Radix's default and focus the snapshot back. A visually-hidden
 * DialogTitle/Description satisfies Radix's required-title a11y contract without a
 * visible header or console warning.
 *
 * Reduced motion: the dialog's open/close uses CSS keyframes
 * (tailwindcss-animate), already neutralized by globals.css under
 * `prefers-reduced-motion: reduce`. The JS scrollIntoView below is a JS API the CSS
 * `scroll-behavior` rule does NOT govern, so we explicitly pass behavior:'auto' under
 * reduce (instant jump). No framer-motion is introduced here, so the LazyMotion
 * `strict` flag is irrelevant to this file.
 *
 * Matching: a custom deterministic `filter` (scoreItem) replaces cmdk's built-in
 * fuzzy scorer, which was loose enough to rank "nepal" → "Itinerary Planner" (…Planner)
 * above the actual Nepal item. scoreItem ranks exact label substrings first, keyword
 * aliases below them, and drops weak fuzzy noise — verified in headless Chrome.
 */

type Section = {
  id: string; // anchor target WITHOUT the leading '#'
  label: string;
  group: 'Plan' | 'Destinations' | 'Guides';
  keywords?: string[]; // extra alias terms for fuzzy matching (static literals — )
  icon: React.ComponentType<{ className?: string }>;
};

// Anchors are harvested from the live section markup and verified to exist on the
// page (hero/dashboard/timeline/itinerary/flights/nepal/japan/photography/nightlife/
// map/inspiration). The seven navbar items are a subset of these and match exactly.
const SECTIONS: Section[] = [
  { id: 'dashboard', label: 'Countdown Dashboard', group: 'Plan', keywords: ['countdown', 'timer', 'days', 'home'], icon: Gauge },
  { id: 'timeline', label: 'Trip Timeline', group: 'Plan', keywords: ['schedule', 'days', 'route'], icon: ListOrdered },
  { id: 'itinerary', label: 'Itinerary Planner', group: 'Plan', keywords: ['calendar', 'plan', 'events'], icon: Calendar },
  { id: 'flights', label: 'Flights', group: 'Plan', keywords: ['airport', 'travel', 'arrivals', 'departures'], icon: Plane },
  { id: 'nepal', label: 'Nepal', group: 'Destinations', keywords: ['kathmandu', 'himalaya', 'pokhara'], icon: Mountain },
  { id: 'japan', label: 'Japan', group: 'Destinations', keywords: ['tokyo', 'kyoto', 'osaka'], icon: Compass },
  { id: 'photography', label: 'Photography Guide', group: 'Guides', keywords: ['camera', 'photos', 'gear', 'spots'], icon: Camera },
  { id: 'nightlife', label: 'Nightlife & Bars', group: 'Guides', keywords: ['clubs', 'drinks', 'bars', 'night'], icon: Wine },
  { id: 'map', label: 'Map', group: 'Guides', keywords: ['locations', 'pins', 'regions'], icon: MapIcon },
  { id: 'inspiration', label: 'Travel Inspiration', group: 'Guides', keywords: ['ideas', 'blog', 'gallery'], icon: Sparkles },
];

const GROUP_ORDER: Section['group'][] = ['Plan', 'Destinations', 'Guides'];

/**
 * Deterministic matcher passed to cmdk's `filter`. cmdk's built-in command-score is
 * a loose fuzzy scorer — loose enough that "nepal" gets a non-zero score against
 * "Itinerary Planner" and (being first in DOM) wrongly auto-highlights it. This
 * substring-first scorer is fully predictable: an exact label substring always
 * outranks a keyword hit, and weak fuzzy noise is dropped (returns 0 → item hidden).
 *
 * Signature matches cmdk: (value, search, keywords?) => number. `value` is the item's
 * clean label; `keywords` are the alias terms supplied via the CommandItem prop.
 * Returns 0..1 (0 = no match/hidden, higher = ranked first).
 */
export function scoreItem(value: string, search: string, keywords?: string[]): number {
  const q = search.trim().toLowerCase();
  if (!q) return 1; // empty query → show everything
  const label = value.toLowerCase();

  // 1) Label matches rank highest. Word-start/prefix beats a mid-string hit.
  const idx = label.indexOf(q);
  if (idx === 0) return 1;
  if (idx > 0) {
    const prevChar = label[idx - 1];
    const atWordBoundary = prevChar === ' ' || prevChar === '&' || prevChar === '-';
    return atWordBoundary ? 0.95 : 0.85;
  }

  // 2) Keyword (alias) substring matches rank below any label match.
  if (keywords) {
    for (const kw of keywords) {
      const k = kw.toLowerCase();
      if (k === q || k.startsWith(q)) return 0.7;
      if (k.includes(q)) return 0.6;
    }
  }

  // 3) Last resort: a loose subsequence on the LABEL only, but require contiguity-ish
  // quality so noise (e.g. "nepal" vs "Itinerary Planner") is rejected.
  return subsequenceScore(label, q);
}

// Strict-ish subsequence: every query char must appear in order; the score rewards
// contiguous runs and penalizes scatter. Returns 0 when the run is too fragmented
// (threshold) so unrelated items don't surface.
function subsequenceScore(target: string, q: string): number {
  let ti = 0;
  let runs = 0;
  let inRun = false;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = false;
    while (ti < target.length) {
      if (target[ti] === ch) {
        if (!inRun) { runs++; inRun = true; }
        ti++;
        found = true;
        break;
      }
      ti++;
      inRun = false;
    }
    if (!found) return 0; // not a subsequence at all
  }
  // Quality: fewer runs (more contiguous) = better. Reject heavily-fragmented matches.
  const contiguity = 1 - (runs - 1) / q.length; // 1 run => 1.0; many runs => low
  if (contiguity < 0.5) return 0; // too scattered → treat as non-match
  return 0.3 + contiguity * 0.2; // 0.3..0.5, always below keyword/label tiers
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  // Focus-return shim: the element focused at the moment the palette opened, so we can
  // restore focus on close. Radix's FocusScope does NOT restore focus when the dialog
  // is opened programmatically (no DialogTrigger) — it sends focus to <body>. We snapshot
  // here on open and restore in DialogContent's onCloseAutoFocus (the correct Radix hook).
  const triggerRef = React.useRef<HTMLElement | null>(null);
  // Set when a selection requested a scroll; consumed after the dialog finishes closing
  // so the scroll happens once the overlay is gone (avoids competing with focus teardown).
  const pendingScrollId = React.useRef<string | null>(null);

  const snapshotTrigger = React.useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
  }, []);

  // Global ⌘K (mac) / Ctrl+K (win/linux) listener. preventDefault stops the browser's
  // own Ctrl+K (focus address bar / search) from firing.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => {
          if (!prev) snapshotTrigger(); // capture opener before the dialog mounts
          return !prev;
        });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [snapshotTrigger]);

  const handleOpenChange = React.useCallback((next: boolean) => {
    if (next && !triggerRef.current) snapshotTrigger();
    setOpen(next);
  }, [snapshotTrigger]);

  const performScroll = React.useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    });
    // Reflect the destination in the URL hash without a jumpy history entry, matching
    // native anchor behavior (and helping deep-linking / screen readers).
    if (typeof history !== 'undefined' && history.replaceState) {
      history.replaceState(null, '', `#${id}`);
    }
  }, []);

  const handleSelect = React.useCallback((id: string) => {
    // Defer the scroll until the dialog has closed (onCloseAutoFocus), then close.
    pendingScrollId.current = id;
    setOpen(false);
  }, []);

  // Fires exactly when Radix would auto-focus on close. We preventDefault (Radix would
  // otherwise focus <body> since there's no trigger) and restore focus to the opener
  // then run any pending scroll. This is the reliable focus-return path.
  const handleCloseAutoFocus = React.useCallback((e: Event) => {
    e.preventDefault();
    const target = triggerRef.current;
    triggerRef.current = null;
    if (target && typeof target.focus === 'function') target.focus();
    const id = pendingScrollId.current;
    pendingScrollId.current = null;
    if (id) performScroll(id);
  }, [performScroll]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onCloseAutoFocus={handleCloseAutoFocus}
        className="overflow-hidden p-0 shadow-lg max-w-[92vw] sm:max-w-lg"
      >
        {/* Visually-hidden labelling satisfies the Radix Dialog a11y contract
            (required title) without a visible header or a console warning. */}
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search and jump to any section of the trip planner. Press Escape to close.
        </DialogDescription>

        <Command
          // Custom deterministic matcher (scoreItem): exact label substrings rank
          // first, keyword aliases below them, loose fuzzy noise is dropped. Replaces
          // cmdk's built-in scorer, which mis-ranked "nepal" → "Itinerary Planner".
          // value = clean label; keywords prop carries the aliases (fed to scoreItem).
          // globals.css color tokens are untouched ('s lane).
          filter={scoreItem}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
        >
          <CommandInput placeholder="Jump to a section…" aria-label="Jump to a section" />
          <CommandList>
            <CommandEmpty>No matching section.</CommandEmpty>
            {GROUP_ORDER.map((group) => (
              <CommandGroup key={group} heading={group}>
                {SECTIONS.filter((s) => s.group === group).map((section) => {
                  const Icon = section.icon;
                  return (
                    <CommandItem
                      key={section.id}
                      value={section.label}
                      keywords={section.keywords}
                      onSelect={() => handleSelect(section.id)}
                      className="gap-3"
                    >
                      <Icon className="shrink-0 text-gold-400" />
                      <span className="truncate">{section.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>Press</span>
            <CommandShortcut className="ml-0 rounded border border-border px-1.5 py-0.5">Esc</CommandShortcut>
            <span>to close</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
