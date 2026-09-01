'use client';

import * as React from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Calendar,
  Gauge,
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
  Luggage,
  MapPin,
  User,
  Stamp,
} from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { scrollToSectionWhenReady } from '@/lib/scroll-to-hash';
import { loadPlans } from '@/lib/itinerary-storage';
import { searchPlanItems } from '@/lib/search-plan';
import { formatDate, type DayPlan } from '@/lib/trip-data';
import { parseConversionQuery, convertCurrency, type ConversionResult } from '@/lib/currency-convert';
import { isDefaultTrip } from '@/core/trips';
import { normalizePath, routeLabel } from '@/lib/nav-items';
import { prefersReducedMotion } from '@/lib/motion';

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
 * lands on <body> after Esc. So we add explicit focus-return: snapshot
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
 * Material: `.list` rows on --surface-low inside the shared Radix dialog. Row state is the
 * recipe's own — `.list .r[aria-selected='true']` paints the volt wash plus a 3px inset
 * rule, and cmdk drives `aria-selected` for BOTH the arrow-key highlight and pointer hover,
 * so the two states can never disagree. Measured through the grain multiplier on
 * --surface-low: text-hi 18.02 / 15.79 hover / 14.79 selected, text-mid 10.99 / 9.63 / 9.02,
 * text-lo 6.94 / 6.08 / 5.70 — every row state clears AA on every tier.
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
// canonical home, mirroring the legacy-hash redirect map); Travel Inspiration is
// Home's photo-gallery section (id stays `inspiration`, as it has through every
// rename of that slot).
const SECTIONS: Section[] = [
  { route: '/', hash: '#dashboard', label: 'Dashboard', group: 'Plan', keywords: ['countdown', 'timer', 'days', 'home'], icon: Gauge },
  // (#94) "Trip Timeline" (`/#timeline`) was removed: the section left Home for /plan in S321
  // — so this entry had been landing on Home with no `#timeline` to scroll to — and #94 deleted
  // the section outright as a duplicate of the planner. "Itinerary Planner" below is the target
  // it should have pointed at, and it already carries the `days` keyword.
  { route: '/plan/', label: 'Itinerary Planner', group: 'Plan', keywords: ['calendar', 'plan', 'events', 'schedule', 'days', 'timeline'], icon: Calendar },
  { route: '/flights/', label: 'Flights', group: 'Plan', keywords: ['airport', 'travel', 'arrivals', 'departures'], icon: Plane },
  { route: '/nepal/', label: 'Nepal', group: 'Destinations', keywords: ['kathmandu', 'himalaya', 'pokhara'], icon: Mountain },
  { route: '/japan/', label: 'Japan', group: 'Destinations', keywords: ['tokyo', 'kyoto', 'osaka'], icon: Compass },
  { route: '/nepal/', hash: '#photography', label: 'Photography Guide', group: 'Guides', keywords: ['camera', 'photos', 'gear', 'spots'], icon: Camera },
  { route: '/nepal/', hash: '#nightlife', label: 'Nightlife & Bars', group: 'Guides', keywords: ['clubs', 'drinks', 'bars', 'night'], icon: Wine },
  { route: '/map/', label: 'Map', group: 'Guides', keywords: ['locations', 'pins', 'regions'], icon: MapIcon },
  { route: '/', hash: '#inspiration', label: 'Travel Inspiration', group: 'Guides', keywords: ['inspiration', 'ideas', 'photos', 'highlights', 'gallery'], icon: Sparkles },
  // the 3 companion routes — deliberately kept off the desktop top row (
  // width ceiling) and off the mobile tab bar; the palette is
  // their desktop discoverability path (the mobile hamburger panel is the other).
  { route: '/journal/', label: 'Journal', group: 'More', keywords: ['diary', 'notes', 'entries'], icon: BookOpen },
  { route: '/safety/', label: 'Safety', group: 'More', keywords: ['emergency', 'embassy', 'phrasebook'], icon: ShieldCheck },
  { route: '/packing/', label: 'Packing', group: 'More', keywords: ['checklist', 'luggage', 'gear', 'clothes'], icon: Backpack }, //
  { route: '/checklist/', label: 'Documents', group: 'More', keywords: ['passport', 'visa', 'insurance', 'tickets', 'checklist', 'readiness', 'documents'], icon: FileCheck2 }, //
  { route: '/share/', label: 'Shared Links', group: 'More', keywords: ['share', 'inbox', 'links', 'shared', 'triage'], icon: Inbox }, //
  { route: '/share/', label: 'Import a place', group: 'More', keywords: ['import', 'place', 'google', 'maps', 'link', 'paste'], icon: MapPin }, //
  { route: '/recap/', label: 'Recap', group: 'More', keywords: ['story', 'summary', 'post-trip'], icon: Scroll },
  { route: '/trips/', label: 'Trips', group: 'More', keywords: ['switch', 'create', 'join', 'share', 'key', 'manage'], icon: Luggage }, //
  { route: '/profile/', label: 'Profile', group: 'More', keywords: ['visited', 'countries', 'cities', 'been there', 'travel history', 'lifetime'], icon: User }, // issue #4
  { route: '/passport/', label: 'Passport', group: 'More', keywords: ['stamps', 'countries', 'collection', 'souvenir', 'keepsake'], icon: Stamp }, // issue #5
  { route: '/settings/', label: 'Settings', group: 'More', keywords: ['identity', 'currency', 'rates', 'sign out', 'clear', 'backup', 'export', 'import'], icon: Settings }, //
];

