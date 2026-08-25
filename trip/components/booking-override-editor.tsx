'use client';

import { useState, type FormEvent } from 'react';
import type { BookingOverride } from '@/core/bookings/override';

/**
 * BookingOverrideEditor — the `/flights` inline "I booked this" affordance (issue #228).
 *
 * Renders NOTHING when `isToBook` is false: it only ever appears beside a `Journey`/`Stay` whose
 * STATIC `lib/booking-data.ts` status is `'to-book'` — an already-booked entry has nothing to
 * override. Three states from there:
 *   1. no override yet -> a single button that reveals the form.
 *   2. the form (pre-filled from any existing override) -> Save writes one override via `onSave`;
 *      Cancel discards the draft.
 *   3. an override exists -> a compact read-only summary + Edit / Remove.
 *
 * A plain controlled form (one `useState` object, submit-on-Save) rather than the app's
 * commit-on-blur pattern (`useDraftOnBlur`): this is local-only with no per-keystroke write cost
 * to amortize, and five fields committing independently on blur could save a half-filled patch.
 */

export interface BookingOverrideEditorProps {
  id: string;
  kind: 'flight' | 'stay';
  /** The ORIGINAL (pre-override) static status — decides whether this affordance renders at all. */
  isToBook: boolean;
  override?: BookingOverride;
  onSave: (id: string, patch: Omit<BookingOverride, 'updatedAt'>) => void;
  onClear: (id: string) => void;
}

const FIELD_LABELS: Record<'flight' | 'stay', { provider: string; primary: string; secondary: string }> = {
  flight: { provider: 'Carrier / flight number', primary: 'Depart', secondary: 'Arrive' },
  stay: { provider: 'Hotel / property name', primary: 'Check-in', secondary: 'Check-out' },
};

const INPUT_CLS =
  'w-full rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-ink-hi placeholder:text-ink-lo outline-none transition-colors focus-visible:border-ring/60 focus-visible:ring-1 focus-visible:ring-ring/60';
const LINK_BTN_CLS =
  'min-h-tap inline-flex items-center rounded px-1 text-ink-mid underline decoration-dotted outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-ring';

type Draft = Required<Omit<BookingOverride, 'updatedAt'>>;

function draftFrom(override: BookingOverride | undefined): Draft {
  return {
    provider: override?.provider ?? '',
    confirmationNumber: override?.confirmationNumber ?? '',
    primaryLabel: override?.primaryLabel ?? '',
    secondaryLabel: override?.secondaryLabel ?? '',
    note: override?.note ?? '',
  };
}

export function BookingOverrideEditor({ id, kind, isToBook, override, onSave, onClear }: BookingOverrideEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(override));

  if (!isToBook) return null;

  const labels = FIELD_LABELS[kind];
  const testId = (name: string) => `booking-override-${kind}-${id}-${name}`;

  function openForm() {
    setDraft(draftFrom(override));
    setOpen(true);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const patch: Omit<BookingOverride, 'updatedAt'> = {};
    if (draft.provider.trim()) patch.provider = draft.provider.trim();
    if (draft.confirmationNumber.trim()) patch.confirmationNumber = draft.confirmationNumber.trim();
    if (draft.primaryLabel.trim()) patch.primaryLabel = draft.primaryLabel.trim();
    if (draft.secondaryLabel.trim()) patch.secondaryLabel = draft.secondaryLabel.trim();
    if (draft.note.trim()) patch.note = draft.note.trim();
    onSave(id, patch);
    setOpen(false);
  }

  if (open) {
    return (
      <form
        onSubmit={submit}
        data-testid={testId('form')}
        className="mt-2 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3"
        aria-label={`Record the booking for ${id}`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="sr-only">{labels.provider}</span>
            <input
              data-testid={testId('provider')}
              value={draft.provider}
              onChange={(e) => setDraft((d) => ({ ...d, provider: e.target.value }))}
              placeholder={labels.provider}
              className={INPUT_CLS}
            />
          </label>
          <label className="block">
            <span className="sr-only">Confirmation number</span>
            <input
              data-testid={testId('confirmation')}
              value={draft.confirmationNumber}
              onChange={(e) => setDraft((d) => ({ ...d, confirmationNumber: e.target.value }))}
              placeholder="Confirmation number"
              className={INPUT_CLS}
            />
          </label>
          <label className="block">
            <span className="sr-only">{labels.primary}</span>
            <input
              data-testid={testId('primary')}
              value={draft.primaryLabel}
              onChange={(e) => setDraft((d) => ({ ...d, primaryLabel: e.target.value }))}
              placeholder={labels.primary}
              className={INPUT_CLS}
            />
          </label>
          <label className="block">
            <span className="sr-only">{labels.secondary}</span>
            <input
              data-testid={testId('secondary')}
              value={draft.secondaryLabel}
              onChange={(e) => setDraft((d) => ({ ...d, secondaryLabel: e.target.value }))}
              placeholder={labels.secondary}
              className={INPUT_CLS}
            />
          </label>
        </div>
        <label className="block">
          <span className="sr-only">Note</span>
          <input
            data-testid={testId('note')}
            value={draft.note}
            onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
            placeholder="Note (optional)"
            className={INPUT_CLS}
          />
        </label>
        <div className="flex justify-end gap-3 pt-1">
          <button type="button" onClick={() => setOpen(false)} className={LINK_BTN_CLS}>
            Cancel
          </button>
          <button
            type="submit"
            data-testid={testId('save')}
            className="min-h-tap inline-flex items-center rounded-lg bg-green-500/20 border border-green-500/30 px-3 text-[11px] font-medium text-green-200 outline-none transition-colors hover:bg-green-500/30 focus-visible:ring-2 focus-visible:ring-ring"
          >
            Save
          </button>
        </div>
      </form>
    );
  }

  if (override) {
    return (
      <div
        className="mt-2 rounded-xl border border-green-500/20 bg-green-500/5 p-3 text-[11px]"
        data-testid={testId('summary')}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-green-200">Booked — added on this device</span>
          <div className="flex gap-2">
            <button type="button" onClick={openForm} data-testid={testId('edit')} className={LINK_BTN_CLS}>
              Edit
            </button>
            <button type="button" onClick={() => onClear(id)} data-testid={testId('clear')} className={LINK_BTN_CLS}>
              Remove
            </button>
          </div>
        </div>
        {override.provider && (
          <p className="mt-1 text-ink-mid">
            {labels.provider}: <span className="text-ink-hi">{override.provider}</span>
          </p>
        )}
        {override.confirmationNumber && (
          <p className="text-ink-mid">
            Confirmation: <span className="font-mono text-ink-hi">{override.confirmationNumber}</span>
          </p>
        )}
        {(override.primaryLabel || override.secondaryLabel) && (
          <p className="text-ink-mid">
            {labels.primary} / {labels.secondary}:{' '}
            <span className="text-ink-hi">
              {override.primaryLabel || '—'} / {override.secondaryLabel || '—'}
            </span>
          </p>
        )}
        {override.note && <p className="text-ink-mid">{override.note}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={openForm}
      data-testid={testId('open')}
      className="mt-2 min-h-tap inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/10 px-3 text-[11px] font-medium text-amber-200 outline-none transition-colors hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring"
    >
      I booked this — add details
    </button>
  );
}
