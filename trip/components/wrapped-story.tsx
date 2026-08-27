'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Share2, MapPin, CheckCircle2, Wallet, BookOpen, Camera, Backpack, FileCheck2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getNow } from '@/lib/trip-now';
import { deriveWrapped, type WrappedStats } from '@/core/recap/wrapped';
import { useItineraryContext } from '@/components/itinerary-provider';
import { useExpenses } from '@/hooks/use-expenses';
import { useJournal } from '@/hooks/use-journal';
import { usePhotos } from '@/hooks/use-photos';
import { usePacking } from '@/hooks/use-packing';
import { useDocs } from '@/hooks/use-docs';
import { legCurrency, formatMoney, LEGS, type Leg } from '@/core/budget/model';
import { legLabel } from '@/lib/leg-label';
import { getActiveTrip } from '@/core/trips';
import { Reveal } from '@/components/reveal';
import CelebrationBurst from '@/components/celebration-burst';
import SectionSkeleton from '@/components/section-skeleton';

/**
 * WrappedStory — the "Trip Wrapped" capstone: a read-only, headline-stat summary layered
 * BELOW the entry card on `/recap`, composed by `core/recap/wrapped.ts::deriveWrapped` over every
 * EXISTING read-only domain (itinerary, expenses, journal, photos, packing, docs — ZERO
 * writes, no new persisted state). Mounted as its own lazy island (`app/recap/sections.tsx`) below
 * `<TripStoryRecap/>`, composed onto the page WITHOUT touching that component's internals.
 *
 * Unlike `trip-story-recap.tsx` (locked until `isPostTrip`), the wrapped summary is
 * ALWAYS-AVAILABLE with honest status-aware copy (a deliberate call) — "so far" mid-
 * trip, the full "wrapped" post-trip, and a light pre-trip state — because every underlying stat
 * (packing/docs readiness, activities already planned) is legitimately useful before the trip ends,
 * not only as a retrospective.
 *
 * Reduced motion: every reveal panel routes through the existing `<Reveal/>`
 * primitive (`components/reveal.tsx`), which already calls `useReducedMotion()` explicitly to pick
 * its render path — this file ALSO calls `useReducedMotion()` directly (a second, local, explicit
 * guard) to skip the celebration burst and to render the share icon without any hover/tap spring.
 * The one-shot completion burst reuses `<CelebrationBurst/>` verbatim — it already renders
 * nothing under reduced motion.
 */

/** The resolved clock's LOCAL calendar day as 'YYYY-MM-DD' (matches trip-story-recap.tsx's helper;
 * duplicated here rather than imported so this island stays independently composable —
 * does not touch trip-story-recap.tsx's internals, and the helper isn't exported). */
