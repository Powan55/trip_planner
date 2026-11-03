import { Smartphone } from 'lucide-react';
import { GUIDE_CARDS } from '@/core/content/safety';

export default function GuideCards({
  country,
  id,
  title = 'Connectivity & Official Alerts',
}: {
  country?: 'Nepal' | 'Japan';
  id: string;
  title?: string;
}) {
  const cards = GUIDE_CARDS.filter((c) => !country || c.country === country);
  if (cards.length === 0) return null;
  return (
    <section id={id} aria-labelledby={`${id}-heading`} data-testid={id} className="mx-auto mb-14 w-full max-w-4xl">
      <div className="sec px-gut">
        <h2 id={`${id}-heading`}>{title}</h2>
        <span className="sub">set up before you fly · offline</span>
      </div>
      <ul className="list">
        {cards.map((card) => (
          <li key={card.id} data-testid={`guide-card-${card.id}`} data-leg={card.country.toLowerCase()} className="r">
            <span className="tm flex items-center">
              <Smartphone className="h-4 w-4 text-ink-lo" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <h3>
                {card.title}
                {!country && <span className="chip ml-2 border-[color:var(--now)] text-now">{card.country}</span>}
              </h3>
              <span className="mt !normal-case !tracking-normal text-ink-mid">{card.body}</span>
              {card.options && (
                <dl className="mt-2 space-y-1 text-t-sm">
                  {card.options.map((o) => (
                    <div key={o.label} className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                      <dt className="shrink-0 font-semibold text-ink-hi sm:w-20">{o.label}</dt>
                      <dd className="text-ink-mid">{o.text}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {card.links && (
                <ul className="mt-2 flex flex-wrap gap-x-4" aria-label={`${card.title}: official links`}>
                  {card.links.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-tap items-center rounded-r1 text-t-sm text-[color:hsl(var(--accent))] underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {l.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
