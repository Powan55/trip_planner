import type { ReactNode } from 'react';

export default function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 font-machine text-n-sm font-semibold uppercase tracking-[0.06em] text-[color:var(--text-hi)]">
        {title}
      </h2>
      <div className="space-y-3 leading-relaxed text-[color:var(--text-mid)] [&_a]:underline [&_a]:underline-offset-4 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
