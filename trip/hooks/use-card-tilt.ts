'use client';

import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  useMotionValue,
  useSpring,
  useReducedMotion,
  type MotionStyle,
} from 'framer-motion';

/**
 * — pointer/gyro-driven 3D tilt for the `RecommendationCard` family ONLY.
 *
 * Two input paths feed the SAME pair of spring-smoothed rotation values:
 * - Desktop: pointer position over the card (`onPointerMove`), settling back to
 * flat on `onPointerLeave`. Touch pointers are ignored here — mobile uses gyro.
 * - Mobile: a SHARED `deviceorientation` stream (one window listener for the whole
 * page, not one per card). iOS 13+ gates the sensor behind
 * `DeviceOrientationEvent.requestPermission()`, which must be called from a user
 * gesture — the section renders one opt-in affordance via `useGyroOptIn`. If the
 * API is absent (desktop / older Android) or permission is denied, the gyro path
 * is a silent no-op; the pointer path is untouched.
 *
 * Reduced motion: under `useReducedMotion()` this hook
 * attaches NO listeners and returns NO tilt style — an EXPLICIT guard, because
 * pointer/gyro handlers are imperative and are NOT auto-neutralized by
 * `<MotionConfig reducedMotion="user">` (that only gates declarative framer props).
 */

/** Max tilt in degrees at a card edge/corner (brief: ~6–8°). */
export const MAX_TILT_DEG = 7;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

type Rect = { left: number; top: number; width: number; height: number };

/**
 * PURE. Clamped tilt (degrees) for a pointer at (`clientX`,`clientY`) over `rect`.
 * Center → {0,0}; each edge → ±`max` (corners hit ±max on both axes). Coordinates
 * outside the rect (a pointer that left the card mid-drag) stay clamped to ±max.
 * `rotateX` is inverted so the top edge tilts toward the viewer.
 */
export function computeTilt(
  clientX: number,
  clientY: number,
  rect: Rect,
  max = MAX_TILT_DEG,
): { rotateX: number; rotateY: number } {
  if (rect.width <= 0 || rect.height <= 0) return { rotateX: 0, rotateY: 0 };
  const nx = clamp((clientX - rect.left) / rect.width - 0.5, -0.5, 0.5); // -0.5..0.5
  const ny = clamp((clientY - rect.top) / rect.height - 0.5, -0.5, 0.5);
  return {
    rotateY: nx * 2 * max || 0, // left/right → rotateY (|| 0 normalizes -0)
    rotateX: -ny * 2 * max || 0, // up/down → rotateX (invert: top tilts toward viewer)
  };
}

// ── Shared gyro stream ────────────────────────────────────────────────────────
// One `deviceorientation` listener for the whole page drives every subscribed card,
// so N cards ≠ N listeners. Permission state is module-global (one grant covers all).

type GyroSub = (rotateX: number, rotateY: number) => void;
const gyroSubs = new Set<GyroSub>();
let gyroListening = false;
let gyroGranted = false;

// ponytail: gyro calibration is untunable without a physical device — a phone held
// at a ~45° reading angle should sit flat. These are the tuning knobs; adjust on
// real-device feedback if the neutral or sensitivity feels off.
const GYRO_NEUTRAL_BETA = 45; // front-back angle treated as "flat"
const GYRO_SENSITIVITY = 30; // degrees of device tilt that map to full card tilt

function onDeviceOrientation(e: DeviceOrientationEvent): void {
  const beta = e.beta ?? GYRO_NEUTRAL_BETA; // front-back, -180..180
  const gamma = e.gamma ?? 0; // left-right, -90..90
  const rotateY = clamp((gamma / GYRO_SENSITIVITY) * MAX_TILT_DEG, -MAX_TILT_DEG, MAX_TILT_DEG);
  const rotateX = clamp(
    (-(beta - GYRO_NEUTRAL_BETA) / GYRO_SENSITIVITY) * MAX_TILT_DEG,
    -MAX_TILT_DEG,
    MAX_TILT_DEG,
  );
  gyroSubs.forEach((fn) => fn(rotateX, rotateY));
}

