'use client';

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
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
  BookOpen,
  ShieldCheck,
  Scroll,
  Settings,
  Coins,
  Backpack,
  Inbox,
  FileCheck2,
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
import { scrollToSectionWhenReady } from '@/lib/scroll-to-hash';
import { loadPlans } from '@/lib/itinerary-storage';
import { searchPlanItems } from '@/lib/search-plan';
import { formatDate, type DayPlan } from '@/lib/trip-data';
import { parseConversionQuery, convertCurrency, type ConversionResult } from '@/lib/currency-convert';

/**
 * ⌘K / Ctrl+K command palette.
 *
 * Keyboard-first navigation to any destination in the app. Mounted ONCE at the
 * app root (see app/layout.tsx) so the shortcut works from anywhere. Since the
 * v2 route split every target is a `{ route, hash? }` pair: selection
 * navigates via `useRouter().push(route + hash)`.
 * A SAME-route hash keeps the direct `scrollIntoView` path; a CROSS-route hash
 * defers through `scrollToSectionWhenReady` (bounded rAF poll + double-rAF once
 * the `ssr:false` island mounts — the navbar pattern), because the target
 * does not exist in the DOM until the destination page's chunks load.
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
 * reduce (instant jump) — scrollToSectionWhenReady applies the same rule. No
 * framer-motion is introduced here, so the LazyMotion `strict` flag is irrelevant
 * to this file.
 *
 * Matching: a custom deterministic `filter` (scoreItem) replaces cmdk's built-in
 * fuzzy scorer, which was loose enough to rank "nepal" → "Itinerary Planner" (…Planner)
 * above the actual Nepal item. scoreItem ranks exact label substrings first, keyword
 * aliases below them, and drops weak fuzzy noise — verified in headless Chrome.
 * scoreItem is UNTOUCHED by.
 *
 * Search-within-plan bridge. This component is mounted OUTSIDE
 * `ItineraryProvider` (see app/layout.tsx), so it cannot call `useItineraryContext()`.
 * Instead, on each OPEN it takes an on-demand READ-ONLY snapshot via
 * `loadPlans()` (the same non-hook Vault-backed source `use-itinerary` reads) — no
 * persistent second store, no provider move, preserved (never writes). While
 * typing, the snapshot is run through the pure `searchPlanItems` matcher and any hits
 * render as a dynamic "In your plan" `CommandGroup` below the static section groups.
 * Because those items are already pre-filtered by title/notes/category, the dynamic
 * "In your plan" group and its items are rendered with cmdk's `forceMount` — they opt
 * OUT of cmdk's own filter/score/visibility machinery entirely (see the CommandGroup
 * below for the specific cmdk-internals trap this sidesteps) and are shown/hidden
 * purely by our own `planResults`. Selecting a result defers to the same
 * close-then-navigate pattern as a section pick, but routes via `?focus=<itemId>`
 * (consumed by calendar-planner.tsx) instead of a hash.
 *
 * Currency converter command. A typeahead-parse command, not a separate
 * popover/panel — the smaller diff against this file's existing static/dynamic-group
 * shape ( "In your plan" group above is the direct precedent: a computed
 * `CommandGroup`, `forceMount`ed, shown/hidden purely by our own state rather than
 * cmdk's filter). Typing "100 usd to jpy" is parsed by the pure `parseConversionQuery`;
 * a match renders a single result `CommandItem` under a "Currency Converter" heading,
 * populated by `convertCurrency` (lib/currency-convert.ts), which is a thin wrapper over
 * `fetchCurrencyRate` (lib/currency-rate.ts) — same cache, same NPR
 * short-circuit, no second fetch path. Selecting the result is a no-op (there is nowhere
 * to navigate to; it's a read-only answer), so the palette stays open for editing the
 * query further.
 */

type Section = {
  route: string; // canonical trailing-slash route ('/', '/plan/', …)
  hash?: string; // optional sub-anchor WITH the leading '#'
  label: string;
  group: 'Plan' | 'Destinations' | 'Guides' | 'More';
  keywords?: string[]; // extra alias terms for fuzzy matching
  icon: React.ComponentType<{ className?: string }>;
};

