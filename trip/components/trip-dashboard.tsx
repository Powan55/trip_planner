'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, useInView } from 'framer-motion';
import { Calendar, MapPin, Camera, UtensilsCrossed, Clock, Globe, Bookmark, Sun, Compass } from 'lucide-react';
import { TRIP_START, TRIP_END, TRIP_DATES, DayPlan } from '@/lib/trip-data';
import { computeCountdown } from '@/lib/countdown';
import { NEPAL_ATTRACTIONS, NEPAL_FOOD } from '@/lib/nepal-data';
import { JAPAN_ATTRACTIONS, JAPAN_FOOD } from '@/lib/japan-data';
import { PHOTO_SPOTS } from '@/lib/photography-data';
import { loadPlans, ITINERARY_STORAGE_KEY } from '@/lib/itinerary-storage';

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  // A card is EITHER numeric (animated counter) OR a display string (e.g. Trip Status).
  value?: number;
  display?: string;
  suffix?: string;
  color: string;
  delay: number;
}

function AnimatedCounter({ target, duration = 2000 }: { target: number; duration?: number }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (!inView) return;
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * target));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }, [inView, target, duration]);

  return <span ref={ref} className="font-mono">{count}</span>;
}

function StatCard({ icon, label, value, display, suffix = '', color, delay }: StatCardProps) {
  return (
    <motion.div
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
    </motion.div>
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
  // Card 9 (planned days) depends on localStorage.
  const [plannedDays, setPlannedDays] = useState(0);

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
      const now = new Date();
      // Reuse the shared, tested countdown helper instead of recomputing inline.
      setDaysRemaining(computeCountdown(TRIP_START, now).totalDays);
      // Status text derived from now vs. the trip window.
      if (now < TRIP_START) setTripStatus('Upcoming');
      else if (now <= TRIP_END) setTripStatus('On the trip');
      else setTripStatus('Completed');
    };

    const refreshPlanned = () => setPlannedDays(countPlannedDays(loadPlans()));

    refreshTimeValues();
    refreshPlanned();

    // Re-read the itinerary when another tab/window mutates it. Same-tab updates
    // from the calendar refresh on the next mount/reload.
    const onStorage = (e: StorageEvent) => {
      if (e.key === ITINERARY_STORAGE_KEY || e.key === null) refreshPlanned();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const unplannedDays = Math.max(0, totalDays - plannedDays);

  // Dashboard stat cards.
  const stats: StatCardProps[] = [
    { icon: <Calendar className="w-5 h-5 text-gold-400" />, label: 'Total Trip Duration', value: totalDays, suffix: ' days', color: 'bg-gold-500/10', delay: 0 },
    { icon: <Clock className="w-5 h-5 text-sakura-400" />, label: 'Days Until Departure', value: mounted ? daysRemaining : 0, color: 'bg-sakura-400/10', delay: 0.1 },
    { icon: <Compass className="w-5 h-5 text-teal-400" />, label: 'Trip Status', display: mounted ? tripStatus : 'Upcoming', color: 'bg-teal-500/10', delay: 0.2 },
    { icon: <Globe className="w-5 h-5 text-blue-400" />, label: 'Countries to Visit', value: countries, color: 'bg-blue-500/10', delay: 0.3 },
    { icon: <MapPin className="w-5 h-5 text-himalaya-400" />, label: 'Cities to Explore', value: cities, color: 'bg-himalaya-400/10', delay: 0.4 },
    { icon: <Bookmark className="w-5 h-5 text-green-400" />, label: 'Attractions Saved', value: attractionsSaved, color: 'bg-green-500/10', delay: 0.5 },
    { icon: <UtensilsCrossed className="w-5 h-5 text-orange-400" />, label: 'Restaurants Listed', value: restaurantsListed, color: 'bg-orange-500/10', delay: 0.6 },
    { icon: <Camera className="w-5 h-5 text-purple-400" />, label: 'Photo Spots Saved', value: photoSpotsSaved, color: 'bg-purple-500/10', delay: 0.7 },
    // Planned days: days with at least one item, shown as planned / total; the
    // unplanned remainder is surfaced in the label.
    {
      icon: <Sun className="w-5 h-5 text-yellow-400" />,
      label: mounted ? `Planned Days (${unplannedDays} unplanned)` : 'Planned Days',
      value: mounted ? plannedDays : 0,
      suffix: ` / ${totalDays}`,
      color: 'bg-yellow-500/10',
      delay: 0.8,
    },
  ];

  return (
    <section id="dashboard" aria-labelledby="dashboard-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
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
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {stats.map((stat, i) => (
            <StatCard key={i} {...stat} />
          ))}
        </div>
      </div>
    </section>
  );
}
