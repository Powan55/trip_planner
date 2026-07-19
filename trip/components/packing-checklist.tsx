'use client';

import { useEffect, useRef, useState } from 'react';
import { Backpack, Mountain, Compass, Globe2 } from 'lucide-react';
import { usePacking } from '@/hooks/use-packing';
import type { PackingCategory, PackingItem } from '@/core/packing/model';
import { haptic } from '@/lib/haptics';
import { crossedIntoComplete } from '@/lib/celebration';
import CelebrationBurst from '@/components/celebration-burst';

/**
 * PackingChecklist — the `/packing` route's checklist: a fixed built-in template
 * (`core/packing/model.ts`'s `DEFAULT_TEMPLATE`, 28 items) grouped Nepal / Japan / Universal,
 * each a checkbox toggle persisted via the gateway (`hooks/use-packing.ts`, key 21). No empty
 * state by design — the template is the value of the feature; only `checked`
 * persists per item, seeded on first load.
 *
 * A11y: a section `h2`, one `h3` per category group, real `<input
 * type="checkbox">`/`<label>` pairs (native semantics, no ARIA re-implementation), ≥44px targets,
 * visible focus rings, static markup with no motion-only affordance (reduced-motion-safe by
 * construction). The progress indicator is a plain text node (not color-only).
 */

const CATEGORY_META: Record<PackingCategory, { label: string; icon: typeof Mountain }> = {
  nepal: { label: 'Nepal', icon: Mountain },
  japan: { label: 'Japan', icon: Compass },
  universal: { label: 'Universal', icon: Globe2 },
};

const CATEGORY_ORDER: PackingCategory[] = ['nepal', 'japan', 'universal'];

export default function PackingChecklist() {
  const { items, hydrated, progress, toggleItem } = usePacking();

  // — last-item-checked micro-celebration: fires only on an OBSERVED not-complete→complete
  // edge. The ref starts null and the effect skips until hydration, so the first REAL state —
  // even "already complete in storage" — only seeds the baseline (no celebration on load), and
  // a re-render while the list stays fully checked never re-fires (lib/celebration.ts).
  const wasCompleteRef = useRef<boolean | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!hydrated) return;
    const complete = progress.total > 0 && progress.checked === progress.total;
    if (crossedIntoComplete(wasCompleteRef.current, complete)) {
      setCelebrate(true);
      haptic();
      const t = setTimeout(() => setCelebrate(false), 650);
      wasCompleteRef.current = complete;
      return () => clearTimeout(t);
    }
    wasCompleteRef.current = complete;
  }, [hydrated, progress.checked, progress.total]);

  if (!hydrated) {
    return (
      <section aria-labelledby="packing-heading" data-testid="packing-checklist" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
        <h2 id="packing-heading" className="sr-only">
          Packing checklist
        </h2>
        <p className="text-sm text-white/55">Loading your checklist…</p>
      </section>
    );
  }

  const byCategory: Record<PackingCategory, PackingItem[]> = { nepal: [], japan: [], universal: [] };
  for (const item of items) byCategory[item.category].push(item);

  return (
    <section aria-labelledby="packing-heading" data-testid="packing-checklist" className="relative mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
      <CelebrationBurst active={celebrate} testId="packing-celebration" />
      <header className="mb-6">
        <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-gold-400/80">
          <Backpack className="h-3.5 w-3.5" aria-hidden="true" />
          Two legs, one bag
        </p>
        <h2 id="packing-heading" className="font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
          Packing <span className="text-gradient-gold">checklist</span>
        </h2>
        <p data-testid="packing-progress" className="mt-3 text-sm font-medium text-white/70">
          {progress.checked}/{progress.total} packed
        </p>
        <div
          role="progressbar"
          aria-valuenow={progress.checked}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-label={`${progress.checked} of ${progress.total} items packed`}
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div
            className="h-full rounded-full bg-gold-400 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: progress.total > 0 ? `${(progress.checked / progress.total) * 100}%` : '0%' }}
          />
        </div>
      </header>

      <div className="flex flex-col gap-8">
        {CATEGORY_ORDER.map((category) => {
          const groupItems = byCategory[category];
          if (groupItems.length === 0) return null;
          const meta = CATEGORY_META[category];
          const Icon = meta.icon;
          const headingId = `packing-group-${category}-heading`;
          return (
            <div key={category} data-testid={`packing-group-${category}`} className="glass-subtle rounded-2xl p-5">
              <h3 id={headingId} className="flex items-center gap-2 font-display text-lg font-bold text-white">
                <Icon className="h-4 w-4 text-gold-400/80" aria-hidden="true" />
                {meta.label}
              </h3>
              <ul aria-labelledby={headingId} className="mt-3 flex flex-col gap-1">
                {groupItems.map((item) => (
                  <li key={item.id}>
                    <label
                      htmlFor={`packing-item-${item.id}`}
                      className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-white/85 outline-none transition-colors duration-200 hover:bg-white/[0.06] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-400 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface"
                    >
                      <input
                        id={`packing-item-${item.id}`}
                        data-testid={`packing-item-${item.id}`}
                        type="checkbox"
                        checked={item.checked}
                        onChange={() => {
                          toggleItem(item.id);
                          haptic();
                        }}
                        className="h-5 w-5 flex-shrink-0 rounded border-white/30 bg-transparent text-gold-400 outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                      />
                      <span className={item.checked ? 'text-white/50 line-through' : undefined}>{item.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
