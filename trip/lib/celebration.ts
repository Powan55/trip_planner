// — pure helpers behind the micro-celebration burst, kept outside React so the fire-once
// transition edge and the reduced-motion gate are unit-testable without a DOM render.

/** True only on an OBSERVED false→true edge, so a completion celebration fires once per live
 * transition — never on a re-render while the state stays true, and never on the FIRST
 * observation (`prev === null` seeds the baseline without firing: a list already complete in
 * storage, or a page loaded mid-trip, must not celebrate on every visit — review). */
export function crossedIntoComplete(prev: boolean | null, next: boolean): boolean {
  return next && prev === false;
}

/** Whether the burst should actually render: the caller says "fire" AND motion isn't reduced
 * */
export function celebrationVisible(active: boolean, reducedMotion: boolean | null | undefined): boolean {
  return active && !reducedMotion;
}
