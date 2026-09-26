// (#505): CommandPalette is a lazy `dynamic(..., {ssr:false})` island
// (app/chrome-islands.tsx) and may not have attached its `palette:open`
// listener yet when the navbar/More "Search" row is clicked right after
// hydration. Callers dispatch through `openPalette()` instead of the raw
// CustomEvent so a click that beats the chunk still opens it once mounted.
let pending = false;
let mounted = false;

export function openPalette() {
  if (typeof window === 'undefined') return;
  if (!mounted) pending = true;
  window.dispatchEvent(new CustomEvent('palette:open'));
}

export function markPaletteMounted() {
  mounted = true;
}

export function isPaletteMounted() {
  return mounted;
}

export function consumePendingPaletteOpen(): boolean {
  if (!pending) return false;
  pending = false;
  return true;
}
