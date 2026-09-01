'use client';

import { useEffect, useRef, useState } from 'react';
import { FileCheck2, PlaneTakeoff, ShieldCheck } from 'lucide-react';
import { useDocs } from '@/hooks/use-docs';
import type { DocSection, DocItem } from '@/core/docs/model';
import { haptic } from '@/lib/haptics';
import { crossedIntoComplete } from '@/lib/celebration';
import CelebrationBurst from '@/components/celebration-burst';
import PhotoAttach from '@/components/photo-attach';

// Device-local only: this row's checked/note state syncs, the photo never does, so it's
// invisible on another device. Storage stays generic since there's no real quota to quote.
// Same string on every row rather than branching per item; not shared with journal/expense.
const DOCS_PHOTO_HELPER =
  "Only visible on this device — this checklist syncs, the photo doesn't. Storage is limited by your " +
  "device's available storage, and photos are kept unencrypted on this device, so avoid attaching " +
  'anything sensitive.';

/**
 * DocsChecklist — the `/checklist` route's checklist: a fixed built-in template
 * (`core/docs/model.ts`'s `DEFAULT_TEMPLATE`, 18 items) in two fixed sections (Critical documents,
 * Day-zero readiness), each a checkbox toggle + an optional per-item note, persisted via the gateway
 * (`hooks/use-docs.ts`, key 25) AND synced across travelers. No empty state by design
 * — the template is the value of the feature; only `checked`/`note` (and, under
 * sync, the stamps) persist on the `DocItem` row itself. Each row also gets an OPTIONAL photo
 * (#258 — passport page, visa stamp, boarding pass…) via the shared `PhotoAttach` surface, owner
 * `{kind:'docs',itemId}`; that photo is a separate device-local `PhotoMeta` row (key 16, IndexedDB
 * bytes) and never touches the synced `DocItem`, so it does NOT follow the row to another device.
 *
 * TEXT COLOUR: this is issue #27's FIRST swept route — every text node here resolves to one of the
 * three tiers (`text-ink-hi` / `-mid` / `-lo`), never to a `text-white/NN` alpha. The alpha->tier
 * mapping and the role rule that produced it are recorded beside the token declarations in
 * app/globals.css; apply that, do not re-derive it here.
 *
 * A11y: a section `h2` (sr-only — `app/checklist/page.tsx`'s masthead carries the visible title),
 * one `h3` per section group, real `<input type="checkbox">`/
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
    <li className="border-b-hair border-border last:border-b-0">
      <label
        htmlFor={`docs-item-${item.id}`}
        data-mark={item.checked ? undefined : 'hollow'}
        className="r cursor-pointer !border-b-0 outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring"
      >
        <span className="tm flex items-center justify-center pt-0">
          <input
            id={`docs-item-${item.id}`}
            data-testid={`docs-item-${item.id}`}
            type="checkbox"
            checked={item.checked}
            onChange={() => {
              onToggle(item.id);
              haptic();
            }}
            className="h-5 w-5 flex-shrink-0 rounded-r1 border-[color:var(--border-ui)] bg-transparent text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </span>
        <span className="min-w-0">
          {/* Struck means committed, so a filed document keeps the TOP tier and takes the rule
              through it; hollow recedes by tier via [data-mark] above. role=presentation keeps
              the row-title recipe without adding one heading per checkbox to the page outline —
              the label already names the input. */}
          <h3 role="presentation" className={item.checked ? 'line-through' : undefined}>
            {item.label}
          </h3>
        </span>
        <span className={item.checked ? 'chip chip--struck' : 'hollow-tag'}>
          {item.checked ? 'filed' : 'not yet'}
        </span>
      </label>
      <div className="px-gut pb-2">
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
          className="w-full rounded-r1 border-hair border-border bg-surface-raised px-3 py-1.5 text-t-sm text-ink-hi placeholder:text-ink-lo outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring/60"
        />
        {/* #258: an optional device-local photo per row (passport page, visa stamp, boarding pass …),
            alongside the text note above. Reuses the journal/expense capture surface with a third
            owner kind — see DOCS_PHOTO_HELPER for why the copy differs from those two call sites. */}
        <PhotoAttach
          owner={{ kind: 'docs', itemId: item.id }}
          heading="Photo"
          altPlaceholder="Describe this document photo"
          helperText={DOCS_PHOTO_HELPER}
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
    }
    wasCompleteRef.current = complete;
  }, [hydrated, completion.done, completion.total]);

  // The burst window lives in its own effect keyed on `celebrate`, deliberately: folded into the
  // edge effect above, any re-run of that effect (unchecking a row inside the window) clears the
  // timer without re-arming it, leaving the burst on screen forever.
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(false), 650);
    return () => clearTimeout(t);
  }, [celebrate]);

  if (!hydrated) {
    return (
      <section aria-labelledby="docs-heading" data-testid="docs-checklist" className="mx-auto w-full max-w-3xl px-gut pb-16">
        <h2 id="docs-heading" className="sr-only">
          Documents and readiness checklist
        </h2>
        <p className="empty">Loading your checklist…</p>
      </section>
    );
  }

  const bySection: Record<DocSection, DocItem[]> = { critical: [], dayzero: [] };
  for (const item of items) {
    if (item.section === 'critical' || item.section === 'dayzero') bySection[item.section].push(item);
  }

  const allDone = completion.total > 0 && completion.done === completion.total;

  return (
    <section aria-labelledby="docs-heading" data-testid="docs-checklist" className="relative mx-auto w-full max-w-3xl pb-16">
      <CelebrationBurst active={celebrate} testId="docs-celebration" celebrationId="docs-complete" />
      <header className="mb-6 px-gut">
        {/* #218: the eyebrow and title used to be printed here a second time, ~40px under the
            page masthead that already carries both. The heading stays as the section's
            accessible name (`aria-labelledby` above) and the h2 the group h3s nest under —
            sr-only, the same shape as the pre-hydration branch. */}
        <h2 id="docs-heading" className="sr-only">
          Documents and readiness checklist
        </h2>
        {/* e2e/docs-palette.spec.ts asserts this node reads exactly "0/18 ready" — the count and
            the word are the contract, so nothing else may join this text node. */}
        <p data-testid="docs-progress" className="num text-n-sm text-ink-hi">
          {completion.done}/{completion.total} ready
        </p>
        {/* The track is capped so the UNFILLED remainder is always visible: a bar with no visible
            remainder stops being a reading and becomes an underline. */}
        <div
          role="progressbar"
          aria-valuenow={completion.done}
          aria-valuemin={0}
          aria-valuemax={completion.total}
          aria-label={`${completion.done} of ${completion.total} items ready`}
          className="fill"
          style={{ '--w': completion.total > 0 ? `${(completion.done / completion.total) * 100}%` : '0%' } as React.CSSProperties}
        >
          <i />
        </div>
        {allDone && (
          // KNOWN CEILING: a chip, not a --accent stamp. The accent FILL answers only "what is
          // now?" and every fill site sits on a named allowlist; a completion state is not one.
          <p data-testid="docs-complete" className="mt-3">
            <span className="chip chip--struck">All {completion.total} filed — ready to fly</span>
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
            <div key={section} data-testid={`docs-section-${section}`}>
              {/* The running-head field strip, deliberately NOT sticky: the app already ships a
                  fixed navbar at top:0, and a second sticky bar per group would stack under it. */}
              <div className="head static flex-wrap">
                <span className="f">
                  <span className="k">Section</span>
                  <h3 id={headingId} className="v !flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-ink-lo" aria-hidden="true" />
                    {meta.label}
                  </h3>
                </span>
                <span className="f">
                  <span className="k">Filed</span>
                  <span data-testid={`docs-section-progress-${section}`} className="v">
                    {sec.done}/{sec.total}
                  </span>
                </span>
                <span className="f f--drop">
                  <span className="k">Why</span>
                  <span className="v normal-case">{meta.eyebrow}</span>
                </span>
              </div>
              <ul aria-labelledby={headingId} className="list">
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
