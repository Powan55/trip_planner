'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  MapPin, Plane, Mountain, Building, Clock, ListPlus,
  UtensilsCrossed, Camera, ShoppingBag, Trees,
  Landmark, Hotel, Coffee, Music,
} from 'lucide-react';
import {
  TRIP_DATES, getCountryForDate, formatDate,
  CATEGORY_COLORS, ItineraryCategory,
} from '@/lib/trip-data';
import { useItineraryContext } from '@/components/itinerary-provider';

// Map each category to a lucide icon, matching the calendar planner.
const CATEGORY_ICON_MAP: Record<ItineraryCategory, React.ReactNode> = {
  sightseeing: <MapPin className="w-3.5 h-3.5" />,
  food: <UtensilsCrossed className="w-3.5 h-3.5" />,
  photography: <Camera className="w-3.5 h-3.5" />,
  shopping: <ShoppingBag className="w-3.5 h-3.5" />,
  nature: <Trees className="w-3.5 h-3.5" />,
  cultural: <Landmark className="w-3.5 h-3.5" />,
  transportation: <Plane className="w-3.5 h-3.5" />,
  hotel: <Hotel className="w-3.5 h-3.5" />,
  free: <Coffee className="w-3.5 h-3.5" />,
  nightlife: <Music className="w-3.5 h-3.5" />,
};

