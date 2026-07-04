'use client';

import { useState, useEffect } from 'react';
import { m } from 'framer-motion';
import { Thermometer, Cloud, Shirt, CheckCircle, Circle, AlertTriangle } from 'lucide-react';
import { PACKING_LIST, WEATHER_INFO } from '@/lib/travel-tips-data';

/**
 * Travel Essentials — the HOME half of the old `travel-inspiration.tsx`
 * split: the weather outlook + the packing checklist. The country-flavored half
 * (featured destinations / foods / etiquette) moved to `country-essentials.tsx`
 * on the /nepal/ and /japan/ pages.
 *
 * The section KEEPS the legacy `inspiration` id (every original section id is
 * preserved; `/#inspiration` scrolls here via the legacy-hash redirect, and the
 * command palette targets it).
 *
 * ⚠ PERSISTENCE: the packing checklist persists to the exact localStorage key
 * `packing_checklist`, carried over verbatim from the old travel-inspiration
 * component. The key must never change — users' checklists survive the redesign.
 */

function PackingChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem('packing_checklist');
      if (saved) setChecked(JSON.parse(saved));
    } catch { /* ignore */ }
  }, []);

  const toggle = (item: string) => {
    const next = { ...(checked ?? {}), [item]: !checked?.[item] };
    setChecked(next);
    try { localStorage.setItem('packing_checklist', JSON.stringify(next)); } catch { /* ignore */ }
  };

  const categories = [...new Set(PACKING_LIST.map((p) => p.category))];
  const totalChecked = Object.values(checked ?? {}).filter(Boolean).length;

  return (
    <div className="glass-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
          <Shirt className="w-5 h-5 text-gold-400" /> Packing List
        </h3>
        <span className="text-xs text-white/40 font-mono">{totalChecked}/{PACKING_LIST.length}</span>
      </div>
      <div className="space-y-4">
        {categories.map((cat) => (
          <div key={cat}>
            <h4 className="text-xs font-medium text-white/30 uppercase tracking-wider mb-2">{cat}</h4>
            <div className="space-y-1">
              {PACKING_LIST.filter((p) => p.category === cat).map((p) => (
                <button
                  key={p.item}
                  onClick={() => toggle(p.item)}
                  aria-pressed={!!checked?.[p.item]}
                  aria-label={`${p.item}${p.essential ? ' (essential)' : ''}`}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all text-left outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                    checked?.[p.item] ? 'text-white/30 line-through' : 'text-white/70 hover:bg-white/5'
                  }`}
                >
                  {checked?.[p.item] ? (
                    <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-white/20 shrink-0" />
                  )}
                  <span className="flex-1">{p.item}</span>
                  {p.essential && !checked?.[p.item] && (
                    <AlertTriangle className="w-3.5 h-3.5 text-gold-400 shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TravelEssentials() {
  return (
    <section id="inspiration" aria-labelledby="inspiration-heading" className="py-20 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 id="inspiration-heading" className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white mb-3">
            Travel <span className="text-gradient-gold">Essentials</span>
          </h2>
          <p className="text-white/50 max-w-xl mx-auto">December weather outlook and the packing checklist for the journey.</p>
        </m.div>

        {/* Weather Section */}
        <div className="grid md:grid-cols-2 gap-5 mb-12">
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

        {/* Packing checklist — now the section's centerpiece; constrained so a
            lone tall card doesn't sprawl the full 1200px row. */}
        <div className="max-w-3xl mx-auto">
          <PackingChecklist />
        </div>
      </div>
    </section>
  );
}
