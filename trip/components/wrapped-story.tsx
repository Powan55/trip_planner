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
import { legCurrency, formatMoney } from '@/core/budget/model';
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
 * ALWAYS-AVAILABLE with honest status-aware copy (engineer's call, per the brief) — "so far" mid-
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
 * duplicated here rather than imported so this island stays independently composable — brief
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
  parts.push(
    `✈️ Nepal × Japan trip, wrapped — ${stats.daysElapsed}/${stats.totalTripDays} days${
      stats.status === 'post' ? ' lived' : ' in'
    }, ${stats.activitiesDone}/${stats.activitiesPlanned} activities done.`,
  );

  const spendBits: string[] = [];
  if (stats.spend.nepal.total > 0) {
    const top = stats.spend.nepal.topCategory;
    spendBits.push(
      `${formatMoney(stats.spend.nepal.total, legCurrency('nepal'))} in Nepal${top ? ` (top: ${capitalize(top.category)})` : ''}`,
    );
  }
  if (stats.spend.japan.total > 0) {
    const top = stats.spend.japan.topCategory;
    spendBits.push(
      `${formatMoney(stats.spend.japan.total, legCurrency('japan'))} in Japan${top ? ` (top: ${capitalize(top.category)})` : ''}`,
    );
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
        <SectionSkeleton height="50vh" count={3} />
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
            <div data-testid="wrapped-entry" className="glass-card mx-auto rounded-3xl p-8 text-center sm:p-12">
              <CelebrationBurst active={celebrate && !reducedMotion} testId="wrapped-celebration" />
              <p className="text-eyebrow mb-3 uppercase text-gold-400/80">{copy.eyebrow}</p>
              <h2 id="wrapped-title" className="font-display text-2xl sm:text-3xl font-bold text-white mb-3">
                <span className="text-gradient-gold">{copy.title}</span>
              </h2>
              <p data-testid="wrapped-blurb" className="mx-auto max-w-xl text-base leading-relaxed text-white/65">
                {copy.blurb(stats)}
              </p>
              <button
                type="button"
                data-testid="wrapped-share"
                onClick={() => void shareWrapped(stats)}
                className="mt-6 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-gold-400/30 bg-gold-400/[0.08] px-5 py-2.5 text-sm font-semibold text-gold-400 transition-colors hover:bg-gold-400/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share your wrapped
              </button>
            </div>
          </div>
        </Reveal>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Reveal>
            <StatPanel testId="wrapped-stat-days" icon={<MapPin className="h-4 w-4" aria-hidden="true" />} label="Days lived">
              <span className="font-semibold text-gold-400">{stats.daysElapsed}</span> of {stats.totalTripDays} trip days
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-activities" icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />} label="Activities">
              <span className="font-semibold text-gold-400">{stats.activitiesDone}</span> of {stats.activitiesPlanned} planned{' '}
              activities done
            </StatPanel>
          </Reveal>

          <Reveal className="sm:col-span-2">
            <StatPanel testId="wrapped-stat-spend" icon={<Wallet className="h-4 w-4" aria-hidden="true" />} label="Spend">
              <div className="flex flex-col gap-1">
                <LegSpendLine leg="nepal" spend={stats.spend.nepal} />
                <LegSpendLine leg="japan" spend={stats.spend.japan} />
                {stats.spend.nepal.total === 0 && stats.spend.japan.total === 0 && (
                  <span className="text-white/50">Nothing logged yet</span>
                )}
              </div>
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-journal" icon={<BookOpen className="h-4 w-4" aria-hidden="true" />} label="Journal">
              <span className="font-semibold text-gold-400">{stats.journalCount}</span>{' '}
              {stats.journalCount === 1 ? 'entry' : 'entries'} written
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-photos" icon={<Camera className="h-4 w-4" aria-hidden="true" />} label="Photos">
              <span className="font-semibold text-gold-400">{stats.photoCount}</span>{' '}
              {stats.photoCount === 1 ? 'photo' : 'photos'} captured
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-packing" icon={<Backpack className="h-4 w-4" aria-hidden="true" />} label="Packing">
              <span className="font-semibold text-gold-400">{stats.packing.checked}</span> of {stats.packing.total} packed
            </StatPanel>
          </Reveal>

          <Reveal>
            <StatPanel testId="wrapped-stat-docs" icon={<FileCheck2 className="h-4 w-4" aria-hidden="true" />} label="Documents">
              <span className="font-semibold text-gold-400">{stats.docs.done}</span> of {stats.docs.total} ready
            </StatPanel>
          </Reveal>
        </div>

        <footer className="mt-8 flex items-center justify-center gap-1.5 text-center text-sm italic text-white/45">
          <Sparkles className="h-3.5 w-3.5 text-gold-400/60" aria-hidden="true" />
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
    <div data-testid={testId} className="glass-card h-full rounded-2xl p-5">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-gold-400/80">
        <span aria-hidden="true">{icon}</span>
        {label}
      </p>
      <p className="text-sm leading-relaxed text-white/80">{children}</p>
    </div>
  );
}

function LegSpendLine({ leg, spend }: { leg: 'nepal' | 'japan'; spend: WrappedStats['spend']['nepal'] }) {
  if (spend.total === 0) return null;
  return (
    <span data-testid={`wrapped-spend-${leg}`}>
      <span className="font-semibold text-white/90">{capitalize(leg)}:</span>{' '}
      <span className="font-semibold text-gold-400">{formatMoney(spend.total, legCurrency(leg))}</span>
      {spend.topCategory && (
        <span className="text-white/55"> — top category {capitalize(spend.topCategory.category)}</span>
      )}
    </span>
  );
}