function nowDateString(): string {
  const d = getNow();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

const STATUS_COPY: Record<WrappedStats['status'], { eyebrow: string; title: string; blurb: (s: WrappedStats) => string }> = {
  pre: {
    eyebrow: 'Coming together',
    title: 'Your trip, wrapped',
    blurb: () => 'The countdown is on — your wrapped summary fills in the moment the trip begins.',
  },
  mid: {
    eyebrow: 'So far',
    title: 'Your trip, wrapped (so far)',
    blurb: (s) => `${s.daysElapsed} of ${s.totalTripDays} days in — here&rsquo;s the story building so far.`,
  },
  post: {
    eyebrow: 'The whole journey',
    title: 'Your trip, wrapped',
    blurb: (s) => `All ${s.totalTripDays} days, one headline summary.`,
  },
};

/** A compact, human, TEXT-only share summary. Emoji fine, no markdown. */
function buildShareText(stats: WrappedStats): string {
  const parts: string[] = [];
  const tripLabel = getActiveTrip().legs.map((l) => l.countryLabel).join(' × ');
  parts.push(
    `✈️ ${tripLabel} trip, wrapped — ${stats.daysElapsed}/${stats.totalTripDays} days${
      stats.status === 'post' ? ' lived' : ' in'
    }, ${stats.activitiesDone}/${stats.activitiesPlanned} activities done.`,
  );

  const spendBits: string[] = [];
  for (const leg of LEGS) {
    const legSpend = stats.spend[leg];
    if (legSpend.total > 0) {
      const top = legSpend.topCategory;
      spendBits.push(
        `${formatMoney(legSpend.total, legCurrency(leg))} in ${legLabel(leg)}${top ? ` (top: ${capitalize(top.category)})` : ''}`,
      );
    }
  }
  if (spendBits.length > 0) parts.push(`💰 Spent ${spendBits.join(' + ')}.`);

  if (stats.journalCount > 0) parts.push(`📓 ${stats.journalCount} journal ${stats.journalCount === 1 ? 'entry' : 'entries'}.`);
  if (stats.photoCount > 0) parts.push(`📸 ${stats.photoCount} ${stats.photoCount === 1 ? 'photo' : 'photos'} captured.`);
  if (stats.packing.total > 0) parts.push(`🎒 ${stats.packing.checked}/${stats.packing.total} packed.`);
  if (stats.docs.total > 0) parts.push(`📄 ${stats.docs.done}/${stats.docs.total} documents ready.`);

  return parts.join(' ');
}

/** Feature-detected share: real OS share sheet when available, else clipboard + toast fallback
 * */
async function shareWrapped(stats: WrappedStats) {
  const text = buildShareText(stats);
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const title = 'Our trip, wrapped';

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
    } catch {
      /* user cancelled / share failed — no fallback toast, matches the OS share sheet's own UX */
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(url ? `${text} ${url}` : text);
    toast.success('Copied your wrapped summary to the clipboard');
  } catch {
    toast.error('Could not copy — your browser blocked clipboard access');
  }
}

