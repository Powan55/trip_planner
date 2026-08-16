import { describe, it, expect } from 'vitest';
import { heroImageForLeg, HERO_DEFAULT, HERO_JAPAN } from '@/lib/hero-image';

describe('heroImageForLeg — leg to hero photograph', () => {
  it('japan leg -> the Tokyo hero', () => {
    expect(heroImageForLeg('japan')).toBe(HERO_JAPAN);
  });

  it('nepal leg -> the Himalaya hero', () => {
    expect(heroImageForLeg('nepal')).toBe(HERO_DEFAULT);
  });

  it('outside the trip window (null/undefined) -> the Himalaya hero, never blank', () => {
    expect(heroImageForLeg(null)).toBe(HERO_DEFAULT);
    expect(heroImageForLeg(undefined)).toBe(HERO_DEFAULT);
  });

  it("an unrecognised leg id still paints a photograph (custom pack's 'main')", () => {
    expect(heroImageForLeg('main')).toBe(HERO_DEFAULT);
    expect(heroImageForLeg('')).toBe(HERO_DEFAULT);
  });

  it('the two heroes are different files', () => {
    expect(HERO_DEFAULT).not.toBe(HERO_JAPAN);
  });
});
