'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { m, useInView } from 'framer-motion';
import { useCountUp } from '@/hooks/use-count-up';
import { Calendar, MapPin, Camera, UtensilsCrossed, Clock, Globe, Bookmark, Sun, Compass } from 'lucide-react';
import { TRIP_START, TRIP_END, TRIP_DATES, DayPlan } from '@/lib/trip-data';
import { computeCountdown } from '@/lib/countdown';
import { getNow } from '@/lib/trip-now';
import { NEPAL_ATTRACTIONS, NEPAL_FOOD } from '@/lib/nepal-data';
import { JAPAN_ATTRACTIONS, JAPAN_FOOD } from '@/lib/japan-data';
import { PHOTO_SPOTS } from '@/lib/photography-data';
import { useItineraryContext } from '@/components/itinerary-provider';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  // A card is EITHER numeric (animated counter) OR a display string (e.g. Trip Status).
  value?: number;
  display?: string;
  suffix?: string;
  color: string;
  delay: number;
  // Stable E2E hook, distinct per card and namespaced `dashboard-*` so it never
  // collides with the hero's `countdown-*` hooks (both can render on `/`).
  testId: string;
}

function AnimatedCounter({ target, duration = 2000 }: { target: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  // Shared eased count-up (cubic ease-out). The hook owns the reduced-motion
  // guard: under `prefers-reduced-motion: reduce` it skips the rAF loop
  // and reports the final value instantly — closing the gap where this counter
  // previously animated regardless of the user's motion preference. The dashboard
  // stats are static once revealed, so `done` is unused here; `count` settles on
  // `target` exactly at the final frame.
  const { value: count } = useCountUp(target, inView, duration);

  return <span ref={ref} className="font-mono">{count}</span>;
}

function StatCard({ icon, label, value, display, suffix = '', color, delay, testId }: StatCardProps) {
  return (
    <m.div
      data-testid={testId}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5 }}
      className="glass-card rounded-2xl p-5 hover:scale-[1.02] transition-transform duration-300 group"
    >
      <div className={`inline-flex p-2.5 rounded-xl ${color} mb-3`}>
        {icon}
      </div>
      <div className="font-bold text-white mb-1">
        {display !== undefined ? (
          <span className="text-2xl sm:text-3xl">{display}</span>
        ) : (
          <span className="text-3xl sm:text-4xl">
            <AnimatedCounter target={value ?? 0} />{suffix}
          </span>
        )}
      </div>
      <div className="text-sm text-white/50">{label}</div>
    </m.div>
  );
}

// --- Pure, data-derived counts (module/render scope, no clock, no localStorage) ---
// Card 4: distinct countries present in the photography data set (Nepal + Japan = 2).
function distinctCountries(): number {
  return new Set(PHOTO_SPOTS.map((s) => s.country)).size;
}
// Card 5: distinct cities present in the photography data set
// (Nagarkot, Kathmandu, Tokyo, Kyoto = 4).
function distinctCities(): number {
  return new Set(PHOTO_SPOTS.map((s) => s.city)).size;
}

// A day counts as "planned" when it has at least one itinerary item.
function countPlannedDays(plans: DayPlan[]): number {
  return plans.filter((p) => Array.isArray(p.items) && p.items.length > 0).length;
}

