// @vitest-environment jsdom
//
// REACT-1 — `?focus=` cleanup must not hand a basePath-carrying path to the App Router.
//
// The palette pushes `/plan/?focus=<id>`; the planner consumed the param and then called
// `router.replace(window.location.pathname)`. `window.location.pathname` ALREADY carries the
// deployed basePath and `next/navigation` prepends it again, so on the live
// `NEXT_PUBLIC_BASE_PATH=/trip_planner` build the user was navigated from `/trip_planner/plan/`
// to `/trip_planner/trip_planner/plan/` — a 404 — instead of landing on the highlighted item.
// Local dev and e2e never saw it because `BASE_PATH` is empty there, which is exactly why this
// needs a unit check rather than a browser one.
//
// Two halves, both runnable:
//   1. `stripFocusParam` — the pure replacement. It returns a same-document path for
//      `history.replaceState`, keeps every other param, and is basePath-preserving (NOT
//      basePath-adding).
//   2. A source scan of `components/` pinning the convention itself: no `router.replace`/
//      `router.push` is ever fed `window.location.*`. That is the root cause, and it had exactly
//      one instance.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { stripFocusParam } from '@/components/calendar-planner';

describe('stripFocusParam', () => {
  it('drops ?focus= and keeps the basePath segment verbatim (never re-prefixes it)', () => {
    expect(stripFocusParam('https://powan55.github.io/trip_planner/plan/?focus=abc123')).toBe(
      '/trip_planner/plan/',
    );
  });

  it('keeps every other query param — `?today=` must survive the strip', () => {
    expect(
      stripFocusParam('https://powan55.github.io/trip_planner/plan/?today=2026-12-20&focus=abc123'),
    ).toBe('/trip_planner/plan/?today=2026-12-20');
  });

  it('preserves the hash and is a no-op when there is no focus param', () => {
    expect(stripFocusParam('http://localhost:3000/plan/#day-3')).toBe('/plan/#day-3');
    expect(stripFocusParam('http://localhost:3000/plan/?today=2026-12-20')).toBe(
      '/plan/?today=2026-12-20',
    );
  });
});

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...tsxFiles(full));
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('no App Router navigation is fed a window.location path', () => {
  it('components/ never calls router.replace/push with window.location.*', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(resolve(__dirname, '../../components'))) {
      const src = readFileSync(file, 'utf8');
      src.split(/\r?\n/).forEach((line, i) => {
        if (/router\s*\.\s*(replace|push)\s*\(\s*[^)]*window\s*\.\s*location/.test(line)) {
          offenders.push(`${file.replace(/\\/g, '/').split('/trip/')[1]}:${i + 1} — ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
