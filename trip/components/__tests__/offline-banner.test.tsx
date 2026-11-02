import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner } from '@/components/offline-banner';

let pathname = '/';
let online = true;
let backOnline = false;
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/hooks/use-online', () => ({
  useOnline: () => online,
  useBackOnline: () => backOnline,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  pathname = '/';
  online = true;
  backOnline = false;
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = () => act(() => root.render(<OfflineBanner />));

describe('OfflineBanner route collision', () => {
  it.each(['/travel', '/travel/', '/travel/day'])('keeps announcements without pills on %s', (path) => {
    pathname = path;
    render();
    const region = container.querySelector('[role="status"]');
    expect(region?.textContent).toBe('');
    online = false;
    render();
    expect(container.querySelector('[role="status"]')).toBe(region);
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent).toContain('lost its network connection');
    expect(container.querySelector('[data-testid="offline-banner"]')).toBeNull();
    online = true;
    backOnline = true;
    render();
    expect(region?.textContent).toBe('Back online');
    expect(container.querySelector('[data-testid="online-restored"]')).toBeNull();
    expect(region?.getAttribute('aria-label')).toBeNull();
    backOnline = false;
    render();
    expect(region?.textContent).toBe('');
  });

  it.each(['/', '/plan/', '/travelogue'])('keeps visual connection cues on %s', (path) => {
    pathname = path;
    online = false;
    render();
    expect(container.querySelector('[data-testid="offline-banner"]')).not.toBeNull();
    online = true;
    backOnline = true;
    render();
    expect(container.querySelector('[data-testid="online-restored"]')).not.toBeNull();
  });

  it('updates route suppression during an offline spell', () => {
    pathname = '/travel/';
    online = false;
    render();
    pathname = '/plan/';
    render();
    expect(container.querySelector('[data-testid="offline-banner"]')).not.toBeNull();
  });
});
