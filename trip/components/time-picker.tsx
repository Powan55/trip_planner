'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Clock, X, Check } from 'lucide-react';
import { formatTimeAmPm } from '@/core/dates';
import {
  DEFAULT_TIME_MINUTES,
  combineMinutes,
  splitMinutes,
  type Period,
} from '@/lib/time-picker-format';

/**
 * The one hand-rolled AM/PM time picker in the app.
 *
 * Three keyboard-operable columns (Hour 1-12 / Minute 00-59 full list / AM-PM), no
 * native `input[type=time]`, no new dependency. Renders its OWN small
 * portaled overlay (like `ItemEditor`/`AddToItineraryDialog`) so it
 * is never clipped by an ancestor editor panel's `overflow-y-auto`/`overflow-hidden`.
 *
 * Nested-modal Esc handling: unlike the two existing dialogs, this picker's Esc is
 * handled on the PANEL's own `onKeyDown` (React, bubble-based) rather than a second
 * document-level listener — a second document listener would fire on the SAME
 * keypress as the parent editor's existing document-level Esc listener and
 * close both at once. `stopPropagation` on the panel keydown stops the native event
 * before it ever reaches `document`, so only the picker closes.
 *
 * Value is `startMinutes` (0-1439) or `undefined` (untimed) — the caller owns the
 * dual-write (setting/clearing the canonical `time` string alongside it).
 */

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1..12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0..59 — full list, no 5-min grid
const PERIODS: Period[] = ['AM', 'PM'];

export interface TimePickerProps {
  /** Applied to the trigger button, so a parent `<label htmlFor>` can target it. */
  id?: string;
  value: number | undefined;
  onChange: (minutes: number | undefined) => void;
  testId?: string;
}

