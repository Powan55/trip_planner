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
    expect(html).toContain('href="https://www.jreast.co.jp/en/multi/welcomesuica/"');
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

  it('pins no prices or validity numbers in the copy', () => {
    const text = JSON.stringify(GUIDE_CARDS.map(({ links: _links, ...rest }) => rest));
    expect(text).not.toMatch(/https?:|\d/);
    expect(guideCardSchema.safeParse({ ...GUIDE_CARDS[0], extra: 1 }).success).toBe(false);
  });

  it('every card links out: https only, new tab with noopener, destination in the name', () => {
    const html = renderToStaticMarkup(<GuideCards id="t" />);
    for (const c of GUIDE_CARDS) {
      expect(c.links?.length).toBeGreaterThan(0);
      for (const l of c.links!) {
        expect(html).toContain(`href="${l.href}" target="_blank" rel="noopener noreferrer"`);
        expect(html).toContain(`${l.label}<span class="sr-only"> (opens in a new tab)</span>`);
      }
    }
    expect(guideCardSchema.safeParse({ ...GUIDE_CARDS[0], links: [{ label: 'x', href: 'http://a.test' }] }).success).toBe(false);
  });
});