const GROUP_ORDER: Section['group'][] = ['Plan', 'Destinations', 'Guides', 'More'];

// The row and group recipes, once. `[--lead:22px]` is the sanctioned custom-property hatch
// for the icon column and `!items-center` the sanctioned `!` — `.list .r` is (0,2,0) and a
// bare `grid-cols-*`/`items-center` utility is (0,1,0), so neither would apply.
const ROW = 'r grid w-full [--lead:22px] !items-center';
const ROW_ICON = 'h-[18px] w-[18px] shrink-0 text-[color:var(--text-lo)]';
const GROUP = 'p-0 [&_[cmdk-group-heading]]:px-gut [&_[cmdk-group-heading]]:py-2';

// (Plan D10): routes that only exist for the default N×J trip — dropped from the
// palette on a custom trip (Nepal/Japan/Flights, plus their #photography/#nightlife
// sub-anchors which target /nepal/).
const DEFAULT_TRIP_ONLY_ROUTES = new Set(['/nepal/', '/japan/', '/flights/']);

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

// How long typing has to settle before the converter goes to the network.
const CONVERSION_DEBOUNCE_MS = 400;

// Trims a converted amount to a readable 2-decimal-max display (no new dependency —
// Intl.NumberFormat is a native platform feature).
function formatConvertedAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Issue #24: the local copy of the media-query read is gone — `prefersReducedMotion`
// is imported from lib/motion.ts, the one place the preference is read.

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

  // (Plan D10): CommandPalette is imported directly into the root layout (a Server
  // Component), so — unlike Navbar/BottomTabBar — it DOES render server-side. SSR always
  // resolves the default pack (`core/trips/index.ts`), so the un-mounted render below must
  // keep the full SECTIONS list to match; after mount we re-evaluate against the real
  // active-trip pointer and drop the N×J-specific entries on a custom trip.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const sections = React.useMemo(
    () =>
      mounted && !isDefaultTrip()
        ? SECTIONS.filter((s) => !DEFAULT_TRIP_ONLY_ROUTES.has(s.route))
        : SECTIONS,
    [mounted],
  );

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

  // One live lookup per currency PAIR per session, and only once typing settles. `parsedConversion`
  // is a fresh object on every keystroke that still parses, so this effect used to fire a brand-new
  // Frankfurter fetch per character (#117). Rate is fetched for ONE unit and scaled here, so
  // changing only the amount never costs a request. Mirrors lib/world-search.ts's resultCache
  // gate for the same class of free third-party API. Failures are not cached, so they stay
  // retryable.
  const rateCache = React.useRef(new Map<string, ConversionResult>());

  React.useEffect(() => {
    if (!parsedConversion) {
      setConversionResult(null);
      return;
    }
    const { amount, from, to } = parsedConversion;
    const scale = (unit: ConversionResult): ConversionResult =>
      unit.status === 'ok' ? { ...unit, converted: unit.converted * amount } : unit;

    const cached = rateCache.current.get(`${from}|${to}`);
    if (cached) {
      setConversionResult(scale(cached));
      return;
    }
    setConversionResult(null); // show "Converting…" while this query's lookup is in flight
    let ignore = false;
    const timer = setTimeout(() => {
      convertCurrency({ amount: 1, from, to }).then((unit) => {
        if (unit.status === 'ok') rateCache.current.set(`${from}|${to}`, unit);
        if (!ignore) setConversionResult(scale(unit));
      });
    }, CONVERSION_DEBOUNCE_MS);
    return () => {
      ignore = true;
      clearTimeout(timer);
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

  // the desktop navbar's "More" menu Search row has no DOM trigger of its own
  // to snapshot-focus-then-click (Radix normally wants a real `<button>` in the DOM to
  // treat as opener) — it closes ITS OWN menu first (returning focus to the More
  // toggle), then fires this plain `window` CustomEvent so the palette opens as a
  // clean second action. Snapshot the opener the same way the ⌘K path does, since by
  // the time this fires `document.activeElement` is already back on the More toggle
  // (closeMore's synchronous focus-return runs before the event dispatch).
  React.useEffect(() => {
    const onPaletteOpen = () => {
      snapshotTrigger();
      setOpen(true);
    };
    window.addEventListener('palette:open', onPaletteOpen);
    return () => window.removeEventListener('palette:open', onPaletteOpen);
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
        className="max-w-[92vw] overflow-hidden p-0 shadow-2xl sm:max-w-lg"
        data-testid="command-palette-dialog"
      >
        {/* Visually-hidden labelling satisfies the Radix Dialog a11y contract
            (required title) without a visible header or a console warning. The
            description carries the keyboard contract in words — the footer below states
            the same thing in key caps and is aria-hidden, so it is never read as glyphs. */}
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search and jump to any section of the trip planner, or type an amount such as 100
          USD to JPY to convert it. Use the up and down arrow keys to move through the
          results, Enter to open the highlighted one, and Escape to close.
        </DialogDescription>

        <Command
          // Custom deterministic matcher (scoreItem): exact label substrings rank
          // first, keyword aliases below them, loose fuzzy noise is dropped. Replaces
          // cmdk's built-in scorer, which mis-ranked "nepal" → "Itinerary Planner".
          // value = clean label; keywords prop carries the aliases (fed to scoreItem).
          filter={scoreItem}
          className="bg-[rgb(var(--surface-low))] [&_[cmdk-input-wrapper]]:border-b-2 [&_[cmdk-input-wrapper]]:px-gut"
        >
          <CommandInput
            placeholder="Jump to a section…"
            aria-label="Jump to a section"
            onValueChange={setQuery}
            // ui/command.tsx ships `outline-none` on the input, which also kills the
            // app-wide :focus-visible fallback. The one focusable control in the palette
            // gets its ring back explicitly rather than relying on the caret alone.
            className="focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:hsl(var(--accent))]"
          />
          {/* Empty search states what the list IS before anything is typed. Outside
              CommandList on purpose: cmdk's list is a `role="listbox"` and a paragraph is
              not an allowed owned child of one. */}
          {!query.trim() && (
            <p className="pr pr--lo border-b-hair border-[color:hsl(var(--border))] px-gut py-2">
              {sections.length} destinations · type to filter, or convert an amount
            </p>
          )}
          <CommandList className="list max-h-[min(60vh,26rem)]">
            {/* cmdk's own "no results" count only tracks items IT registers/
                scores (see the CommandGroups below — our dynamic groups opt out of that
                via forceMount), so gate this on OUR OWN dynamic-group state too —
                otherwise the no-results frame could render ALONGSIDE a real "In your
                plan" or "Currency Converter" hit. */}
            {planResults.length === 0 && !parsedConversion && (
              <CommandEmpty>
                {/* SPEC 9.8: the shape of the thing that is missing, and the condition in
                    words — never a grey sentence. Spans, not paragraphs: this sits inside
                    the listbox, where `paragraph` is not an allowed child role. */}
                <div className="empty-frame mx-gut px-gut py-5 text-left">
                  <span className="block">Nothing here matches what you typed.</span>
                  <span className="pr pr--lo mt-2 block">
                    Try a route name, a city, or an amount like 100 usd to jpy
                  </span>
                </div>
              </CommandEmpty>
            )}
            {GROUP_ORDER.filter((group) => sections.some((s) => s.group === group)).map((group) => (
              <CommandGroup key={group} heading={group} className={GROUP}>
                {sections.filter((s) => s.group === group).map((section) => {
                  const Icon = section.icon;
                  const here = normalizePath(pathname) === normalizePath(section.route);
                  const destination = routeLabel(section.route, section.hash);
                  return (
                    <CommandItem
                      // Key on the (unique) label — two entries now share the /share/ route
                      //, so route+hash is no longer unique.
                      key={section.label}
                      value={section.label}
                      keywords={section.keywords}
                      onSelect={() => handleSelect({ route: section.route, hash: section.hash })}
                      className={ROW}
                    >
                      <Icon className={ROW_ICON} aria-hidden="true" />
                      <div className="min-w-0">
                        {/* Every row title in this list is `role="presentation"`: a CommandItem
                            is a `role="option"` and an option is children-presentational, so
                            these <h3>s never reached the heading outline — and a listbox row is
                            not a section heading in the first place (#364). The recipe styles
                            `.list h3` by tag, so the paint is unchanged. */}
                        <h3 role="presentation" className="truncate">{section.label}</h3>
                        {/* Suppressed when it would only repeat the title the row already prints. */}
                        {destination !== section.label && (
                          <span className="mt truncate">{destination}</span>
                        )}
                      </div>
                      {here && <span className="chip">Here</span>}
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
              <CommandGroup heading="In your plan" forceMount className={GROUP}>
                {planResults.map(({ item, date }) => (
                  <CommandItem
                    key={item.id}
                    forceMount
                    value={`${item.title}-${item.id}`}
                    onSelect={() => handleSelectPlanItem(item.id)}
                    className={ROW}
                    data-testid={`palette-plan-result-${item.id}`}
                  >
                    <Calendar className={ROW_ICON} aria-hidden="true" />
                    <div className="min-w-0">
                      <h3 role="presentation" className="truncate">{item.title}</h3>
                      <span className="mt truncate">{formatDate(date)}</span>
                    </div>
                    <span className="chip">{item.category}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {/* currency-converter command. Same forceMount rationale as "In your
                plan" above — membership is decided entirely by OUR OWN parse (-aware
                convertCurrency), not cmdk's filter. A no-op onSelect: this item is a
                read-only computed answer, not a navigation target. */}
            {parsedConversion && (
              <CommandGroup heading="Currency Converter" forceMount className={GROUP}>
                <CommandItem
                  forceMount
                  value={`convert-${query}`}
                  onSelect={() => {}}
                  className={ROW}
                  data-testid="palette-currency-result"
                  data-conversion-status={conversionResult?.status ?? 'loading'}
                  aria-busy={conversionResult === null || undefined}
                >
                  <Coins className={ROW_ICON} aria-hidden="true" />
                  {conversionResult === null && (
                    <>
                      <div className="min-w-0">
                        <h3 role="presentation" className="num truncate">
                          {parsedConversion.amount} {parsedConversion.from} → {parsedConversion.to}
                        </h3>
                      </div>
                      {/* Its own material (--surface-raised), not a dimmer copy of the row,
                          and the word is a real text node so it is announced. */}
                      <span className="load pr pr--lo px-2 py-1">Converting</span>
                    </>
                  )}
                  {conversionResult?.status === 'ok' && (
                    <div className="min-w-0">
                      <h3 role="presentation" className="num truncate">
                        {conversionResult.source === 'reference' ? '≈ ' : ''}
                        {parsedConversion.amount} {parsedConversion.from} ={' '}
                        {formatConvertedAmount(conversionResult.converted)} {parsedConversion.to}
                      </h3>
                      {conversionResult.source === 'reference' ? (
                        <span className="mt">
                          reference rate, as of {conversionResult.asOf} — not a live quote
                        </span>
                      ) : (
                        conversionResult.stale && (
                          <span className="mt">cached, as of {conversionResult.asOf}</span>
                        )
                      )}
                    </div>
                  )}
                  {conversionResult?.status === 'unavailable' && (
                    <>
                      <div className="min-w-0">
                        <h3 role="presentation" className="truncate">{conversionResult.currency} rate unavailable</h3>
                        <span className="mt">nothing cached on this device yet</span>
                      </div>
                      <span className="hollow-tag">No rate</span>
                    </>
                  )}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
          <div
            aria-hidden="true"
            className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 border-t-2 border-[color:hsl(var(--border))] px-gut py-2"
          >
            <span className="pr inline-flex items-center gap-1.5">
              <kbd className="chip">↑↓</kbd>Move
            </span>
            <span className="pr inline-flex items-center gap-1.5">
              <kbd className="chip">↵</kbd>Open
            </span>
            <span className="pr inline-flex items-center gap-1.5">
              <kbd className="chip">Esc</kbd>Close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
