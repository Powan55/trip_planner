import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GuideCards from '@/components/guide-cards';
import { GUIDE_CARDS, guideCardSchema } from '@/core/content/safety';

describe('GuideCards', () => {
  it('renders all three cards, labelled, with the Suica phone-type options', () => {
    const html = renderToStaticMarkup(<GuideCards id="t" />);
    expect(html).toContain('aria-labelledby="t-heading"');
    for (const c of GUIDE_CARDS) expect(html).toContain(`data-testid="guide-card-${c.id}"`);
    expect(html).toContain('Japan Safety Tips');
    expect(html).toContain('Welcome Suica');
    for (const label of ['iPhone', 'Android', 'Not sure']) expect(html).toContain(`>${label}</dt>`);
  });

  it('a country filter keeps only that leg', () => {
    const jp = renderToStaticMarkup(<GuideCards id="t" country="Japan" />);
    expect(jp).toContain('guide-card-jp-ic-card');
    expect(jp).not.toContain('guide-card-np-sim');
    const np = renderToStaticMarkup(<GuideCards id="t" country="Nepal" />);
    expect(np).toContain('guide-card-np-sim');
    expect(np).not.toContain('guide-card-jp-safety-tips');
  });

  it('pins no prices or validity numbers, and ships no links', () => {
    const text = JSON.stringify(GUIDE_CARDS);
    expect(text).not.toMatch(/https?:|\d/);
    expect(guideCardSchema.safeParse({ ...GUIDE_CARDS[0], extra: 1 }).success).toBe(false);
  });
});
