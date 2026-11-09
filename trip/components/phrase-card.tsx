'use client';

import { useId } from 'react';
import { X } from 'lucide-react';
import Sheet from '@/components/ui/sheet-dark';
import type { Phrase } from '@/core/content/safety';

export interface PhraseCardProps {
  open: boolean;
  phrase: Phrase | null;
  lang: 'ne' | 'ja';
  onClose(): void;
  onExitComplete?(): void;
}

export default function PhraseCard({ open, phrase, lang, onClose, onExitComplete }: PhraseCardProps) {
  const titleId = useId();
  const script = phrase && (lang === 'ne' ? phrase.nepaliScript : phrase.japaneseScript);
  const roman = phrase && (lang === 'ne' ? phrase.nepali : phrase.japanese);

  return (
    <Sheet
      open={open && phrase != null}
      onClose={onClose}
      onExitComplete={onExitComplete}
      labelledBy={titleId}
      side="center"
      testId="phrase-card"
      className="fixed inset-0 !bg-background"
    >
      <div className="flex shrink-0 justify-end p-3">
        <button
          type="button"
          onClick={onClose}
          data-testid="phrase-card-close"
          aria-label="Close phrase card"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-r1 text-[color:var(--text-mid)] outline-none hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-auto px-gut pb-12 text-center">
        <p
          id={titleId}
          lang={lang}
          data-testid="phrase-card-script"
          className="text-[clamp(2.5rem,13vw,6rem)] font-semibold leading-tight text-ink-hi"
        >
          {script}
        </p>
        <p data-testid="phrase-card-roman" className="text-t-lead text-ink-mid">
          {roman}
        </p>
        <p data-testid="phrase-card-english" className="text-t-sm text-ink-mid">
          {phrase?.english}
        </p>
      </div>
    </Sheet>
  );
}
