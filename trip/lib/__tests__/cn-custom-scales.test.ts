import { describe, it, expect } from 'vitest';
import { cn } from '@/lib/utils';
import tailwindConfig from '@/tailwind.config';

/**
 * `cn()` wraps tailwind-merge, which ships knowing Tailwind's stock scales ONLY. Every
 * additive key in tailwind.config.ts was invisible to it, and it failed in both directions:
 *
 *   p-gut p-0                          -> BOTH kept, so CSS source order picked the winner
 *                                         (`.p-gut` is emitted after `.p-0`, so the class the
 *                                         markup asked for lost silently)
 *   text-muted-foreground text-t-micro -> `t-micro` was read as a text COLOUR, so it landed in
 *                                         one group with the colour and ate it
 *
 * lib/utils.ts teaches the merger those keys. The lists there are a hand copy of the config,
 * which is what this file guards: every additive key in a scale below has to dedupe against
 * its stock counterpart, both ways round, so adding a key to tailwind.config.ts and not to
 * lib/utils.ts is a red test rather than a rendering bug someone finds in a screenshot.
 */

const extend = tailwindConfig.theme?.extend ?? {};
const keysOf = (scale: unknown) => Object.keys((scale ?? {}) as Record<string, unknown>);

// [config scale, class prefix, a stock class in the SAME merge group to collide with]
const SCALES: ReadonlyArray<readonly [string, string[], string, string]> = [
  ['spacing', keysOf(extend.spacing), 'p-', 'p-0'],
  ['spacing', keysOf(extend.spacing), 'gap-', 'gap-2'],
  ['spacing', keysOf(extend.spacing), 'mt-', 'mt-4'],
  ['spacing', keysOf(extend.spacing), 'h-', 'h-10'],
  ['minHeight', keysOf(extend.minHeight), 'min-h-', 'min-h-0'],
  ['minWidth', keysOf(extend.minWidth), 'min-w-', 'min-w-0'],
  ['fontSize', keysOf(extend.fontSize), 'text-', 'text-xs'],
  ['borderRadius', keysOf(extend.borderRadius), 'rounded-', 'rounded-none'],
  ['borderWidth', keysOf(extend.borderWidth), 'border-', 'border-0'],
  ['boxShadow', keysOf(extend.boxShadow), 'shadow-', 'shadow-none'],
  ['transitionDuration', keysOf(extend.transitionDuration), 'duration-', 'duration-75'],
  ['animation', keysOf(extend.animation), 'animate-', 'animate-none'],
  ['backgroundImage', keysOf(extend.backgroundImage), 'bg-', 'bg-none'],
];

describe('cn() knows this project\'s custom Tailwind scales', () => {
  for (const [scale, keys, prefix, stock] of SCALES) {
    it(`${scale}: every key deduped against ${stock} (${keys.length} keys)`, () => {
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const custom = `${prefix}${key}`;
        expect(cn(custom, stock), `${custom} ${stock}`).toBe(stock);
        expect(cn(stock, custom), `${stock} ${custom}`).toBe(custom);
      }
    });
  }

  it('gut and gutter are one axis: the later token wins, neither is dropped on sight', () => {
    expect(cn('px-gutter', 'px-gut')).toBe('px-gut');
    expect(cn('px-gut', 'px-gutter')).toBe('px-gutter');
  });

  it('a type-scale key is a SIZE, so it no longer eats the text colour beside it', () => {
    expect(cn('text-muted-foreground', 'text-t-micro')).toBe(
      'text-muted-foreground text-t-micro'
    );
    expect(cn('text-t-micro', 'text-muted-foreground')).toBe(
      'text-t-micro text-muted-foreground'
    );
    expect(cn('text-ink-hi', 'text-n-lg')).toBe('text-ink-hi text-n-lg');
  });

  it('leaves different axes alone', () => {
    expect(cn('px-gutter py-16')).toBe('px-gutter py-16');
    expect(cn('p-gut', 'gap-2')).toBe('p-gut gap-2');
    expect(cn('h-tap', 'min-w-tap')).toBe('h-tap min-w-tap');
    expect(cn('rounded-r1', 'border-hair')).toBe('rounded-r1 border-hair');
  });

  it('resolves the variant-prefixed pair ui/command.tsx ships', () => {
    expect(
      cn(
        '[&_[cmdk-group-heading]]:text-t-micro [&_[cmdk-group-heading]]:text-muted-foreground'
      )
    ).toBe(
      '[&_[cmdk-group-heading]]:text-t-micro [&_[cmdk-group-heading]]:text-muted-foreground'
    );
  });

  it('a consumer p-0 beats the dialog primitive p-gut with no ! hatch', () => {
    expect(cn('gap-4 border bg-background p-gut py-5', 'overflow-hidden p-0')).toBe(
      'gap-4 border bg-background overflow-hidden p-0'
    );
  });
});
