'use client';

import { useEffect, useRef, useState } from 'react';
import { FileCheck2, PlaneTakeoff, ShieldCheck } from 'lucide-react';
import { useDocs } from '@/hooks/use-docs';
import type { DocSection, DocItem } from '@/core/docs/model';
import { haptic } from '@/lib/haptics';
import { crossedIntoComplete } from '@/lib/celebration';
import CelebrationBurst from '@/components/celebration-burst';

/**
 * DocsChecklist — the `/checklist` route's checklist: a fixed built-in template
 * (`core/docs/model.ts`'s `DEFAULT_TEMPLATE`, 18 items) in two fixed sections (Critical documents,
 * Day-zero readiness), each a checkbox toggle + an optional per-item note, persisted via the gateway
 * (`hooks/use-docs.ts`, key 25) AND synced across travelers. No empty state by design
 * — the template is the value of the feature; only `checked`/`note` (and, under
 * sync, the stamps) persist.
 *
 * A11y: a section `h2`, one `h3` per section group, real `<input type="checkbox">`/
 * `<label>` pairs (native semantics), a real `<input type="text">` note with its own label, ≥44px
 * targets, visible focus rings, static markup with no motion-only affordance (reduced-motion-safe).
 * Progress is a plain text node (not color-only) + an aria-valued progressbar.
 */

const SECTION_META: Record<DocSection, { label: string; eyebrow: string; icon: typeof FileCheck2 }> = {
  critical: { label: 'Critical documents', eyebrow: "Don't leave without them", icon: ShieldCheck },
  dayzero: { label: 'Day-zero readiness', eyebrow: 'Pre-departure', icon: PlaneTakeoff },
};

const SECTION_ORDER: DocSection[] = ['critical', 'dayzero'];

/** One checklist row: the checkbox + label, plus an optional note input that commits on blur (so a
 * synced build writes ONE Firestore doc per finished note, not one per keystroke —). */
function DocRow({
  item,
  onToggle,
  onNote,
}: {
  item: DocItem;
  onToggle: (id: string) => void;
  onNote: (id: string, note: string) => void;
}) {
  // Local draft so typing is smooth; the store is the source of truth on blur / external change.
  const [draft, setDraft] = useState(item.note ?? '');
  const focusedRef = useRef(false);
  // Keep the draft in step with an external update (a peer's synced note) UNLESS we're editing.
  useEffect(() => {
    if (!focusedRef.current) setDraft(item.note ?? '');
  }, [item.note]);

  const commitNote = () => {
    focusedRef.current = false;
    if (draft.trim() !== (item.note ?? '')) onNote(item.id, draft);
  };

  return (
    <li className="border-b border-white/5 py-1 last:border-b-0">
      <label
        htmlFor={`docs-item-${item.id}`}
        className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-white/85 outline-none transition-colors duration-200 hover:bg-white/[0.06] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold-400 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-surface"
      >
        <input
          id={`docs-item-${item.id}`}
          data-testid={`docs-item-${item.id}`}
          type="checkbox"
          checked={item.checked}
          onChange={() => {
            onToggle(item.id);
            haptic();
          }}
          className="h-5 w-5 flex-shrink-0 rounded border-white/30 bg-transparent text-gold-400 outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        />
        <span className={item.checked ? 'text-white/50 line-through' : undefined}>{item.label}</span>
      </label>
      <div className="pl-10 pr-2 pb-1.5">
        <label htmlFor={`docs-note-${item.id}`} className="sr-only">
          Note for {item.label}
        </label>
        <input
          id={`docs-note-${item.id}`}
          data-testid={`docs-note-${item.id}`}
          type="text"
          value={draft}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitNote}
          placeholder="Add a note — expiry, policy #, reference…"
          className="w-full rounded-md border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-white/75 placeholder:text-white/30 outline-none transition-colors focus-visible:border-gold-400/60 focus-visible:ring-1 focus-visible:ring-gold-400/60"
        />
      </div>
    </li>
  );
}