export default function TimePicker({ id, value, onChange, testId }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Native `scrollIntoView` isn't covered by the app-wide `<MotionConfig
  // reducedMotion="user">` (that only gates framer's own `m.*` animations, which
  // is why the panel's open/close transitions below need no manual branching) —
  // so column-scroll behavior is branched explicitly here.
  const prefersReducedMotion = useReducedMotion();

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-time-picker-title`;

  const effective = splitMinutes(value ?? DEFAULT_TIME_MINUTES);

  const selectHour = (h: number) => onChange(combineMinutes(h, effective.minute, effective.period));
  const selectMinute = (mn: number) => onChange(combineMinutes(effective.hour12, mn, effective.period));
  const selectPeriod = (p: Period) => onChange(combineMinutes(effective.hour12, effective.minute, p));
  const clear = () => {
    onChange(undefined);
    setOpen(false);
  };

  // Focus-in on open: focus the Hour column's currently-selected option.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector<HTMLElement>('[data-col="hour"][aria-selected="true"]');
      target?.focus();
    }, 30);
    return () => clearTimeout(timer);
  }, [open]);

  // Esc closes just this picker (see the panel-vs-document rationale above); Tab is
  // trapped to the panel's focusable buttons (identical lightweight trap to
  // ItemEditor/AddToItineraryDialog).
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('button:not([disabled])'),
    ).filter((el) => el.tabIndex !== -1);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement as HTMLElement;
    if (e.shiftKey) {
      if (active === first || !panel.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const label = value !== undefined ? formatTimeAmPm(value) : 'Add time';

  return (
    <>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={testId ?? 'time-picker-trigger'}
        className="w-full min-h-[44px] flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2 focus-visible:outline-none"
      >
        <Clock className="w-4 h-4 text-white/40 shrink-0" aria-hidden="true" />
        <span className={value !== undefined ? 'text-white' : 'text-white/55'}>{label}</span>
      </button>

      {mounted &&
        createPortal(
          <AnimatePresence onExitComplete={() => triggerRef.current?.focus()}>
            {open && (
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={() => setOpen(false)}
              >
                <m.div
                  ref={panelRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={titleId}
                  data-testid="time-picker-panel"
                  onKeyDown={handleKeyDown}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="w-full max-w-xs glass-card-dark rounded-2xl p-4 shadow-2xl"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h4 id={titleId} className="text-sm font-semibold text-white">Set time</h4>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      aria-label="Close time picker"
                      data-testid="time-picker-close"
                      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg hover:bg-white/10 text-white/50 outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <TimeColumn
                      label="Hour"
                      colKey="hour"
                      options={HOURS}
                      value={effective.hour12}
                      onSelect={selectHour}
                      format={(h) => String(h)}
                      reducedMotion={!!prefersReducedMotion}
                    />
                    <TimeColumn
                      label="Minute"
                      colKey="minute"
                      options={MINUTES}
                      value={effective.minute}
                      onSelect={selectMinute}
                      format={(mn) => String(mn).padStart(2, '0')}
                      reducedMotion={!!prefersReducedMotion}
                    />
                    <TimeColumn
                      label="AM/PM"
                      colKey="period"
                      options={PERIODS}
                      value={effective.period}
                      onSelect={selectPeriod}
                      format={(p) => p}
                      reducedMotion={!!prefersReducedMotion}
                    />
                  </div>

                  <div className="flex gap-2 mt-4">
                    <button
                      type="button"
                      onClick={clear}
                      data-testid="time-picker-clear"
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-lg text-xs font-medium text-white/70 bg-white/5 hover:bg-white/10 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none"
                    >
                      Clear time
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      data-testid="time-picker-done"
                      className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-gold-500 text-navy-900 hover:bg-gold-400 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-navy-900 focus-visible:outline-none"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      Done
                    </button>
                  </div>
                </m.div>
              </m.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}

/** One keyboard-operable listbox column (44px touch targets, roving tabindex,
 * arrow/Home/End within the column, Tab moves between columns via the single roving stop). */
function TimeColumn<T extends string | number>({
  label,
  colKey,
  options,
  value,
  onSelect,
  format,
  reducedMotion,
}: {
  label: string;
  colKey: string;
  options: T[];
  value: T;
  onSelect: (v: T) => void;
  format: (v: T) => string;
  reducedMotion: boolean;
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();

  const move = (toIdx: number) => {
    const clamped = Math.max(0, Math.min(options.length - 1, toIdx));
    onSelect(options[clamped]);
    optionRefs.current[clamped]?.focus();
    optionRefs.current[clamped]?.scrollIntoView({
      block: 'nearest',
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  };

  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(idx + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(idx - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(options.length - 1);
    }
  };

  return (
    <div className="flex flex-col min-w-0">
      <span id={`${listId}-label`} className="text-[10px] uppercase tracking-wide text-white/50 mb-1 text-center">
        {label}
      </span>
      <div
        role="listbox"
        aria-labelledby={`${listId}-label`}
        tabIndex={-1}
        className="max-h-44 overflow-y-auto scrollbar-hide rounded-lg bg-white/5 border border-white/10 p-1 space-y-1"
      >
        {options.map((opt, idx) => {
          const selected = opt === value;
          return (
            <button
              key={String(opt)}
              type="button"
              ref={(el) => {
                optionRefs.current[idx] = el;
              }}
              role="option"
              aria-selected={selected}
              data-col={colKey}
              data-testid={`time-picker-${colKey}-${String(opt)}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(opt)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              className={`w-full min-h-[44px] flex items-center justify-center rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:outline-none ${
                selected ? 'bg-gold-500 text-navy-900' : 'text-white/70 hover:bg-white/10'
              }`}
            >
              {format(opt)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Duration entry (follows the duration dual-write rule; widget shape here is
 * a plain minutes number input, matching the numeric nature of the field,
 * over a second 2-column hour/minute picker — that's only worth building once
 * clash-warnings make duration entry a primary flow). Empty input = clear
 * (both `durationMinutes` and the canonical `duration` text -> undefined).
 */
export function DurationField({
  id,
  value,
  onChange,
  testId,
}: {
  id?: string;
  value: number | undefined;
  onChange: (minutes: number | undefined) => void;
  testId?: string;
}) {
  return (
    <input
      id={id}
      // type="text" + inputMode="numeric" (not type="number"): gives the mobile numeric
      // keypad WITHOUT the number-spinner's mouse-wheel footgun, where scrolling the page
      // over a focused field silently increments its value. onChange validates below.
      type="text"
      inputMode="numeric"
      value={value ?? ''}
      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value.trim();
        if (raw === '') {
          onChange(undefined);
          return;
        }
        const n = Math.round(Number(raw));
        onChange(Number.isFinite(n) && n > 0 ? n : undefined);
      }}
      data-testid={testId ?? 'duration-field-input'}
      className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-1 focus:ring-gold-400 focus-visible:ring-2"
      placeholder="e.g., 120"
    />
  );
}