// Targets follow the route tree; hash sub-anchors match the section ids
// kept on each page. Photography/Nightlife point at /nepal/ (the guide pages'
// canonical home, mirroring the legacy-hash redirect map); Travel Essentials is
// the renamed Home half of the old Travel Inspiration section (id stays
// `inspiration`).
const SECTIONS: Section[] = [
  { route: '/', hash: '#dashboard', label: 'Countdown Dashboard', group: 'Plan', keywords: ['countdown', 'timer', 'days', 'home'], icon: Gauge },
  { route: '/', hash: '#timeline', label: 'Trip Timeline', group: 'Plan', keywords: ['schedule', 'days', 'route'], icon: ListOrdered },
  { route: '/plan/', label: 'Itinerary Planner', group: 'Plan', keywords: ['calendar', 'plan', 'events'], icon: Calendar },
  { route: '/flights/', label: 'Flights', group: 'Plan', keywords: ['airport', 'travel', 'arrivals', 'departures'], icon: Plane },
  { route: '/nepal/', label: 'Nepal', group: 'Destinations', keywords: ['kathmandu', 'himalaya', 'pokhara'], icon: Mountain },
  { route: '/japan/', label: 'Japan', group: 'Destinations', keywords: ['tokyo', 'kyoto', 'osaka'], icon: Compass },
  { route: '/nepal/', hash: '#photography', label: 'Photography Guide', group: 'Guides', keywords: ['camera', 'photos', 'gear', 'spots'], icon: Camera },
  { route: '/nepal/', hash: '#nightlife', label: 'Nightlife & Bars', group: 'Guides', keywords: ['clubs', 'drinks', 'bars', 'night'], icon: Wine },
  { route: '/map/', label: 'Map', group: 'Guides', keywords: ['locations', 'pins', 'regions'], icon: MapIcon },
  { route: '/', hash: '#inspiration', label: 'Travel Essentials', group: 'Guides', keywords: ['inspiration', 'weather', 'ideas'], icon: Sparkles },
  // the 3 companion routes — deliberately kept off the desktop top row (
  // width ceiling) and off the mobile tab bar; the palette is
  // their desktop discoverability path (the mobile hamburger panel is the other).
  { route: '/journal/', label: 'Journal', group: 'More', keywords: ['diary', 'notes', 'entries'], icon: BookOpen },
  { route: '/safety/', label: 'Safety', group: 'More', keywords: ['emergency', 'embassy', 'phrasebook'], icon: ShieldCheck },
  { route: '/packing/', label: 'Packing', group: 'More', keywords: ['checklist', 'luggage', 'gear', 'clothes'], icon: Backpack }, //
  { route: '/checklist/', label: 'Documents', group: 'More', keywords: ['passport', 'visa', 'insurance', 'tickets', 'checklist', 'readiness', 'documents'], icon: FileCheck2 }, //
  { route: '/share/', label: 'Shared Links', group: 'More', keywords: ['share', 'inbox', 'links', 'shared', 'triage'], icon: Inbox }, //
  { route: '/recap/', label: 'Recap', group: 'More', keywords: ['story', 'summary', 'post-trip'], icon: Scroll },
  { route: '/settings/', label: 'Settings', group: 'More', keywords: ['identity', 'currency', 'rates', 'sign out', 'clear', 'backup', 'export', 'import'], icon: Settings }, //
];

// Trailing-slash-agnostic pathname compare (mirrors navbar.tsx).
function normalizePath(p: string | null): string {
  const stripped = (p ?? '/').replace(/\/+$/, '');
  return stripped === '' ? '/' : stripped;
}

const GROUP_ORDER: Section['group'][] = ['Plan', 'Destinations', 'Guides', 'More'];

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

