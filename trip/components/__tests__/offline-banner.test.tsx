import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineBanner, OfflineChip } from '@/components/offline-banner';

let online = true;
let backOnline = false;
vi.mock('@/hooks/use-online', () => ({
  useOnline: () => online,
  useBackOnline: () => backOnline,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  online = true;
  backOnline = false;
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const render = () =>
  act(() =>
    root.render(
      <>
        <OfflineBanner />
        <OfflineChip />
      </>,
    ),
  );
const region = () => container.querySelector('[role="status"]');

describe('offline cue', () => {
  it('announces through one always-mounted region, with or without a visible chip', () => {
    render();
    const before = region();
    expect(before?.textContent).toBe('');
    online = false;
    render();
    expect(region()).toBe(before);
    expect(before?.getAttribute('aria-live')).toBe('polite');
    expect(before?.getAttribute('aria-label')).toBe('You are offline');
    expect(before?.textContent).toContain('lost its network connection');
    online = true;
    backOnline = true;
    render();
    expect(before?.textContent).toBe('Back online');
    expect(before?.getAttribute('aria-label')).toBeNull();
    backOnline = false;
    render();
    expect(before?.textContent).toBe('');
  });

  it('shows the chip only while offline or just back online', () => {
    render();
    expect(container.querySelector('[data-testid="offline-banner"]')).toBeNull();
    online = false;
    render();
    expect(container.querySelector('[data-testid="offline-banner"]')?.textContent).toBe('Offline');
    online = true;
    backOnline = true;
    render();
    expect(container.querySelector('[data-testid="online-restored"]')?.textContent).toBe('Online');
  });

  it('never floats over the page (#1066)', () => {
    online = false;
    render();
    expect(container.querySelector('.fixed, .absolute, .sticky')).toBeNull();
    expect(container.querySelector('[data-testid="offline-banner"]')?.getAttribute('aria-hidden')).toBe('true');
  });
});
