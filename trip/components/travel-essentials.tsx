'use client';

import { m } from 'framer-motion';
import { SectionHeading } from '@/components/section-heading';
import { Thermometer, Cloud } from 'lucide-react';
import { WEATHER_INFO } from '@/lib/travel-tips-data';

/**
 * Travel Essentials — the HOME half of the old `travel-inspiration.tsx`
 * split: the weather outlook. The country-flavored half (featured destinations /
 * foods / etiquette) moved to `country-essentials.tsx` on the /nepal/ and /japan/
 * pages. The packing checklist half of this section was removed from Home entirely
 * — no relocation, no replacement.
 *
 * The section KEEPS the legacy `inspiration` id (: every v1 section id is
 * preserved; `/#inspiration` scrolls here via the legacy-hash redirect, and the
 * command palette targets it).
 */

export default function TravelEssentials() {
  return (
    <section id="inspiration" aria-labelledby="inspiration-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <SectionHeading
          id="inspiration-heading"
          className="mb-12"
          title={<>Travel <span className="text-gradient-gold">Essentials</span></>}
          subtitle="December weather outlook for the journey."
        />

        {/* Weather Section */}
        <div className="grid md:grid-cols-2 gap-5">
          {[{ key: 'nepal' as const, label: 'Kathmandu, Nepal', data: WEATHER_INFO.nepal }, { key: 'japan' as const, label: 'Japan (Tokyo/Kyoto)', data: WEATHER_INFO.japan }].map(({ key, label, data }) => (
            <m.div
              key={key}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className={key === 'nepal' ? 'glass-nepal rounded-2xl p-5' : 'glass-japan rounded-2xl p-5'}
            >
              <div className="flex items-center gap-2 mb-3">
                <Cloud className={`w-5 h-5 ${key === 'nepal' ? 'text-himalaya-400' : 'text-sakura-400'}`} />
                <h3 className="font-display font-bold text-white">{label}</h3>
              </div>
              <div className="flex gap-4 mb-3">
                <div className="text-center">
                  <Thermometer className="w-4 h-4 text-red-400 mx-auto mb-1" />
                  <span className="text-lg font-mono font-bold text-white">{data.tempHigh}</span>
                  <p className="text-[10px] text-white/30">High</p>
                </div>
                <div className="text-center">
                  <Thermometer className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <span className="text-lg font-mono font-bold text-white">{data.tempLow}</span>
                  <p className="text-[10px] text-white/30">Low</p>
                </div>
              </div>
              <p className="text-xs text-white/40 mb-2">{data.description}</p>
              <p className="text-xs text-white/30 italic">🧥 {data.whatToWear}</p>
            </m.div>
          ))}
        </div>
      </div>
    </section>
  );
}