export default function TripTimeline({ onDateSelect }: { onDateSelect?: (date: string) => void }) {
  const [selectedDate, setSelectedDate] = useState<string>(TRIP_DATES[0]);

  // Read the itinerary from the shared reactive store instead of a one-time
  // `loadPlans()` on mount. This makes the selected-day panel reflect a same-tab
  // add/edit/remove from any place card OR the calendar LIVE, without a reload —
  // the store re-reads on its `itinerary:changed` CustomEvent. The timeline only
  // READS `plans` (it has no mutators).
  const { plans } = useItineraryContext();

  const handleDateClick = (date: string) => {
    setSelectedDate(date);
    onDateSelect?.(date);
  };

  // Find the transition day index
  const transitionIdx = TRIP_DATES.indexOf('2026-12-19');

  const selectedCountry = getCountryForDate(selectedDate);
  const selectedPlan = plans.find((p) => p.date === selectedDate);
  const selectedItems = selectedPlan?.items ?? [];

  return (
    <section id="timeline" aria-labelledby="timeline-heading" className="py-16 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-10"
        >
          <h2 id="timeline-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Trip <span className="text-gradient-gold">Timeline</span>
          </h2>
          <p className="text-white/50">32 days across two incredible countries</p>
        </motion.div>

        {/* Country labels */}
        <div className="flex justify-between mb-4 px-2">
          <div className="flex items-center gap-2">
            <Mountain className="w-4 h-4 text-himalaya-400" />
            <span className="text-sm font-medium text-himalaya-400">Nepal • Dec 9-18</span>
          </div>
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-sakura-400" />
            <span className="text-sm font-medium text-sakura-400">Japan • Dec 19-Jan 9</span>
          </div>
        </div>

        {/* Timeline bar */}
        <div className="relative">
          <div className="overflow-x-auto scrollbar-hide pb-4">
            <div className="flex gap-1 min-w-max px-2">
              {TRIP_DATES.map((date, i) => {
                const country = getCountryForDate(date);
                const isSelected = date === selectedDate;
                const isTransition = i === transitionIdx;
                const dayNum = i + 1;

                return (
                  <div key={date} className="flex items-center">
                    {isTransition && (
                      <div className="flex flex-col items-center mx-1">
                        <Plane className="w-4 h-4 text-gold-400 mb-1 -rotate-12" />
                        <div className="w-px h-8 bg-gold-400/30" />
                      </div>
                    )}
                    <button
                      onClick={() => handleDateClick(date)}
                      aria-pressed={isSelected}
                      aria-label={`Day ${dayNum}, ${formatDate(date)}`}
                      className={`flex flex-col items-center px-2 py-2 rounded-lg transition-all duration-200 min-w-[48px] outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                        isSelected
                          ? country === 'nepal'
                            ? 'bg-himalaya-500/30 ring-2 ring-himalaya-400 scale-110'
                            : 'bg-sakura-400/30 ring-2 ring-sakura-400 scale-110'
                          : 'hover:bg-white/5'
                      }`}
                    >
                      <span className="text-[10px] text-white/40">{formatDate(date).split(',')[0]?.split(' ')[0]}</span>
                      <span className={`text-sm font-mono font-bold ${
                        isSelected
                          ? 'text-white'
                          : country === 'nepal' ? 'text-himalaya-400/70' : 'text-sakura-400/70'
                      }`}>
                        {new Date(date + 'T12:00:00').getDate()}
                      </span>
                      <div className={`w-1.5 h-1.5 rounded-full mt-1 ${
                        isSelected
                          ? 'bg-gold-400'
                          : country === 'nepal' ? 'bg-himalaya-400/30' : 'bg-sakura-400/30'
                      }`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress bar */}
          <div className="h-1 rounded-full bg-white/5 mt-2">
            <div className="h-full rounded-full bg-gradient-to-r from-himalaya-500 via-gold-400 to-sakura-400" style={{ width: `${((TRIP_DATES.indexOf(selectedDate) + 1) / TRIP_DATES.length) * 100}%` }} />
          </div>
        </div>

        {/* Selected date info + that day's saved plans */}
        <motion.div
          key={selectedDate}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6"
        >
          {/* Date chip */}
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl glass-card">
              <MapPin className={`w-4 h-4 ${selectedCountry === 'nepal' ? 'text-himalaya-400' : 'text-sakura-400'}`} />
              <span className="text-white font-medium">
                Day {TRIP_DATES.indexOf(selectedDate) + 1} • {formatDate(selectedDate)} • {selectedPlan?.city
                  ? `${selectedPlan.city}, ${selectedCountry === 'nepal' ? 'Nepal' : 'Japan'}`
                  : selectedCountry === 'nepal' ? 'Kathmandu, Nepal' : 'Japan'}
              </span>
            </div>
          </div>

          {/* That day's plans */}
          <div className="max-w-2xl mx-auto mt-5">
            {selectedItems.length > 0 ? (
              <ul className="space-y-2">
                {selectedItems.map((item) => {
                  const colors = CATEGORY_COLORS[item.category];
                  return (
                    <li
                      key={item.id}
                      className="glass-card rounded-xl px-4 py-3 flex items-start gap-3 text-left"
                    >
                      {/* Category badge */}
                      <span
                        className={`shrink-0 mt-0.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${colors.bg} ${colors.text} ${colors.border}`}
                      >
                        {CATEGORY_ICON_MAP[item.category]}
                        <span className="capitalize">{item.category}</span>
                      </span>

                      {/* Title + meta */}
                      <div className="min-w-0 flex-1">
                        <p className="text-white font-medium leading-snug">{item.title}</p>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                          {item.time && (
                            <span className="inline-flex items-center gap-1 text-xs text-white/50 font-mono">
                              <Clock className="w-3 h-3" />
                              {item.time}
                              {item.duration ? ` • ${item.duration}` : ''}
                            </span>
                          )}
                          {item.location && (
                            <span className="inline-flex items-center gap-1 text-xs text-white/50">
                              <MapPin className="w-3 h-3" />
                              {item.location}
                            </span>
                          )}
                        </div>
                        {item.notes && (
                          <p className="text-sm text-white/60 mt-1.5 leading-snug">{item.notes}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              /* Empty state for an unplanned day */
              <div className="glass-card rounded-xl px-6 py-8 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-white/5 mb-3">
                  <ListPlus className="w-5 h-5 text-white/40" />
                </div>
                <p className="text-white/70 font-medium">No activities planned for this day yet</p>
                <a
                  href="#itinerary"
                  className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-gold-400 hover:text-gold-300 transition-colors rounded outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                >
                  <ListPlus className="w-4 h-4" />
                  Plan this day in the itinerary
                </a>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
