'use client';

import { useEffect, useState, useRef } from 'react';
import { m, useInView, useReducedMotion } from 'framer-motion';
import { useCountUp } from '@/hooks/use-count-up';
import { Calendar, Clock, Compass } from 'lucide-react';
import { TRIP_START, TRIP_END, TRIP_DATES } from '@/lib/trip-data';
import { computeCountdown } from '@/lib/countdown';
import { getNow } from '@/lib/trip-now';
import { FADE_FLOOR } from '@/lib/motion';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  // A card is EITHER numeric (animated counter) OR a display string (e.g. Trip Status).
  value?: number;
  display?: string;
  suffix?: string;
  color: string;
  delay: number;
  // stable E2E hook, distinct per card and namespaced `dashboard-*` so it never
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
      <div className="text-sm text-ink-mid">{label}</div>
    </m.div>
  );
}

/**
 * — the Home stat dashboard, trimmed from 9 cards to the 3 highest-value TEMPORAL
 * facts: how long the trip is, how long until it starts, and where in its lifecycle it
 * sits. The former six catalog counts (countries/cities/attractions/restaurants/photo
 * spots/planned-days) were vanity metrics; the actionable "at a glance" data
 * (budget/packing/next-up/weather) already lives in the retained HomeBento, so the
 * dashboard deliberately does NOT duplicate it. Only Cards 2 (days-remaining) and 3
 * (status) touch the clock; Card 1 (duration) is a constant.
 */
export default function TripDashboard() {
  const prefersReducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [tripStatus, setTripStatus] = useState('Upcoming');

  const totalDays = TRIP_DATES.length;

  useEffect(() => {
    setMounted(true);

    const now = getNow();
    // Reuse the shared, tested countdown helper instead of recomputing inline.
    setDaysRemaining(computeCountdown(TRIP_START, now).totalDays);
    // Status text derived from now vs. the trip window.
    if (now < TRIP_START) setTripStatus('Upcoming');
    else if (now <= TRIP_END) setTripStatus('On the trip');
    else setTripStatus('Completed');
  }, []);

  const stats: StatCardProps[] = [
    { icon: <Calendar className="w-5 h-5 text-gold-400" />, label: 'Total Trip Duration', value: totalDays, suffix: ' days', color: 'bg-gold-500/10', delay: 0, testId: 'dashboard-trip-duration' },
    { icon: <Clock className="w-5 h-5 text-sakura-400" />, label: 'Days Until Departure', value: mounted ? daysRemaining : 0, color: 'bg-sakura-400/10', delay: 0.1, testId: 'dashboard-days-remaining' },
    { icon: <Compass className="w-5 h-5 text-teal-400" />, label: 'Trip Status', display: mounted ? tripStatus : 'Upcoming', color: 'bg-teal-500/10', delay: 0.2, testId: 'dashboard-trip-status' },
  ];

  return (
    <section id="dashboard" aria-labelledby="dashboard-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        {/* masthead entrance now FLOORS the fade (FADE_FLOOR → 1) instead of
            pinning it at 1. The axe scan runs WITHOUT reduced motion and can sample this
            mid-animation, so the floor — not a pin — is what keeps the muted `text-ink-mid`
            subtitle ≥AA at the darkest frame. Under reduce
            we keep the pin outright: MotionConfig neutralises `y` but not opacity, so an
            un-forked floor would strand an off-screen reveal at 0.7. */}
        <m.div
          initial={prefersReducedMotion ? { opacity: 1 } : { opacity: FADE_FLOOR, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 id="dashboard-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Trip <span className="text-display-emphasis">Dashboard</span>
          </h2>
          <p className="text-ink-mid max-w-xl mx-auto">
            Your adventure at a glance — how long, how soon, and where in the journey you are.
          </p>
        </m.div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {stats.map((stat, i) => (
            <StatCard key={i} {...stat} />
          ))}
        </div>
      </div>
    </section>
  );
}
