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

describe('LazyVisible anchor + idle={false}', () => {
  it('stays pending with its id, and mounts with props when the hash matches', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
    Element.prototype.scrollIntoView = vi.fn();
    const Probe = ({ country }: { country: string }) => <p data-testid="probe">{country}</p>;
    const mount = async () => {
      const container = document.body.appendChild(document.createElement('div'));
      const root = createRoot(container);
      act(() =>
        root.render(<LazyVisible id="nightlife" idle={false} component={Probe} props={{ country: 'Japan' }} />),
      );
      await act(async () => {
        await new Promise((r) => setTimeout(r, 400));
      });
      return { container, done: () => { act(() => root.unmount()); container.remove(); } };
    };

    window.location.hash = '';
    const a = await mount();
    expect(a.container.querySelector('#nightlife[data-lazy-visible="pending"]')).not.toBeNull();
    expect(a.container.querySelector('[data-testid="probe"]')).toBeNull();
    a.done();

    window.location.hash = '#nightlife';
    const b = await mount();
    expect(b.container.querySelector('[data-testid="probe"]')?.textContent).toBe('Japan');
    b.done();
    window.location.hash = '';
    vi.unstubAllGlobals();
  });
});