// Trims a converted amount to a readable 2-decimal-max display (no new dependency —
// Intl.NumberFormat is a native platform feature).
function formatConvertedAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function CommandPalette() {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // Focus-return shim: the element focused at the moment the palette opened, so we can
  // restore focus on close. Radix's FocusScope does NOT restore focus when the dialog
  // is opened programmatically (no DialogTrigger) — it sends focus to <body>. We snapshot
  // here on open and restore in DialogContent's onCloseAutoFocus (the correct Radix hook).
  const triggerRef = React.useRef<HTMLElement | null>(null);
  // Set when a selection requested navigation; consumed after the dialog finishes closing
  // so the route push / scroll happens once the overlay is gone (avoids competing with
  // focus teardown).
  const pendingTarget = React.useRef<{ route: string; hash?: string } | null>(null);
  // set when a search-within-plan RESULT was picked (instead of a section);
  // consumed the same deferred way, but routes via `?focus=` rather than performNavigate.
  const pendingPlanFocus = React.useRef<string | null>(null);

  // the on-demand, read-only plan snapshot + the live search query. Re-read fresh
  // every time the palette opens (loadPlans() is a cheap synchronous localStorage read),
  // so a change made elsewhere in the app is never stale the next time ⌘K opens.
  const [plansSnapshot, setPlansSnapshot] = React.useState<DayPlan[]>([]);
  const [query, setQuery] = React.useState('');

  const snapshotTrigger = React.useCallback(() => {
    triggerRef.current = (document.activeElement as HTMLElement) ?? null;
  }, []);

  React.useEffect(() => {
    if (open) {
      setPlansSnapshot(loadPlans());
      setQuery('');
    }
  }, [open]);

  const planResults = React.useMemo(
    () => (query.trim() ? searchPlanItems(plansSnapshot, query) : []),
    [plansSnapshot, query],
  );

  // currency-converter command. `parsedConversion` is a pure, synchronous parse of
  // the live query ("100 usd to jpy"); `conversionResult` is filled in async (it may need
  // a fetchCurrencyRate round-trip) and reset to null (→ "Converting…") on every new parse.
  const parsedConversion = React.useMemo(() => parseConversionQuery(query), [query]);
  const [conversionResult, setConversionResult] = React.useState<ConversionResult | null>(null);

  React.useEffect(() => {
    if (!parsedConversion) {
      setConversionResult(null);
      return;
    }
    setConversionResult(null); // show "Converting…" while this query's lookup is in flight
    let ignore = false;
    convertCurrency(parsedConversion).then((result) => {
      if (!ignore) setConversionResult(result);
    });
    return () => {
      ignore = true;
    };
  }, [parsedConversion]);

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

  /**
   * route-aware navigation.
   * - SAME route + hash → the section is already mounted: direct scrollIntoView
   * (reduced-motion 'auto') + history.replaceState of the hash, exactly the
   * behavior. (If the island hasn't mounted yet — e.g. palette used instantly
   * after load — fall back to the bounded poll.)
   * - SAME route, no hash → scroll to top (the page IS the destination).
   * - CROSS route → router.push(route + hash). The hash target is a `ssr:false`
   * island that does not exist until the destination page mounts, so the scroll
   * defers through scrollToSectionWhenReady (bounded rAF poll + double-rAF —
   * the navbar pattern). Fire-and-forget by design: the poll must survive
   * the route transition.
   */
  const performNavigate = React.useCallback((target: { route: string; hash?: string }) => {
    const sameRoute = normalizePath(pathname) === normalizePath(target.route);
    const id = target.hash ? target.hash.slice(1) : null;

    if (sameRoute) {
      if (!id) {
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        return;
      }
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        });
      } else {
        scrollToSectionWhenReady(id);
      }
      // Reflect the destination in the URL hash without a jumpy history entry, matching
      // native anchor behavior (and helping deep-linking / screen readers).
      if (typeof history !== 'undefined' && history.replaceState) {
        history.replaceState(null, '', target.hash);
      }
      return;
    }

    router.push(target.route + (target.hash ?? ''));
    if (id) scrollToSectionWhenReady(id);
  }, [pathname, router]);

  const handleSelect = React.useCallback((target: { route: string; hash?: string }) => {
    // Defer navigation until the dialog has closed (onCloseAutoFocus), then close.
    pendingTarget.current = target;
    setOpen(false);
  }, []);

  // a plan-search RESULT was picked — same defer-then-close pattern, routed via
  // `?focus=<itemId>` instead of a hash (calendar-planner.tsx's `?focus=` reader).
  const handleSelectPlanItem = React.useCallback((itemId: string) => {
    pendingPlanFocus.current = itemId;
    setOpen(false);
  }, []);

  // Fires exactly when Radix would auto-focus on close. We preventDefault (Radix would
  // otherwise focus <body> since there's no trigger) and restore focus to the opener,
  // then run any pending navigation. This is the reliable focus-return path:
  // focus is restored BEFORE the route push, so an opener that lives in the persistent
  // layout (navbar, etc.) keeps focus across the transition.
  const handleCloseAutoFocus = React.useCallback((e: Event) => {
    e.preventDefault();
    const target = triggerRef.current;
    triggerRef.current = null;
    if (target && typeof target.focus === 'function') target.focus();
    const pending = pendingTarget.current;
    pendingTarget.current = null;
    if (pending) performNavigate(pending);
    const planFocusId = pendingPlanFocus.current;
    pendingPlanFocus.current = null;
    // Always push (never a same-route scroll-only shortcut like performNavigate's hash
    // case): even when already on /plan, the query param must change for calendar-
    // planner's `useSearchParams` reader to react and re-apply the highlight.
    if (planFocusId) router.push(`/plan/?focus=${encodeURIComponent(planFocusId)}`);
  }, [performNavigate, router]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        onCloseAutoFocus={handleCloseAutoFocus}
        className="overflow-hidden p-0 shadow-lg max-w-[92vw] sm:max-w-lg"
        data-testid="command-palette-dialog"
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
          // globals.css color tokens are untouched.
          filter={scoreItem}
          className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
        >
          <CommandInput
            placeholder="Jump to a section…"
            aria-label="Jump to a section"
            onValueChange={setQuery}
          />
          <CommandList>
            {/* cmdk's own "no results" count only tracks items IT registers/
                scores (see the CommandGroups below — our dynamic groups opt out of that
                via forceMount), so gate this on OUR OWN dynamic-group state too —
                otherwise "No matching section." could render ALONGSIDE a real "In your
                plan" or "Currency Converter" hit. */}
            {planResults.length === 0 && !parsedConversion && <CommandEmpty>No matching section.</CommandEmpty>}
            {GROUP_ORDER.map((group) => (
              <CommandGroup key={group} heading={group}>
                {SECTIONS.filter((s) => s.group === group).map((section) => {
                  const Icon = section.icon;
                  return (
                    <CommandItem
                      key={`${section.route}${section.hash ?? ''}`}
                      value={section.label}
                      keywords={section.keywords}
                      onSelect={() => handleSelect({ route: section.route, hash: section.hash })}
                      className="gap-3"
                    >
                      <Icon className="shrink-0 text-gold-400" />
                      <span className="truncate">{section.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
            {/* dynamic search-within-plan results, read-only over the on-demand
                loadPlans() snapshot. WE already decide membership (via our own
                `searchPlanItems` matcher, computed outside cmdk), so this group and its
                items are `forceMount`ed — cmdk's OWN filter/score/visibility bookkeeping
                is bypassed entirely for them. This sidesteps a real cmdk-internals trap:
                a registered item's score is only recomputed when its `value` STRING
                changes, but `value` must also stay STABLE for arrow-key/Enter selection
                to track the same item across keystrokes — those two requirements
                conflict for a live-updating search-query keyword match, and fighting
                cmdk's own filter pass here is more fragile than simply not entering it.
                Only rendered when there is at least one hit, so an empty query never
                shows an empty "In your plan" heading. */}
            {planResults.length > 0 && (
              <CommandGroup heading="In your plan" forceMount>
                {planResults.map(({ item, date }) => (
                  <CommandItem
                    key={item.id}
                    forceMount
                    value={`${item.title}-${item.id}`}
                    onSelect={() => handleSelectPlanItem(item.id)}
                    className="gap-3"
                    data-testid={`palette-plan-result-${item.id}`}
                  >
                    <Calendar className="shrink-0 text-gold-400" />
                    <span className="truncate flex-1">{item.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatDate(date)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {/* currency-converter command. Same forceMount rationale as "In your
                plan" above — membership is decided entirely by OUR OWN parse (-aware
                convertCurrency), not cmdk's filter. A no-op onSelect: this item is a
                read-only computed answer, not a navigation target. */}
            {parsedConversion && (
              <CommandGroup heading="Currency Converter" forceMount>
                <CommandItem
                  forceMount
                  value={`convert-${query}`}
                  onSelect={() => {}}
                  className="gap-3"
                  data-testid="palette-currency-result"
                  data-conversion-status={conversionResult?.status ?? 'loading'}
                >
                  <Coins className="shrink-0 text-gold-400" />
                  {conversionResult === null && (
                    <span className="truncate text-muted-foreground">
                      Converting {parsedConversion.amount} {parsedConversion.from} to {parsedConversion.to}…
                    </span>
                  )}
                  {conversionResult?.status === 'ok' && (
                    <span className="truncate flex-1">
                      {parsedConversion.amount} {parsedConversion.from} = {formatConvertedAmount(conversionResult.converted)} {parsedConversion.to}
                      {conversionResult.stale && (
                        <span className="ml-2 text-xs text-muted-foreground">(cached, as of {conversionResult.asOf})</span>
                      )}
                    </span>
                  )}
                  {conversionResult?.status === 'unavailable' && (
                    <span className="truncate text-muted-foreground">
                      {conversionResult.currency} rate unavailable — no cached rate yet
                    </span>
                  )}
                </CommandItem>
              </CommandGroup>
            )}
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
