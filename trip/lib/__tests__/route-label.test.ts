// The palette's meta line printed raw slugs ("home #dashboard", "plan"), which read as a
// lowercase typo of the row's own title once the type pull-back put both in sentence-case sans.

import { describe, it, expect } from 'vitest';
import { NAV_ITEMS, routeLabel } from '@/lib/nav-items';

describe('routeLabel', () => {
  it('uses the nav catalog name for every route the catalog knows', () => {
    for (const item of NAV_ITEMS) {
      expect(routeLabel(item.href)).toBe(item.label);
    }
  });

  it('names the routes the catalog dropped when /guides/ replaced them', () => {
    expect(routeLabel('/nepal/')).toBe('Nepal');
    expect(routeLabel('/japan/')).toBe('Japan');
  });

  it('appends a sub-anchor as a section name', () => {
    expect(routeLabel('/', '#dashboard')).toBe('Today · Dashboard');
    expect(routeLabel('/', '#inspiration')).toBe('Today · Inspiration');
    expect(routeLabel('/nepal/', '#photography')).toBe('Nepal · Photography');
    expect(routeLabel('/nepal/', '#nightlife')).toBe('Nepal · Nightlife');
  });

  it('keeps nested segments and hyphenated anchors readable', () => {
    expect(routeLabel('/nepal/pokhara/')).toBe('Nepal · Pokhara');
    expect(routeLabel('/plan/', '#day-two')).toBe('Plan · Day two');
  });

  it('never returns a slug', () => {
    const routes = ['/', '/plan/', '/flights/', '/nepal/', '/japan/', '/map/', '/journal/',
      '/safety/', '/packing/', '/checklist/', '/share/', '/recap/', '/trips/', '/profile/',
      '/passport/', '/settings/'];
    for (const route of routes) {
      expect(routeLabel(route)).toMatch(/^[A-Z]/);
      expect(routeLabel(route)).not.toContain('/');
    }
  });
});