export default function DocsChecklist() {
  const { items, hydrated, completion, toggleItem, setNote } = useDocs();

  // Last-item-checked micro-celebration: fires only on an OBSERVED not-complete→
  // complete edge. The ref starts null and the effect skips until hydration, so the first REAL
  // state — even "already complete in storage" — only seeds the baseline (no celebration on load).
  const wasCompleteRef = useRef<boolean | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (!hydrated) return;
    const complete = completion.total > 0 && completion.done === completion.total;
    if (crossedIntoComplete(wasCompleteRef.current, complete)) {
      setCelebrate(true);
      haptic();
      const t = setTimeout(() => setCelebrate(false), 650);
      wasCompleteRef.current = complete;
      return () => clearTimeout(t);
    }
    wasCompleteRef.current = complete;
  }, [hydrated, completion.done, completion.total]);

  if (!hydrated) {
    return (
      <section aria-labelledby="docs-heading" data-testid="docs-checklist" className="mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
        <h2 id="docs-heading" className="sr-only">
          Documents and readiness checklist
        </h2>
        <p className="text-sm text-white/55">Loading your checklist…</p>
      </section>
    );
  }

  const bySection: Record<DocSection, DocItem[]> = { critical: [], dayzero: [] };
  for (const item of items) {
    if (item.section === 'critical' || item.section === 'dayzero') bySection[item.section].push(item);
  }

  const allDone = completion.total > 0 && completion.done === completion.total;

  return (
    <section aria-labelledby="docs-heading" data-testid="docs-checklist" className="relative mx-auto w-full max-w-3xl px-4 pb-16 sm:px-6">
      <CelebrationBurst active={celebrate} testId="docs-celebration" />
      <header className="mb-6">
        <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-gold-400/80">
          <FileCheck2 className="h-3.5 w-3.5" aria-hidden="true" />
          Before you fly
        </p>
        <h2 id="docs-heading" className="font-display text-2xl font-bold leading-tight text-white sm:text-3xl">
          Documents &amp; <span className="text-gradient-gold">readiness</span>
        </h2>
        <p data-testid="docs-progress" className="mt-3 text-sm font-medium text-white/70">
          {completion.done}/{completion.total} ready
        </p>
        <div
          role="progressbar"
          aria-valuenow={completion.done}
          aria-valuemin={0}
          aria-valuemax={completion.total}
          aria-label={`${completion.done} of ${completion.total} items ready`}
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div
            className="h-full rounded-full bg-gold-400 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: completion.total > 0 ? `${(completion.done / completion.total) * 100}%` : '0%' }}
          />
        </div>
        {allDone && (
          <p data-testid="docs-complete" className="mt-3 text-sm font-medium text-gold-400">
            All set — you&apos;re ready to fly. ✈
          </p>
        )}
      </header>

      <div className="flex flex-col gap-8">
        {SECTION_ORDER.map((section) => {
          const groupItems = bySection[section];
          if (groupItems.length === 0) return null;
          const meta = SECTION_META[section];
          const Icon = meta.icon;
          const headingId = `docs-group-${section}-heading`;
          const sec = completion.perSection[section];
          return (
            <div key={section} data-testid={`docs-section-${section}`} className="glass-subtle rounded-2xl p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="mb-1 text-[0.65rem] uppercase tracking-widest text-gold-400/70">{meta.eyebrow}</p>
                  <h3 id={headingId} className="flex items-center gap-2 font-display text-lg font-bold text-white">
                    <Icon className="h-4 w-4 text-gold-400/80" aria-hidden="true" />
                    {meta.label}
                  </h3>
                </div>
                <span
                  data-testid={`docs-section-progress-${section}`}
                  className="shrink-0 text-xs font-medium text-white/55"
                >
                  {sec.done}/{sec.total}
                </span>
              </div>
              <ul aria-labelledby={headingId} className="mt-3 flex flex-col">
                {groupItems.map((item) => (
                  <DocRow key={item.id} item={item} onToggle={toggleItem} onNote={setNote} />
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
