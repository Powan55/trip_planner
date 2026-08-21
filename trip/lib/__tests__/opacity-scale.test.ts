import { describe, expect, it } from 'vitest';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import config from '@/tailwind.config';

// #147: Tailwind 3 gates the colour opacity modifier on `theme.opacity`, and the default
// scale skips 15/35/45/55/85 — so those class names emitted no rule and the element fell
// back to preflight's #e5e7eb. Asserting on emitted CSS rather than on the scale's shape,
// because emission is the property that broke.
const emit = async (classes: string[]) => {
  const { css } = await postcss([
    tailwind({ ...config, content: [{ raw: classes.join(' '), extension: 'html' }] }),
  ]).process('@tailwind utilities;', { from: undefined });
  return css;
};

describe('colour opacity modifiers', () => {
  it('emits a rule for every integer step 0-100', async () => {
    const steps = Array.from({ length: 101 }, (_, i) => i);
    const css = await emit(steps.map((i) => `border-white/${i}`));
    const missing = steps.filter((i) => !css.includes(`.border-white\\/${i} {`));
    expect(missing).toEqual([]);
  });

  it('uses the written percentage as the alpha', async () => {
    const css = await emit(['border-white/15', 'border-white/35', 'bg-amber-500/15']);
    expect(css).toContain('border-color: rgb(255 255 255 / 0.15)');
    expect(css).toContain('border-color: rgb(255 255 255 / 0.35)');
    expect(css).toContain('background-color: rgb(245 158 11 / 0.15)');
  });
});