export default function WrappedStory() {
  const { plans, hydrated: itineraryHydrated } = useItineraryContext();
  const { expenses, hydrated: expensesHydrated } = useExpenses();
  const { entries: journalEntries, hydrated: journalHydrated } = useJournal();
  const { photos, hydrated: photosHydrated } = usePhotos();
  const { items: packingItems, hydrated: packingHydrated } = usePacking();
  const { items: docItems, hydrated: docsHydrated } = useDocs();
  const reducedMotion = useReducedMotion();

  const [nowDateStr, setNowDateStr] = useState('');
  useEffect(() => {
    setNowDateStr(nowDateString());
  }, []);

  const hydrated =
    itineraryHydrated &&
    expensesHydrated &&
    journalHydrated &&
    photosHydrated &&
    packingHydrated &&
    docsHydrated &&
    nowDateStr !== '';

  const stats = useMemo(
    () =>
      deriveWrapped(
        { plans, expenses, journalEntries, photos, packingItems, docItems },
        hydrated ? nowDateStr : '',
      ),
    [plans, expenses, journalEntries, photos, packingItems, docItems, hydrated, nowDateStr],
  );

  // One-shot completion flourish: fires only the first time the FULL post-trip wrapped
  // becomes available while mounted — never on a re-render, never under reduced motion (mirrors
  // `crossedIntoComplete`'s "first observation never fires" guard, `lib/celebration.ts`).
  const firedRef = useRef(false);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!hydrated || stats.status !== 'post' || firedRef.current) return;
    firedRef.current = true;
    setCelebrate(true);
    const t = setTimeout(() => setCelebrate(false), 700);
    return () => clearTimeout(t);
  }, [hydrated, stats.status]);

  if (!hydrated) {
    return (
      <div data-testid="wrapped-story">
        <SectionSkeleton height="50vh" count={3} contentClassName="max-w-3xl" />
      </div>
    );
  }

  const copy = STATUS_COPY[stats.status];

  return (
    <section
      id="trip-wrapped"
      aria-labelledby="wrapped-title"
      data-testid="wrapped-story"
      data-wrapped-status={stats.status}
      className="px-gutter py-section"
    >
      <div className="mx-auto max-w-3xl">
        <Reveal>
          <div className="relative">
            <div data-testid="wrapped-entry" className="mx-auto border-hair border-border bg-surface-low p-8 text-center sm:p-12">
              <CelebrationBurst
                active={celebrate && !reducedMotion}
                testId="wrapped-celebration"
                celebrationId="wrapped-post-trip"
                weight="burst"
              />
              <p className="pr mb-3">{copy.eyebrow}</p>
              <h2 id="wrapped-title" className="text-display-lg text-ink-hi mb-3">
                <span>{copy.title}</span>
              </h2>
              <p data-testid="wrapped-blurb" className="mx-auto max-w-xl text-t-lead leading-relaxed text-ink-mid">
                {copy.blurb(stats)}
              </p>
              <button
                type="button"
                data-testid="wrapped-share"
                onClick={() => void shareWrapped(stats)}
                className="btn mx-auto mt-6 px-5"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share your wrapped
              </button>
            </div>
          </div>
        </Reveal>

        <div className="cells mt-6 grid-cols-1 sm:grid-cols-2">
          <Reveal>
            <StatPanel testId="wrapped-stat-days" icon={<MapPin className="h-4 w-4" aria-hidden="true" />} label="Days lived">
              <span className="num block text-n-lg leading-none text-ink-hi">{stats.daysElapsed}</span> of {stats.totalTripDays} trip days
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-activities" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} label="Activities">
              <span className="num block text-n-lg leading-none text-ink-hi">{stats.activitiesDone}</span> of {stats.activitiesPlanned} planned{' '}
              activities done
            </StatPanel>
          </Reveal>

          <Reveal className="sm:col-span-2">
            <StatPanel testId="wrapped-stat-spend" icon={<Wallet className="h-4 w-4" aria-hidden="true" />} label="Spend">
              <div className="flex flex-col gap-1">
                {LEGS.map((leg) => (
                  <LegSpendLine key={leg} leg={leg} spend={stats.spend[leg]} />
                ))}
                {LEGS.every((leg) => stats.spend[leg].total === 0) && (
                  <span className="empty">Unwritten &mdash; nothing logged yet</span>
                )}
              </div>
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-journal" icon={<BookOpen className="h-4 w-4" aria-hidden="true" />} label="Journal">
              <span className="num block text-n-lg leading-none text-ink-hi">{stats.journalCount}</span>{' '}
              {stats.journalCount === 1 ? 'entry' : 'entries'} written
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-photos" icon={<Camera className="h-4 w-4" aria-hidden="true" />} label="Photos">
              <span className="num block text-n-lg leading-none text-ink-hi">{stats.photoCount}</span>{' '}
              {stats.photoCount === 1 ? 'photo' : 'photos'} captured
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-packing" icon={<Backpack className="h-4 w-4" aria-hidden="true" />} label="Packing">
              <span className="num block text-n-lg leading-none text-ink-hi">{stats.packing.checked}</span> of {stats.packing.total} packed
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-docs" icon={<FileCheck2 className="h-4 w-4" aria-hidden="true" />} label="Documents">
              <span className="num block text-n-lg leading-none text-ink-hi">{stats.docs.done}</span> of {stats.docs.total} ready
            </StatPanel>
          </Reveal>
        </div>

        <footer className="mt-8 flex items-center justify-center gap-1.5 text-center text-t-sm text-ink-mid">
          <Sparkles className="h-3.5 w-3.5 text-ink-lo" aria-hidden="true" />
          That&rsquo;s the trip, wrapped up in numbers.
        </footer>
      </div>
    </section>
  );
}

function StatPanel({
  testId,
  icon,
  label,
  children,
}: {
  testId: string;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className="cell h-full">
      <p className="l !flex items-center gap-1.5">
        <span aria-hidden="true">{icon}</span>
        {label}
      </p>
      {/* #101 — a <div>, not a <p>: the Spend panel passes a flex column as `children`,
          and <div> inside <p> is invalid DOM (React logs on every /recap visit). */}
      <div className="f !normal-case !tracking-normal">{children}</div>
    </div>
  );
}

function LegSpendLine({ leg, spend }: { leg: Leg; spend: WrappedStats['spend'][Leg] }) {
  if (spend.total === 0) return null;
  return (
    <span data-testid={`wrapped-spend-${leg}`}>
      <span className="pr">{legLabel(leg)}</span>{' '}
      <span className="num text-n-sm text-ink-hi">{formatMoney(spend.total, legCurrency(leg))}</span>
      {spend.topCategory && (
        <span className="text-ink-mid"> · top category {capitalize(spend.topCategory.category)}</span>
      )}
    </span>
  );
}
