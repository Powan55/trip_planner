import { describe, it, expect } from 'vitest';
import { isLegalRoute } from '../legal-route';

describe('isLegalRoute', () => {
  it('matches the three pages with or without a trailing slash', () => {
    for (const p of ['/privacy', '/privacy/', '/terms/', '/contact/']) expect(isLegalRoute(p)).toBe(true);
  });
  it('rejects siblings and app routes', () => {
    for (const p of ['/', '/privacy-x/', '/more/', null, undefined]) expect(isLegalRoute(p)).toBe(false);
  });
});
