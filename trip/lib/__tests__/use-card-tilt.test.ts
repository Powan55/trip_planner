// @vitest-environment jsdom
//
// S215 — unit coverage for the card-tilt hook's guard logic (hooks/use-card-tilt.ts).
// Proves the hook's three guarantees, on a real run:
//   1. angle clamp — `computeTilt` is pure and clamped to ±MAX_TILT_DEG, incl. pointers
//      that leave the card and zero-size rects;
//   2. reduced-motion NO-OP (D-007 / D-056b) — the hook returns disabled, undefined style,
//      no-op handlers, and attaches NO `deviceorientation` listener;
//   3. permission-denied / pre-grant NO-OP — no gyro listener is attached until permission
//      is explicitly granted; a denied/absent request is a silent no-op. One grant drives a
//      SINGLE shared window listener for many cards.
//
// Hook is exercised by RENDERING it (a tiny renderHook shim over react-dom/client + act — no
// new dependency, mirrors lib/__tests__/use-favorites.test.ts). `useReducedMotion` is mocked
// (jsdom has no matchMedia); the rest of framer-motion is real.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const h = vi.hoisted(() => ({ reduce: false as boolean | null }));
vi.mock('framer-motion', async (orig) => {
  const actual = await orig<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => h.reduce };
});

import {
  computeTilt,
  MAX_TILT_DEG,
  useCardTilt,
  motionPermissionSupported,
  requestMotionPermission,
  __resetGyroForTest,
  type CardTilt,
} from '@/hooks/use-card-tilt';

const RECT = { left: 0, top: 0, width: 100, height: 100 };
const M = MAX_TILT_DEG;

function renderTilt(): { current: CardTilt; unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const ref = { current: null as unknown as CardTilt };
  function Probe() {
    ref.current = useCardTilt();
    return null;
  }
  act(() => root.render(createElement(Probe)));
  return {
    get current() {
      return ref.current;
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function hasOrientationListener(spy: ReturnType<typeof vi.spyOn>): boolean {
  return spy.mock.calls.some((c: unknown[]) => c[0] === 'deviceorientation');
}

beforeEach(() => {
  h.reduce = false;
  __resetGyroForTest();
  delete (globalThis as any).DeviceOrientationEvent;
});

afterEach(() => {
  vi.restoreAllMocks();
  __resetGyroForTest();
});

describe('computeTilt — angle clamp (pure)', () => {
  it('centers to zero tilt', () => {
    expect(computeTilt(50, 50, RECT)).toEqual({ rotateX: 0, rotateY: 0 });
  });

  it('maps each edge to ±MAX on the right axis', () => {
    expect(computeTilt(100, 50, RECT)).toEqual({ rotateX: 0, rotateY: M }); // right
    expect(computeTilt(0, 50, RECT)).toEqual({ rotateX: 0, rotateY: -M }); // left
    expect(computeTilt(50, 0, RECT)).toEqual({ rotateX: M, rotateY: 0 }); // top → toward viewer
    expect(computeTilt(50, 100, RECT)).toEqual({ rotateX: -M, rotateY: 0 }); // bottom
  });

  it('clamps pointers that leave the card to ±MAX', () => {
    const t = computeTilt(500, -500, RECT);
    expect(t.rotateY).toBe(M);
    expect(t.rotateX).toBe(M);
    expect(Math.abs(t.rotateX)).toBeLessThanOrEqual(M);
    expect(Math.abs(t.rotateY)).toBeLessThanOrEqual(M);
  });

  it('returns zero for a zero-size rect (no division by zero)', () => {
    expect(computeTilt(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      rotateX: 0,
      rotateY: 0,
    });
  });
});

describe('useCardTilt — reduced-motion HARD no-op (D-007/D-056b)', () => {
  it('disables tilt, drops the style, and attaches no listener', () => {
    h.reduce = true;
    const addSpy = vi.spyOn(window, 'addEventListener');
    const hook = renderTilt();

    expect(hook.current.enabled).toBe(false);
    expect(hook.current.style).toBeUndefined();
    // handlers are safe no-ops
    expect(() =>
      hook.current.onPointerMove({
        pointerType: 'mouse',
        clientX: 90,
        clientY: 10,
        currentTarget: { getBoundingClientRect: () => RECT },
      } as any),
    ).not.toThrow();
    expect(() => hook.current.onPointerLeave()).not.toThrow();
    expect(hasOrientationListener(addSpy)).toBe(false);

    hook.unmount();
  });
});

describe('useCardTilt — gyro permission gating', () => {
  it('attaches NO deviceorientation listener before permission is granted', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const hook = renderTilt(); // motion allowed, but permission never requested/granted
    expect(hook.current.enabled).toBe(true);
    expect(hasOrientationListener(addSpy)).toBe(false);
    hook.unmount();
  });

  it('a denied iOS request is a silent no-op — still no listener', async () => {
    (globalThis as any).DeviceOrientationEvent = function () {};
    (globalThis as any).DeviceOrientationEvent.requestPermission = vi
      .fn()
      .mockResolvedValue('denied');
    expect(motionPermissionSupported()).toBe(true);

    const addSpy = vi.spyOn(window, 'addEventListener');
    const granted = await requestMotionPermission();
    expect(granted).toBe(false);

    const hook = renderTilt();
    expect(hasOrientationListener(addSpy)).toBe(false);
    hook.unmount();
  });

  it('one grant drives a SINGLE shared listener for many cards', async () => {
    (globalThis as any).DeviceOrientationEvent = function () {};
    (globalThis as any).DeviceOrientationEvent.requestPermission = vi
      .fn()
      .mockResolvedValue('granted');

    const addSpy = vi.spyOn(window, 'addEventListener');
    await act(async () => {
      expect(await requestMotionPermission()).toBe(true);
    });

    const a = renderTilt();
    const b = renderTilt();
    const orientationAdds = addSpy.mock.calls.filter((c: unknown[]) => c[0] === 'deviceorientation');
    expect(orientationAdds).toHaveLength(1); // shared, not one-per-card

    a.unmount();
    b.unmount();
  });
});