export default function TripDashboard() {
  const [mounted, setMounted] = useState(false);
  // Card 2 (days until departure) and Card 3 (status) depend on the clock.
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [tripStatus, setTripStatus] = useState('Upcoming');

  // Card 9 (planned days) now derives from the shared reactive store instead
  // of a mount-only loadPlans() + cross-tab storage listener. A same-tab calendar (or
  // card) edit fans out via the store's CustomEvent, so this count updates
  // live without a reload.
  const { plans } = useItineraryContext();
  const plannedDays = useMemo(() => countPlannedDays(plans), [plans]);

  // Data-derived, clock/storage-independent counts.
  const totalDays = TRIP_DATES.length;
  const countries = useMemo(distinctCountries, []);
  const cities = useMemo(distinctCities, []);
  const attractionsSaved = useMemo(() => NEPAL_ATTRACTIONS.length + JAPAN_ATTRACTIONS.length, []);
  const restaurantsListed = useMemo(() => NEPAL_FOOD.length + JAPAN_FOOD.length, []);
  const photoSpotsSaved = PHOTO_SPOTS.length;

  useEffect(() => {
    setMounted(true);

    const refreshTimeValues = () => {
      const now = getNow();
      // Reuse the shared, tested countdown helper instead of recomputing inline.
      setDaysRemaining(computeCountdown(TRIP_START, now).totalDays);
      // Status text derived from now vs. the trip window.
      if (now < TRIP_START) setTripStatus('Upcoming');
      else if (now <= TRIP_END) setTripStatus('On the trip');
      else setTripStatus('Completed');
    };

    refreshTimeValues();
  }, []);

  const unplannedDays = Math.max(0, totalDays - plannedDays);

  // Dashboard stat cards.
  const stats: StatCardProps[] = [
    { icon: <Calendar className="w-5 h-5 text-gold-400" />, label: 'Total Trip Duration', value: totalDays, suffix: ' days', color: 'bg-gold-500/10', delay: 0, testId: 'dashboard-trip-duration' },
    { icon: <Clock className="w-5 h-5 text-sakura-400" />, label: 'Days Until Departure', value: mounted ? daysRemaining : 0, color: 'bg-sakura-400/10', delay: 0.1, testId: 'dashboard-days-remaining' },
    { icon: <Compass className="w-5 h-5 text-teal-400" />, label: 'Trip Status', display: mounted ? tripStatus : 'Upcoming', color: 'bg-teal-500/10', delay: 0.2, testId: 'dashboard-trip-status' },
    { icon: <Globe className="w-5 h-5 text-blue-400" />, label: 'Countries to Visit', value: countries, color: 'bg-blue-500/10', delay: 0.3, testId: 'dashboard-countries' },
    { icon: <MapPin className="w-5 h-5 text-himalaya-400" />, label: 'Cities to Explore', value: cities, color: 'bg-himalaya-400/10', delay: 0.4, testId: 'dashboard-cities' },
    { icon: <Bookmark className="w-5 h-5 text-green-400" />, label: 'Attractions Saved', value: attractionsSaved, color: 'bg-green-500/10', delay: 0.5, testId: 'dashboard-attractions-saved' },
    { icon: <UtensilsCrossed className="w-5 h-5 text-orange-400" />, label: 'Restaurants Listed', value: restaurantsListed, color: 'bg-orange-500/10', delay: 0.6, testId: 'dashboard-restaurants-listed' },
    { icon: <Camera className="w-5 h-5 text-purple-400" />, label: 'Photo Spots Saved', value: photoSpotsSaved, color: 'bg-purple-500/10', delay: 0.7, testId: 'dashboard-photo-spots-saved' },
    // Planned days: days with at least one item, shown as planned / total; the
    // unplanned remainder is surfaced in the label.
    {
      icon: <Sun className="w-5 h-5 text-yellow-400" />,
      label: mounted ? `Planned Days (${unplannedDays} unplanned)` : 'Planned Days',
      value: mounted ? plannedDays : 0,
      suffix: ` / ${totalDays}`,
      color: 'bg-yellow-500/10',
      delay: 0.8,
      testId: 'dashboard-planned-days',
    },
  ];

  return (
    <section id="dashboard" aria-labelledby="dashboard-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* Slide-only masthead entrance (opacity pinned to 1) so the axe
            scan (no reduced-motion) can't catch the muted `text-white/50` subtitle
            mid-fade as a transient contrast failure. See RecommendationSection. */}
        <m.div
          initial={{ opacity: 1, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 id="dashboard-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Trip <span className="text-gradient-gold">Dashboard</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">
            Your adventure at a glance — track every detail of the journey ahead.
          </p>
        </m.div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stats.map((stat, i) => (
            <StatCard key={i} {...stat} />
          ))}
        </div>
      </div>
    </section>
  );
}
