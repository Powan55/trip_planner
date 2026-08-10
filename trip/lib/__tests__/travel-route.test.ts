import { describe, it, expect } from 'vitest';

import { isTravelRoute } from '@/lib/travel-route';

// S184 (D-164): the chrome-suppression match rule the six islands share. The boundary
// check (not a bare `startsWith('/travel')`) is the load-bearing branch — assert it here so
// a regression that started matching `/travelogue`, or stopped matching the trailing-slash
// export form, fails a fast unit test rather than a slow visual-drift E2E.
describe('isTravelRoute', () => {
  it('matches the exact route and the trailingSlash export form', () => {
    expect(isTravelRoute('/travel')).toBe(true);
    expect(isTravelRoute('/travel/')).toBe(true);
  });

  it('matches nested Travel Mode paths (e.g. a future ?date deep segment)', () => {
    expect(isTravelRoute('/travel/2026-12-12')).toBe(true);
  });

  it('does NOT match sibling routes that merely share the prefix', () => {
    expect(isTravelRoute('/travelogue')).toBe(false);
    expect(isTravelRoute('/travel-guide')).toBe(false);
  });

  it('does NOT match unrelated routes or an empty/nullish pathname', () => {
    expect(isTravelRoute('/')).toBe(false);
    expect(isTravelRoute('/plan/')).toBe(false);
    expect(isTravelRoute('')).toBe(false);
    expect(isTravelRoute(null)).toBe(false);
    expect(isTravelRoute(undefined)).toBe(false);
  });
});
