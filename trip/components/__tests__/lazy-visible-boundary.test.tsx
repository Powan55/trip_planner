import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, vi } from 'vitest';
import LazyVisible from '@/components/lazy-visible';

function Boom(): never {
  throw new Error('Loading chunk failed');
}

describe('LazyVisible error containment', () => {
  it('shows a retry card for a throwing panel and keeps siblings up', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const container = document.body.appendChild(document.createElement('div'));
    const root = createRoot(container);
    act(() =>
      root.render(
        <div>
          <p>sibling</p>
          <LazyVisible component={Boom} />
        </div>,
      ),
    );
    // idle fallback (setTimeout 200ms in jsdom) mounts the panel
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(container.querySelector('[data-testid="panel-unavailable"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="map-island-unavailable"]')).toBeNull();
    expect(container.querySelector('[data-testid="map-island-retry"]')).not.toBeNull();
    expect(container.textContent).toContain('sibling');
    act(() => root.unmount());
    container.remove();
  });
});
