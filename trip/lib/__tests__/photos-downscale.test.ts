// S160 — downscale sizing math (`fitWithin`) unit suite. The pure half of the capture pipeline: a
// >1600px source scales to a ≤1600px long edge preserving aspect; a source already within the box is
// NEVER upscaled. The Canvas/`toBlob` JPEG encode is browser-only glue (jsdom has neither
// `createImageBitmap` nor `canvas.toBlob`), proven end-to-end (real JPEG blob in IDB) by the Playwright
// capture flow. D-160 (1600px/q0.8) cited.

import { describe, it, expect } from 'vitest';
import { fitWithin, MAX_EDGE } from '@/core/photos/downscale';

describe('fitWithin — long edge ≤ MAX_EDGE, aspect preserved, never upscales', () => {
  it('scales a large landscape source down to a 1600px long edge', () => {
    const out = fitWithin(4000, 3000);
    expect(Math.max(out.w, out.h)).toBe(MAX_EDGE);
    expect(out).toEqual({ w: 1600, h: 1200 }); // 4:3 preserved
  });

  it('scales a large portrait source down to a 1600px long edge', () => {
    const out = fitWithin(3000, 4000);
    expect(Math.max(out.w, out.h)).toBe(MAX_EDGE);
    expect(out).toEqual({ w: 1200, h: 1600 });
  });

  it('never upscales a source already within the box (re-encode at its own size)', () => {
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(1600, 900)).toEqual({ w: 1600, h: 900 }); // exactly at the edge — unchanged
  });

  it('honors a custom maxEdge', () => {
    expect(fitWithin(2000, 1000, 1000)).toEqual({ w: 1000, h: 500 });
  });

  it('degrades a non-positive/NaN input to a 1×1 floor rather than throwing', () => {
    expect(fitWithin(0, 0)).toEqual({ w: 1, h: 1 });
    expect(fitWithin(Number.NaN, -5)).toEqual({ w: 1, h: 1 });
  });
});
