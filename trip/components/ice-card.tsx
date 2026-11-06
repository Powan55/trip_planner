'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Check, HeartPulse, Pencil, Trash2, X } from 'lucide-react';
import Sheet from '@/components/ui/sheet-dark';
import { SHEET_HEAD, SHEET_FOOT, SHEET_CLOSE } from '@/components/place-detail-sheet';
import { ICE_FIELDS, clearIce, loadIce, saveIce, type IceCard as Card } from '@/core/ice/ice';
import { useWakeLock } from '@/lib/use-wake-lock';

const FIELD =
  'w-full min-h-tap px-3 py-2 rounded-r1 bg-surface-raised border-hair border-[color:var(--border-ui)] text-ink-hi text-t-body focus:outline-none focus:ring-1 focus:ring-ring focus-visible:ring-2';

const telHref = (v: string) => `tel:${v.replace(/[^\d+]/g, '')}`;

export default function IceCard() {
  const [card, setCard] = useState<Card>({});
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Card>({});
  const [failed, setFailed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const fieldId = useId();

  useEffect(() => {
    setCard(loadIce());
    setReady(true);
  }, []);

  const filled = ICE_FIELDS.filter((f) => card[f.key]);
  useWakeLock(filled.length > 0);

  const openEditor = () => {
    setDraft(card);
    setFailed(false);
    setConfirmClear(false);
    setOpen(true);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!saveIce(draft)) {
      setFailed(true);
      return;
    }
    setCard(loadIce());
    setOpen(false);
  };

  const onClear = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearIce();
    setCard({});
    setOpen(false);
  };

  if (!ready) return null;

  return (
    <section
      aria-labelledby={`${titleId}-h`}
      data-testid="ice-card"
      className="mx-auto w-full max-w-3xl px-gut pb-16"
    >
      <div className="flex items-center justify-between gap-3 pb-3">
        <h2 id={`${titleId}-h`} className="pr pr--l flex items-center gap-2 text-ink-hi">
          <HeartPulse className="h-5 w-5" aria-hidden="true" />
          Emergency card
        </h2>
        <button
          ref={triggerRef}
          type="button"
          onClick={openEditor}
          data-testid="ice-edit"
          className="btn btn--2 min-h-tap px-4"
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          {filled.length ? 'Edit' : 'Add details'}
        </button>
      </div>

      {filled.length ? (
        <dl className="rounded-r2 border-2 border-[color:var(--border-ui)] bg-surface-raised p-4 space-y-4" data-testid="ice-view">
          {filled.map((f) => {
            const value = card[f.key]!;
            return (
              <div key={f.key}>
                <dt className="pr pr--lo">{f.label}</dt>
                <dd className="mt-1 whitespace-pre-line break-words text-2xl font-semibold leading-snug text-ink-hi">
                  {'tel' in f && /\d/.test(value) ? (
                    <a href={telHref(value)} className="underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {value}
                    </a>
                  ) : (
                    value
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="empty" data-testid="ice-empty">
          Blood type, allergies, medications, insurance and who to call. Kept on this device only:
          never synced, never in a backup or share link, and it works offline.
        </p>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        onExitComplete={() => triggerRef.current?.focus()}
        labelledBy={titleId}
        side="center"
        testId="ice-sheet"
        className="w-full max-w-md rounded-r3 max-h-[90dvh]"
      >
        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className={SHEET_HEAD}>
            <div className="min-w-0">
              <h3 id={titleId} className="pr pr--l text-ink-hi">
                Emergency card
              </h3>
              <p className="mt-0.5 text-t-sm text-ink-mid">Stays on this device. Never synced or backed up.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close dialog" className={SHEET_CLOSE}>
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-4 p-gut py-4">
            {ICE_FIELDS.map((f) => {
              const id = `${fieldId}-${f.key}`;
              const common = {
                id,
                name: f.key,
                value: draft[f.key] ?? '',
                maxLength: f.max,
                className: FIELD,
                onChange: (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [f.key]: e.target.value })),
              };
              return (
                <div key={f.key}>
                  <label htmlFor={id} className="pr pr--lo mb-1 block">
                    {f.label}
                  </label>
                  {'multiline' in f ? (
                    <textarea {...common} rows={2} className={`${FIELD} resize-none`} />
                  ) : (
                    <input
                      {...common}
                      type={'tel' in f ? 'tel' : 'text'}
                      autoComplete="off"
                      inputMode={'tel' in f ? 'tel' : undefined}
                    />
                  )}
                </div>
              );
            })}
            {failed && (
              <p role="alert" className="text-t-sm text-destructive">
                Could not save. This device may be out of storage.
              </p>
            )}
          </div>

          <div className={SHEET_FOOT}>
            <button type="submit" data-testid="ice-save" className="btn w-full max-w-none px-4">
              <Check className="h-4 w-4" aria-hidden="true" />
              Save
            </button>
            {filled.length > 0 && (
              <button
                type="button"
                onClick={onClear}
                onBlur={() => setConfirmClear(false)}
                data-testid="ice-clear"
                className="btn btn--2 w-full max-w-none min-h-tap px-4"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {confirmClear ? 'Tap again to delete the card' : 'Delete card'}
              </button>
            )}
            <span role="status" className="sr-only" data-testid="ice-clear-status">
              {confirmClear ? 'Tap again to delete the card' : ''}
            </span>
          </div>
        </form>
      </Sheet>
    </section>
  );
}