function startGyro(): void {
  if (gyroListening || !gyroGranted || typeof window === 'undefined') return;
  gyroListening = true;
  window.addEventListener('deviceorientation', onDeviceOrientation);
}

function stopGyroIfIdle(): void {
  if (gyroListening && gyroSubs.size === 0 && typeof window !== 'undefined') {
    window.removeEventListener('deviceorientation', onDeviceOrientation);
    gyroListening = false;
  }
}

/** True only on browsers that gate the motion sensor behind a permission prompt (iOS 13+). */
export function motionPermissionSupported(): boolean {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    typeof (DeviceOrientationEvent as any).requestPermission === 'function'
  );
}

/**
 * Request the motion sensor from a user gesture. On non-gated browsers there is
 * nothing to ask, so it resolves granted. A thrown/denied result → `false`
 * (silent no-op; never retried, never nagged).
 */
export async function requestMotionPermission(): Promise<boolean> {
  if (gyroGranted) return true;
  if (!motionPermissionSupported()) {
    gyroGranted = true;
    startGyro();
    return true;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: string = await (DeviceOrientationEvent as any).requestPermission();
    gyroGranted = res === 'granted';
    if (gyroGranted) startGyro();
    return gyroGranted;
  } catch {
    gyroGranted = false;
    return false;
  }
}

/** Test-only: reset module-global gyro state between cases. */
export function __resetGyroForTest(): void {
  if (gyroListening && typeof window !== 'undefined') {
    window.removeEventListener('deviceorientation', onDeviceOrientation);
  }
  gyroSubs.clear();
  gyroListening = false;
  gyroGranted = false;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export interface CardTilt {
  /** False under reduced motion — the card renders flat with no listeners. */
  enabled: boolean;
  /** framer `style` for the card's `m.div` (spring rotateX/rotateY), or undefined when disabled. */
  style: MotionStyle | undefined;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: () => void;
}

const SPRING = { stiffness: 220, damping: 22, mass: 0.4 } as const;

/** Per-card tilt. Attach `style` + the two handlers to the card's `m.div`. */
export function useCardTilt(): CardTilt {
  const reduce = useReducedMotion();
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const srx = useSpring(rx, SPRING);
  const sry = useSpring(ry, SPRING);

  // Gyro subscription — only when motion is allowed. Reduced motion attaches nothing.
  useEffect(() => {
    if (reduce) return;
    const sub: GyroSub = (gx, gy) => {
      rx.set(gx);
      ry.set(gy);
    };
    gyroSubs.add(sub);
    startGyro(); // no-op until permission is granted
    return () => {
      gyroSubs.delete(sub);
      stopGyroIfIdle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce]);

  if (reduce) {
    const noop = () => {};
    return { enabled: false, style: undefined, onPointerMove: noop, onPointerLeave: noop };
  }

  return {
    enabled: true,
    style: { rotateX: srx, rotateY: sry, transformPerspective: 800 },
    onPointerMove: (e) => {
      if (e.pointerType === 'touch') return; // touch → gyro path owns tilt
      const rect = e.currentTarget.getBoundingClientRect();
      const t = computeTilt(e.clientX, e.clientY, rect);
      rx.set(t.rotateX);
      ry.set(t.rotateY);
    },
    onPointerLeave: () => {
      rx.set(0);
      ry.set(0);
    },
  };
}

export interface GyroOptIn {
  /** Whether to render the opt-in affordance (iOS, sensor not yet granted, motion allowed). */
  show: boolean;
  granted: boolean;
  request: () => void;
}

/**
 * Section-level (render ONCE): the iOS motion opt-in. `show` is client-only and
 * false on desktop/Android and under reduced motion, so no affordance renders there.
 */
export function useGyroOptIn(): GyroOptIn {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [granted, setGranted] = useState(false);
  useEffect(() => setMounted(true), []);
  return {
    show: mounted && !reduce && !granted && motionPermissionSupported(),
    granted,
    request: () => {
      void requestMotionPermission().then(setGranted);
    },
  };
}
