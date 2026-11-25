// Contrast harness for the D-291 / D-292 / D-293 / D-334 token layer. Exits 1 on any failure.
//   npm run contrast-check     (or: node scripts/contrast-tokens.mjs)
//
// Computes WCAG contrast for every token pairing the app uses, so a token edit that breaks
// one fails CI with the pair named.
//
// The hexes are a pinned mirror of app/globals.css and tailwind.config.ts: keep them in step,
// in the same commit. Ratios come from the mirror on purpose, so a value change is a two-file
// decision. The tail checks the mirror still matches what those files declare.
//
// Over photography the worst-case pixel is knowable: the duotone grade's darken layer caps
// every channel at --duo-*-high, so the brightest pixel is over(--scrim-ink, --duo-*-high, a).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = h => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const ch = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const over = (fg, bg, a) => '#' + ch(fg).map((v, i) =>
  Math.round(v * a + ch(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
// Film grain (overlay at .06) lightens a dark base; a white speck doubles the channel.
// Modelled at worst case everywhere, even where no grain ships, since it costs real ratio.
const grain = c => '#' + ch(c).map(v => {
  const b = v / 255, o = b <= 0.5 ? Math.min(1, 2 * b) : 1;
  return Math.round(255 * (b * 0.94 + o * 0.06)).toString(16).padStart(2, '0');
}).join('');
// One decimal: whole numbers don't round-trip (#0A0818 would render with blue off by one),
// and globals.css declares these colours in both HSL and RGB.
const hsl = h => {
  const [r, g, b] = hex(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let H = 0; if (d) H = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const Li = (mx + mn) / 2, S = d ? d / (1 - Math.abs(2 * Li - 1)) : 0;
  return `${+(H * 60).toFixed(1)} ${+(S * 100).toFixed(1)}% ${+(Li * 100).toFixed(1)}%`;
};

const C = {
  // Canvas: hue cools as it rises (248 to 243) so depth isn't brightness alone. Warmth only
  // comes from screened country tints.
  bg: '#0A0818', surface1: '#141033', surface2: '#1C1948', surface3: '#26235C',
  // D-294: the passport page is PARCHMENT, not the earlier cream #F4EDE0. It is a
  // material scoped to one surface, not a light mode.
  paper: '#DCCDAE',
  // ---- text ----
  textHi: '#FFFFFF', textMid: '#CFC6E0', textLo: '#BEB4D6',
  // paperLo binds first if --paper changes; re-measure it then. Three paper inks map onto
  // --text-hi/-mid/-lo inside .passport-page; paperMid is the midpoint of the other two.
  onAccent: '#140F20', onPaper: '#2A2036', paperMid: '#3E334D', paperLo: '#524563',
  // --destructive #EF5D66 (hsl 356 82% 65%). It was NOT modelled here, which is how four
  // delete-confirms shipped `bg-rose-500 text-white` — an off-palette fill at 3.27:1 — and
  // how the ink rule's own worked example stayed an unmeasured number in a comment.
  destructive: '#EF5D66',
  // Six accents (D-334): volt is the chrome accent; marigold stays as Nepal's gold (= npB).
  marigold: '#FFC43D', coral: '#FF7A6B', mint: '#4ADE80',
  volt: '#3ED8FF', violet: '#C08CFF', pink: '#FF8FC7',
  // The lip owes 3:1 against the page, not its own fill. Gradient stops are measured
  // individually, never averaged.
  lipVolt: '#1C97CC', ctaA: '#6E8BFF', ctaB: '#43E4FF',
  // Country gradient stops (content colours, separate from the chrome accent).
  npA: '#FF8A3D', npB: '#FFC43D',            // Nepal: orange -> gold
  jpA: '#FF8FC7', jpB: '#C08CFF',            // Japan: pink -> violet
  // ---- borders (--border-ui's worst case is 4.30, on --surface-3) ----
  border: '#4A3880', borderUI: '#9184C9',
  // Tailwind brand-family steps, used as text and for traveller accents. The 400s are left out:
  // they equal marigold, --jp-a and --np-a, and the mirror check asserts that.
  gold500: '#d4a843', gold600: '#C08400',
  sakura300: '#FFB1D8', sakura500: '#e88fa2', sakura600: '#C25C90',
  himalaya500: '#e67635', himalaya600: '#C2692E',
  // ---- stamp inks on paper (D-294 values, NOT the pre-D-294 #B3123C/#2B4B9B/#0F6E5C) ----
  inkNepal: '#8E0E30', inkJapan: '#223C7C', inkGreen: '#0C5849',
  // Travel Mode high legibility (html[data-tm-legibility='high']): each surface name drops one
  // step darker. Keep in step with that block in globals.css.
  tmSurface: '#070510', tmLow: '#0A0818', tmRaised: '#141033', tmOverlay: '#1C1948',
  // TM mid and lo overrides; hi is white in both modes. The three stay distinct.
  tmMid: '#F2EFF9', tmLo: '#E9E4F5',
  // ---- duotone highlight caps (the photo engine) ----
  duoNpHigh: '#F5D4AC', duoJpHigh: '#EFC6D6',
  // Duotone shadow stop: the grade also floors every channel, so edges are checked at both ends.
  duoNpShadow: '#2E1408',
  scrimInk: '#0A0714',
};
// worst-case pixel = brightest possible photo pixel after the grade, under each scrim
C.npScrim72 = over(C.scrimInk, C.duoNpHigh, 0.72);
C.npScrim82 = over(C.scrimInk, C.duoNpHigh, 0.82);
C.jpScrim72 = over(C.scrimInk, C.duoJpHigh, 0.72);
C.jpScrim82 = over(C.scrimInk, C.duoJpHigh, 0.82);
// calm working surfaces: a hovered/selected row tint over surface-1
C.rowHover = over('#FFFFFF', C.surface1, 0.05);
// A selected row is INTERACTIVE STATE, so its tint follows the chrome accent (D-334),
// not the country stop the old value happened to share bytes with.
C.rowSel = over(C.volt, C.surface1, 0.10);
// chip fill inside a calm row
C.chip = over('#FFFFFF', C.surface2, 0.06);
// Screened country tint: color-mix(--np-a 14%, --surface-2), measured after grain. 18% looks
// legal on the raw mix but fails once the grain lightens it. Japan uses jp-a because jp-b is
// too close in hue to the field to read.
C.npScreen14 = grain(over(C.npA, C.surface2, 0.14));
C.jpScreen14 = grain(over(C.jpA, C.surface2, 0.14));
C.npScreen18 = grain(over(C.npA, C.surface2, 0.18));
// /checklist: cards are surface-1, with white/6% row hover and white/3% note inputs on top.
C.docsRowHover = over('#FFFFFF', C.surface1, 0.06);
C.docsNoteFill = over('#FFFFFF', C.surface1, 0.03);
// Home hero: text over the photo under .hero-scrim (floor 0.76). Sized against pure white,
// because the custom-trip gradient and the SVG fallback have no darken cap.
C.heroScrim76 = over(C.bg, '#FFFFFF', 0.76); // the ramp's floor — where hero copy sits
// Must-See stamp on an ungraded guide photo, so worst case is pure white.
C.stampScrim90 = over(C.scrimInk, '#FFFFFF', 0.9);
C.heroScrim90 = over(C.bg, '#FFFFFF', 0.90); // the ramp's top/bottom, under the navbar
// The reveal starts at FADE_FLOOR (0.95) and axe can sample that frame.
C.heroHiFading = over(C.textHi, C.heroScrim76, 0.95);
C.heroMidFading = over(C.textMid, C.heroScrim76, 0.95);
// The hero photo's darken cap (.hero-cap), per leg. Headroom only: the white pairs above
// still set the rule, since two hero branches have no cap.
C.heroCapNp76 = over(C.bg, C.duoNpHigh, 0.76);
C.heroCapJp76 = over(C.bg, C.duoJpHigh, 0.76);

// Passport sheet mid-entrance: FADE_FLOOR darkens the paper too, so both sides move. Green
// ink is the tightest.
C.paperFading = over(C.paper, C.bg, 0.95);
C.inkGreenFading = over(C.inkGreen, C.bg, 0.95);

// Outline danger button's hover wash is its own ink, so both sides move. 8% holds; 15% fails
// on surface-2.
C.dangerHover08Bg = over(C.destructive, C.bg, 0.08);
C.dangerHover08S1 = over(C.destructive, C.surface1, 0.08);
C.dangerHover08S2 = over(C.destructive, C.surface2, 0.08);
C.dangerHover15S2 = over(C.destructive, C.surface2, 0.15);

// .photo-header: two stacked ramps (keep in step with globals.css):
//   band scrim  .52 at 0%  ->  .56 at 30%  ->  .86 at 72%  ->  .94 at 90%  -> --bg
//   text floor  0 at 0px   ->  .62 at 68px ->  .78 at 100%  (body padding-top 92px, so all
//                                              text sits at floor >= .62)
// hdrMin is the worst case (.52 under .62). Changing the 92px padding or the 68px stop
// invalidates it.
const hdr = (cap, scrimA, floorA) => over(C.scrimInk, grain(over(C.scrimInk, cap, scrimA)), floorA);
C.npHdrMin = hdr(C.duoNpHigh, 0.52, 0.62);
C.jpHdrMin = hdr(C.duoJpHigh, 0.52, 0.62);
C.npHdrRest = hdr(C.duoNpHigh, 0.86, 0.78);
C.jpHdrRest = hdr(C.duoJpHigh, 0.86, 0.78);

// .plate: ramp stops are offsets from --plate-split, so the caption row line always lands at
//   .plate                      56% -> stops 34/52/64/80 -> 0.69 + (4/12) * 0.19 = 0.753
//   .plate--band / .plate--wide 42% -> stops 20/38/50/66 -> 0.69 + (4/12) * 0.19 = 0.753
// plate-ramp-frame.test.ts checks the CSS keeps tracking the split. No duotone cap on plates,
// so the worst pixel is white.
const plateRamp = a => grain(over(C.scrimInk, '#FFFFFF', a));
const PLATE_ROW_TOP = 0.69 + (4 / 12) * (0.88 - 0.69);
C.plateLay = plateRamp(PLATE_ROW_TOP);
C.plateLayBand = plateRamp(PLATE_ROW_TOP);
// .plate .chip gets its own .82 ground, measured on bare white since the chip can sit above
// the ramp.
C.plateChip = grain(over(C.bg, '#FFFFFF', 0.82));

// The transparent navbar sits over the band's top too, hence the flat top layer in the scrim.
// Links are white/70, composited.
C.navWhite70Np = over(C.textHi, C.npHdrMin, 0.7);
C.navWhite70Jp = over(C.textHi, C.jpHdrMin, 0.7);

// The sign-in view: the auth card floats over the Nepal-graded cover under a flat .72 scrim.
C.doorWall = grain(over(C.scrimInk, C.duoNpHigh, 0.72));
// The dark end of the same backdrop (D-332). The panel's edge is checked against both ends.
C.doorWallLo = grain(over(C.scrimInk, C.duoNpShadow, 0.72));

// [label, fg, bg, target]  4.5 = body · 3 = large (>=24px, or >=18.66px bold) / UI edge
const pairs = [
  ['-- THE CALM WORKING SCREENS (text on solid fills) --'],
  ['text-hi on bg', C.textHi, C.bg, 4.5],
  ['text-mid on bg', C.textMid, C.bg, 4.5],
  ['text-lo on bg', C.textLo, C.bg, 4.5],
  ['text-hi on surface-1', C.textHi, C.surface1, 4.5],
  ['text-mid on surface-1', C.textMid, C.surface1, 4.5],
  ['text-lo on surface-1', C.textLo, C.surface1, 4.5],
  ['text-hi on surface-2', C.textHi, C.surface2, 4.5],
  ['text-mid on surface-2', C.textMid, C.surface2, 4.5],
  ['text-lo on surface-2', C.textLo, C.surface2, 4.5],
  ['text-mid on surface-3', C.textMid, C.surface3, 4.5],
  ['text-lo on surface-3', C.textLo, C.surface3, 4.5],
  ['text-mid on row:hover', C.textMid, C.rowHover, 4.5],
  ['text-lo on row:hover', C.textLo, C.rowHover, 4.5],
  ['text-hi on row[selected]', C.textHi, C.rowSel, 4.5],
  ['text-mid on row[selected]', C.textMid, C.rowSel, 4.5],
  ['text-lo on chip fill', C.textLo, C.chip, 4.5],

  ['-- SCREENED COUNTRY TINT AT THE 14% CEILING (measured through the grain) --'],
  ['text-lo on np-a 14% / surface-2', C.textLo, C.npScreen14, 4.5],
  ['text-lo on jp-a 14% / surface-2', C.textLo, C.jpScreen14, 4.5],
  ['text-mid on np-a 14% / surface-2', C.textMid, C.npScreen14, 4.5],
  ['text-hi on jp-a 14% / surface-2', C.textHi, C.jpScreen14, 4.5],
  // The tint's own 1px border is full-strength channel, which is where most of the identity
  // sits: it costs no screen headroom at all, so the fill can stay at the ceiling.
  ['np-a border on its own 14% tint, 1.4.11', C.npA, C.npScreen14, 3],
  ['jp-a border on its own 14% tint, 1.4.11', C.jpA, C.jpScreen14, 3],

  ['-- /checklist, ISSUE #27 ROUTE 1 (tiers on that route\'s composited fills) --'],
  ['label (hi) on row:hover', C.textHi, C.docsRowHover, 4.5],
  ['done label (lo) on row:hover', C.textLo, C.docsRowHover, 4.5],
  ['note value (hi) on note fill', C.textHi, C.docsNoteFill, 4.5],
  ['note placeholder (lo) on note fill', C.textLo, C.docsNoteFill, 4.5],

  ['-- ACCENT AS TEXT (category ink, links, live values) --'],
  ['marigold on bg', C.marigold, C.bg, 4.5],
  ['marigold on surface-1', C.marigold, C.surface1, 4.5],
  ['marigold on surface-2', C.marigold, C.surface2, 4.5],
  ['coral on bg', C.coral, C.bg, 4.5],
  ['coral on surface-2', C.coral, C.surface2, 4.5],
  ['mint on bg', C.mint, C.bg, 4.5],
  ['mint on surface-2', C.mint, C.surface2, 4.5],
  ['volt on bg', C.volt, C.bg, 4.5],
  ['volt on surface-1', C.volt, C.surface1, 4.5],
  ['volt on surface-2', C.volt, C.surface2, 4.5],
  ['volt on surface-3', C.volt, C.surface3, 4.5],
  ['violet on bg', C.violet, C.bg, 4.5],
  ['violet on surface-2', C.violet, C.surface2, 4.5],
  ['pink on bg', C.pink, C.bg, 4.5],
  ['pink on surface-2', C.pink, C.surface2, 4.5],
  ['gold-600 on bg', C.gold600, C.bg, 4.5],
  ['sakura-300 on bg', C.sakura300, C.bg, 4.5],
  ['himalaya-600 on bg', C.himalaya600, C.bg, 4.5],

  ['-- COUNTRY GRADIENT AS TEXT (every stop must pass ALONE) --'],
  ['nepal stop A on bg', C.npA, C.bg, 4.5],
  ['nepal stop B on bg', C.npB, C.bg, 4.5],
  ['nepal stop A on surface-2', C.npA, C.surface2, 4.5],
  ['nepal stop B on surface-2', C.npB, C.surface2, 4.5],
  ['japan stop A on bg', C.jpA, C.bg, 4.5],
  ['japan stop B on bg', C.jpB, C.bg, 4.5],
  ['japan stop A on surface-2', C.jpA, C.surface2, 4.5],
  ['japan stop B on surface-2', C.jpB, C.surface2, 4.5],

  ['-- ON-ACCENT INK (every saturated fill a label sits on) --'],
  ['ink on marigold', C.onAccent, C.marigold, 4.5],
  ['ink on coral', C.onAccent, C.coral, 4.5],
  ['ink on mint', C.onAccent, C.mint, 4.5],
  ['ink on volt', C.onAccent, C.volt, 4.5],
  ['ink on CTA gradient stop A', C.onAccent, C.ctaA, 4.5],
  ['ink on CTA gradient stop B', C.onAccent, C.ctaB, 4.5],
  ['ink on violet', C.onAccent, C.violet, 4.5],
  ['ink on pink', C.onAccent, C.pink, 4.5],
  ['ink on nepal stop A', C.onAccent, C.npA, 4.5],
  ['ink on nepal stop B', C.onAccent, C.npB, 4.5],
  ['ink on japan stop A', C.onAccent, C.jpA, 4.5],
  ['ink on japan stop B', C.onAccent, C.jpB, 4.5],

  ['-- TEXT OVER PHOTOGRAPHY (worst-case pixel, not average) --'],
  ['white on NEPAL duo, scrim .72', C.textHi, C.npScrim72, 4.5],
  ['white on NEPAL duo, scrim .82', C.textHi, C.npScrim82, 4.5],
  ['text-mid on NEPAL duo, scrim .82', C.textMid, C.npScrim82, 4.5],
  ['white on JAPAN duo, scrim .72', C.textHi, C.jpScrim72, 4.5],
  ['white on JAPAN duo, scrim .82', C.textHi, C.jpScrim82, 4.5],
  ['text-mid on JAPAN duo, scrim .82', C.textMid, C.jpScrim82, 4.5],
  ['marigold chapter-no on NP .72 (large)', C.marigold, C.npScrim72, 3],
  ['pink chapter-no on JP .72 (large)', C.pink, C.jpScrim72, 3],

  ['-- ISSUE #3 TIER-2 PHOTO HEADER (worst case behind ANY text pixel) --'],
  ['title (hi) on NP header', C.textHi, C.npHdrMin, 4.5],
  ['title (hi) on JP header', C.textHi, C.jpHdrMin, 4.5],
  ['subtitle (mid) on NP header', C.textMid, C.npHdrMin, 4.5],
  ['subtitle (mid) on JP header', C.textMid, C.jpHdrMin, 4.5],
  // Not used by the subtitle (it's ink-mid), but lo binds first if the scrim lightens.
  ['text-lo on NP header (the tightest header pair)', C.textLo, C.npHdrMin, 4.5],
  ['text-lo on JP header (the tightest header pair)', C.textLo, C.jpHdrMin, 4.5],
  // The two country <h1>s paint their gradient THROUGH the glyphs, so a reader lands on
  // whichever stop falls under the letter they are reading — every stop passes alone.
  ['/nepal h1 stop A on NP header', C.npA, C.npHdrMin, 4.5],
  ['/nepal h1 stop B on NP header', C.npB, C.npHdrMin, 4.5],
  ['/japan h1 stop A on JP header', C.jpA, C.jpHdrMin, 4.5],
  ['/japan h1 stop B on JP header', C.jpB, C.jpHdrMin, 4.5],
  // Per-route accent eyebrows. 11.6px caps — SMALL text, so 4.5 and not the 3:1
  // large-text allowance, and each is measured over the grade its own photo carries.
  ['/guides eyebrow (coral) on JP header', C.coral, C.jpHdrMin, 4.5],
  ['/nepal eyebrow (nepal B) on NP header', C.npB, C.npHdrMin, 4.5],
  ['/japan eyebrow (japan A) on JP header', C.jpA, C.jpHdrMin, 4.5],
  // /map's accent is marigold so it isn't the chrome accent (volt).
  ['/map eyebrow (marigold) on JP header', C.marigold, C.jpHdrMin, 4.5],
  ['/journal eyebrow (violet) on NP header', C.violet, C.npHdrMin, 4.5],
  ['/flights eyebrow (mint) on NP header', C.mint, C.npHdrMin, 4.5],
  // And where the text actually sits, once the band ramp has run its course.
  ['subtitle (mid) at the NP header rest position', C.textMid, C.npHdrRest, 4.5],
  ['subtitle (mid) at the JP header rest position', C.textMid, C.jpHdrRest, 4.5],
  // The unscrolled navbar, which is transparent and now sits on the band.
  ['navbar brand (hi) over NP header', C.textHi, C.npHdrMin, 4.5],
  ['navbar link (white/70) over NP header', C.navWhite70Np, C.npHdrMin, 4.5],
  ['navbar link (white/70) over JP header', C.navWhite70Jp, C.jpHdrMin, 4.5],
  ['brand separator + pin (lo) over NP header', C.textLo, C.npHdrMin, 4.5],
  ['brand separator + pin (lo) over JP header', C.textLo, C.jpHdrMin, 4.5],

  ['-- ISSUE #373 THE PHOTOGRAPHIC PLATE (ramp alpha at the caption row top) --'],
  // The default 56%/44% split — components/travel-inspiration.tsx, a bare `.plate`.
  ['plate title (hi) at the 56% split', C.textHi, C.plateLay, 4.5],
  ['plate blurb (mid) at the 56% split', C.textMid, C.plateLay, 4.5],
  // `.chip--np` / `.chip--jp` are the country stop as TEXT and as the chip's 1px edge, on
  // the chip's own ground. Contrast is symmetric, so the 4.5 text row covers the 3:1 edge.
  ['country chip (nepal A) on the chip ground', C.npA, C.plateChip, 4.5],
  ['country chip (japan A) on the chip ground', C.jpA, C.plateChip, 4.5],
  // The 42%/58% split — `.plate--band` (components/home-chapters.tsx) and `.plate--wide`
  // at >=700px (app/guides/page.tsx). The chapter numerals are display text, so 3:1.
  ['plate eyebrow/body (mid) at the 42% split', C.textMid, C.plateLayBand, 4.5],
  ['plate title (hi) at the 42% split', C.textHi, C.plateLayBand, 4.5],
  ['chapter 01 numeral (marigold) at the 42% split', C.marigold, C.plateLayBand, 3],
  ['chapter 02 numeral (pink) at the 42% split', C.pink, C.plateLayBand, 3],

  ['-- THE FRONT DOOR, ISSUE #25 --'],
  // Front door (landing-page.tsx) foregrounds on the .photo-header composites. text-primary is
  // volt; the chapter numerals are marigold and pink.
  ['door eyebrow (volt) on the NP cover', C.volt, C.npHdrMin, 4.5],
  ['door headline (hi) on the NP cover', C.textHi, C.npHdrMin, 4.5],
  ['door lead + join note (mid) on the NP cover', C.textMid, C.npHdrMin, 4.5],
  // The outline CTA's edge is its only boundary over the photo; --border would be 1.31:1.
  ['door ghost CTA edge (border-ui) on the cover', C.borderUI, C.npHdrMin, 3],
  ['door join link (volt) on the NP cover', C.volt, C.npHdrMin, 4.5],
  // The chapter numerals are Instrument Serif at the editorial-lg step (>=2.4rem), i.e. LARGE
  // text, so 3:1 — measured over each chapter's own grade rather than borrowing the other's.
  ['chapter 01 numeral (marigold) on NP', C.marigold, C.npHdrMin, 3],
  ['chapter 02 numeral (pink) on JP', C.pink, C.jpHdrMin, 3],
  ['chapter title (hi) on JP', C.textHi, C.jpHdrMin, 4.5],
  ['chapter body (mid) on JP', C.textMid, C.jpHdrMin, 4.5],
  // Closing block: mint fill with an inverted button.
  ['closing block ink on mint', C.onAccent, C.mint, 4.5],
  ['inverted CTA label (volt) on ink', C.volt, C.onAccent, 4.5],
  // Its focus ring: ring on the surface-coloured gap, and gap on mint.
  ['closing CTA focus ring vs its offset gap', C.volt, C.bg, 3],
  ['closing CTA offset gap vs the mint block', C.bg, C.mint, 3],
  // The wall's second view — the auth card, Tier 3, on the opaque surface-2 panel. The field
  // fill is surface-3 and its EDGE is the interactive boundary token (both measured under
  // 1.4.11 above); these are the text tiers and the one error colour on those fills.
  ['auth field value (hi) on surface-3', C.textHi, C.surface3, 4.5],
  ['auth field placeholder (lo) on surface-3', C.textLo, C.surface3, 4.5],
  ['auth error (coral) on the panel', C.coral, C.surface2, 4.5],
  // The .72 cover behind the auth card.
  ['white over the cover at the panel scrim .72', C.textHi, C.doorWall, 4.5],
  ['text-mid over the cover at the panel scrim .72', C.textMid, C.doorWall, 4.5],
  // Auth panel edge at both ends (D-332). 2 at the bright end is a project floor for a
  // container edge, not WCAG; 3 isn't reachable there without spending an accent on a border.
  ['auth panel edge (border-ui) on the cover, brightest', C.borderUI, C.doorWall, 2],
  ['auth panel edge (border-ui) on the cover, darkest', C.borderUI, C.doorWallLo, 3],

  ['-- THE HOME HERO, ISSUE #26 (one scrim, floor .76, worst pixel = pure white) --'],
  ['hero title (hi) at the scrim floor', C.textHi, C.heroScrim76, 4.5],
  ['hero copy (mid) at the scrim floor', C.textMid, C.heroScrim76, 4.5],
  ['hero title (hi), darkest reveal frame', C.heroHiFading, C.heroScrim76, 4.5],
  ['hero copy (mid), darkest reveal frame', C.heroMidFading, C.heroScrim76, 4.5],
  ['hero mark (lo) at the floor, 3:1 only', C.textLo, C.heroScrim76, 3],
  ['hero copy (mid) at the ramp top .90', C.textMid, C.heroScrim90, 4.5],
  // Same pairs over the capped photo. They can't fail on a cap change (white is the limit);
  // they move only with --text-hi/--text-mid.
  ['hero title (hi) over the capped photo, NP', C.textHi, C.heroCapNp76, 4.5],
  ['hero copy (mid) over the capped photo, NP', C.textMid, C.heroCapNp76, 4.5],
  ['hero title (hi) over the capped photo, JP', C.textHi, C.heroCapJp76, 4.5],
  ['hero copy (mid) over the capped photo, JP', C.textMid, C.heroCapJp76, 4.5],
  ['countdown value (hi) on a cell', C.textHi, C.surface2, 4.5],
  ['countdown label (lo) on a cell', C.textLo, C.surface2, 4.5],
  ['live cell digits, japan stop A', C.jpA, C.surface2, 4.5],
  ['live cell digits, japan stop B', C.jpB, C.surface2, 4.5],
  ['live cell edge (jp-a), 1.4.11 3:1', C.jpA, C.surface2, 3],
  ['stat value (hi) on a stat cell', C.textHi, C.surface1, 4.5],
  ['stat caption (lo) on a stat cell', C.textLo, C.surface1, 4.5],

  ['-- ISSUE #781: OUTDOOR LEGIBILITY (base app) --'],
  // The Must-See stamp paints --now (np-a or jp-a) on a .9 scrim over the photo.
  ['Must-See stamp (np-a) on .9 scrim, white px', C.npA, C.stampScrim90, 4.5],
  ['Must-See stamp (jp-a) on .9 scrim, white px', C.jpA, C.stampScrim90, 4.5],
  // These pass since --text-lo was lifted (D-676), but the rules stand: no ink-lo words over a
  // photo, and tint screens cap at 14%. Loosening either is its own decision.
  ['--text-lo over the hero photo (not used)', C.textLo, C.heroScrim76, 4.5],
  ['--text-lo over capped hero, NP (not used)', C.textLo, C.heroCapNp76, 4.5],
  ['--text-lo over capped hero, JP (not used)', C.textLo, C.heroCapJp76, 4.5],
  ['--text-lo over the wall cover (not used)', C.textLo, C.doorWall, 4.5],
  ['--text-lo on np-a 18% screen (not used)', C.textLo, C.npScreen18, 4.5],

  ['-- THE DANGER VARIANT (globals.css `.btn--danger`, SPEC 9.7 defines none) --'],
  // The filled confirm. --destructive is a SATURATED FILL and the ink rule covers it like
  // any other; the guards below carry the two spellings that keep getting reached for.
  ['on-accent ink on the destructive fill', C.onAccent, C.destructive, 4.5],
  // The outline affordance: ink and border are both --destructive, at rest and on hover.
  ['destructive as text on bg', C.destructive, C.bg, 4.5],
  ['destructive as text on surface-1', C.destructive, C.surface1, 4.5],
  ['destructive as text on surface-2', C.destructive, C.surface2, 4.5],
  ['destructive ink on its own 8% hover, bg', C.destructive, C.dangerHover08Bg, 4.5],
  ['destructive ink on its own 8% hover, s1', C.destructive, C.dangerHover08S1, 4.5],
  ['destructive ink on its own 8% hover, s2', C.destructive, C.dangerHover08S2, 4.5],
  ['destructive border vs surface-1, 1.4.11', C.destructive, C.surface1, 3],
  ['destructive border vs surface-3, 1.4.11', C.destructive, C.surface3, 3],

  ['-- PASSPORT PARCHMENT (a light material inside the dark app, D-294) --'],
  ['on-paper ink on paper', C.onPaper, C.paper, 4.5],
  ['paper-mid on paper', C.paperMid, C.paper, 4.5],
  ['paper-lo on paper', C.paperLo, C.paper, 4.5],
  ['nepal stamp ink on paper', C.inkNepal, C.paper, 4.5],
  ['japan stamp ink on paper', C.inkJapan, C.paper, 4.5],
  ['green stamp ink on paper', C.inkGreen, C.paper, 4.5],
  // /passport's reversed badges and stamp ring. Symmetric with the rows above, listed anyway
  // so a badge tweak gets measured.
  ['paper label on a nepal ink badge', C.paper, C.inkNepal, 4.5],
  ['paper label on a japan ink badge', C.paper, C.inkJapan, 4.5],
  ['paper label on a green ink badge', C.paper, C.inkGreen, 4.5],
  ['stamp ring (japan ink) vs paper, 1.4.11', C.inkJapan, C.paper, 3],
  ['stamp ring (green ink) vs paper, 1.4.11', C.inkGreen, C.paper, 3],
  ['empty-slot frame (paper-lo) vs paper, 1.4.11', C.paperLo, C.paper, 3],
  ['tightest stamp ink (green), darkest reveal frame', C.inkGreenFading, C.paperFading, 4.5],
  ['the sheet itself vs the canvas, darkest reveal frame', C.paperFading, C.bg, 3],

  ['-- NON-TEXT UI, WCAG 1.4.11 (needs 3:1) --'],
  ['focus ring vs bg', C.volt, C.bg, 3],
  ['focus ring vs surface-1', C.volt, C.surface1, 3],
  ['focus ring vs surface-2', C.volt, C.surface2, 3],
  ['focus ring vs surface-3', C.volt, C.surface3, 3],
  ['focus ring vs paper', C.inkNepal, C.paper, 3],
  ['interactive border vs bg', C.borderUI, C.bg, 3],
  ['interactive border vs surface-1', C.borderUI, C.surface1, 3],
  ['interactive border vs surface-2', C.borderUI, C.surface2, 3],
  ['interactive border vs surface-3', C.borderUI, C.surface3, 3],
  ['paper page edge vs bg', C.paper, C.bg, 3],
  ['selected-row rail (volt) vs surface-1', C.volt, C.surface1, 3],
  // The chrome accent's button lip. It is a SHADING against its own fill and is measured
  // that way in globals.css (1.96); what it owes as a NON-TEXT edge is 3:1 against the
  // page, so a control never dissolves at its bottom edge.
  ['volt button lip vs bg', C.lipVolt, C.bg, 3],
];

// Travel Mode high legibility, per tier and surface name, three checks:
//   1. Raise: TM must beat normal mode. Not enough alone, since the darker surfaces raise every
//      pair even if the tiers were never overridden.
//   2. Outdoor floor of 12:1, not 4.5: the mode is for direct sunlight. Its shipped pairs
//      bottom out at 13.17.
//   3. The three TM tiers must differ, or setting them all to white would pass 1 and 2.
// [label, normal fg, normal bg, TM fg, TM bg, outdoor floor]
const TM_FLOOR = 12;
const tmSurfaces = [['--surface', C.bg, C.tmSurface], ['--surface-low', C.surface1, C.tmLow],
                    ['--surface-raised (a TM card)', C.surface2, C.tmRaised],
                    ['--surface-overlay', C.surface3, C.tmOverlay]];
const tmPairs = [['hi', C.textHi, C.textHi], ['mid', C.textMid, C.tmMid], ['lo', C.textLo, C.tmLo]]
  .flatMap(([tier, nFg, tFg]) => tmSurfaces.map(([sName, nBg, tBg]) =>
    [`text-${tier} on ${sName}`, nFg, nBg, tFg, tBg, TM_FLOOR]));

// These MUST FAIL — they encode the rules the system depends on, and a guard that
// starts passing means someone changed a value the rule was protecting.
const guards = [
  // THE INK RULE. `volt` is the one that matters most now — it is the chrome accent, so
  // it is the fill an author is most likely to put a white label on. 1.68:1.
  ['white on volt      (=> use --on-accent ink)', C.textHi, C.volt, 4.5],
  ['white on marigold  (=> use --on-accent ink)', C.textHi, C.marigold, 4.5],
  ['white on mint      (=> use --on-accent ink)', C.textHi, C.mint, 4.5],
  ['white on nepal B   (=> use --on-accent ink)', C.textHi, C.npB, 4.5],
  ['white on CTA stop B(=> use --on-accent ink)', C.textHi, C.ctaB, 4.5],
  // The one the app actually shipped, four times, on delete-confirms. 3.27:1.
  ['white on destructive(=> use --on-accent ink)', C.textHi, C.destructive, 4.5],
  ['--border as text/UI cue (decorative only)', C.border, C.bg, 3],
  // Outline danger button limits: not on surface-3 (use the filled variant), and a 15% hover
  // wash fails on surface-2.
  ['destructive as text on surface-3', C.destructive, C.surface3, 4.5],
  ['destructive ink on a 15% hover wash, s2', C.destructive, C.dangerHover15S2, 4.5],
  // Guards: these must keep FAILING. If one starts passing, something moved and the rule it
  // backs should be revisited on purpose.
  // --border is decorative and must never be a control's edge over the photo.
  ['--border as the door CTA edge (decorative)', C.border, C.npHdrMin, 3],
  // Why the closing CTA keeps its dark ring offset: volt on mint is 1.03:1.
  ['volt ring straight onto mint (no offset)', C.volt, C.mint, 3],
  // The auth panel is separated from the cover by shadow and fill, not contrast.
  ['auth panel fill vs the cover behind it', C.surface2, C.doorWall, 3],
  // Why globals.css gives the wall's dialog --border-ui (D-332): --border vanishes on the cover.
  ['--border as the auth panel edge over the cover', C.border, C.doorWall, 2],
  // Why .passport-page overrides the focus ring to --ink-nepal: volt is invisible on parchment.
  ['volt focus ring on parchment (=> use --ink-nepal)', C.volt, C.paper, 3],
];

// Exact ratios for the brand-family steps, asserted rather than written in a comment where they
// would drift. [label, fg, bg, ratio]. If one fires after a token change, update it from the
// printed value.
const MEASURED_DP = 2;
const measured = [
  ['gold-400 on bg (= marigold)', C.marigold, C.bg, 12.46],
  ['gold-500 on bg (frozen step)', C.gold500, C.bg, 8.94],
  ['gold-600 on bg', C.gold600, C.bg, 6.17],
  ['sakura-300 on bg', C.sakura300, C.bg, 11.81],
  ['sakura-400 on bg (= --jp-a)', C.jpA, C.bg, 9.43],
  ['sakura-500 on bg (frozen step)', C.sakura500, C.bg, 8.37],
  ['sakura-600 on bg (= --lip-pink)', C.sakura600, C.bg, 4.93],
  ['himalaya-400 on bg (= --np-a)', C.npA, C.bg, 8.44],
  ['himalaya-500 on bg (frozen step)', C.himalaya500, C.bg, 6.61],
  ['himalaya-600 on bg', C.himalaya600, C.bg, 5.05],
];

// Mirror check: each pinned hex must still match what globals.css and tailwind.config.ts
// declare, so a token edit that skips this file fails here. Nothing above reads these.
// One channel of tolerance covers HSL triplets rounded to whole numbers in globals.css.
const CHANNEL_TOLERANCE = 1;

/** Custom-property declarations per selector. Innermost blocks only, so an at-rule wrapper
 *  (`@layer base`) contributes its inner `:root` and never its own prelude. */
function declarations(css) {
  const bySelector = new Map();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = m[1].replace(/\s+/g, ' ').trim();
    if (selector === '' || selector.startsWith('@')) continue;
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
      if (!bySelector.has(selector)) bySelector.set(selector, new Map());
      const bag = bySelector.get(selector);
      bag.set(d[1], [...(bag.get(d[1]) ?? []), d[2].trim()]);
    }
  }
  return bySelector;
}

const DECLS = declarations(readFileSync(resolve(APP_ROOT, 'app/globals.css'), 'utf8'));
const TW_SRC = readFileSync(resolve(APP_ROOT, 'tailwind.config.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/** A `family: { step: '#hex' }` entry from the Tailwind theme, or null. */
function twColor(family, step) {
  const fam = TW_SRC.match(new RegExp(`(?:^|[\\s{,])${family}:\\s*\\{([^}]*)\\}`));
  const one = fam?.[1].match(new RegExp(`(?:^|[\\s{,])${step}:\\s*'([^']+)'`));
  return one?.[1] ?? null;
}

/** sRGB channels of an `H S% L%` triplet, or null when the value is not one. */
function hslChannels(value) {
  const m = value.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!m) return null;
  const [h, s, l] = [+m[1], +m[2] / 100, +m[3] / 100];
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor((h % 360) / 60)];
  return [r, g, b].map(v => Math.round((v + l - c / 2) * 255));
}

// Three declaration forms, because globals.css writes the same colour three ways: hex for
// the palette tokens, an HSL triplet for the shadcn keys, and bare RGB channels for the
// --navy-* ramp and its travel-mode override. All three are compared as CHANNELS.
const FORM = {
  hex: v => (/^#[0-9a-f]{6}$/i.test(v) ? ch(v) : null),
  hsl: hslChannels,
  rgb: v => (/^\d+\s+\d+\s+\d+$/.test(v) ? v.split(/\s+/).map(Number) : null),
};

const TM_SCOPE = "html[data-tm-legibility='high']";
// [scope, declaration, pinned key, form]. `scope` is the selector the value must be
// declared on: travel mode re-declares --text-mid and --surface-* with different values,
// so a scope-blind lookup would compare the wrong pair and pass by accident.
const MIRROR = [
  [':root', '--background', 'bg', 'hsl'], [':root', '--navy-900', 'bg', 'rgb'],
  [':root', '--secondary', 'surface1', 'hsl'], [':root', '--navy-850', 'surface1', 'rgb'],
  [':root', '--card', 'surface2', 'hsl'], [':root', '--popover', 'surface2', 'hsl'],
  [':root', '--navy-800', 'surface2', 'rgb'],
  [':root', '--muted', 'surface3', 'hsl'], [':root', '--navy-700', 'surface3', 'rgb'],
  [':root', '--foreground', 'textHi', 'hsl'], [':root', '--text-hi', 'textHi', 'hex'],
  [':root', '--text-mid', 'textMid', 'hex'],
  [':root', '--text-lo', 'textLo', 'hex'], [':root', '--muted-foreground', 'textLo', 'hsl'],
  [':root', '--on-accent', 'onAccent', 'hex'], [':root', '--primary-foreground', 'onAccent', 'hsl'],
  [':root', '--accent-foreground', 'onAccent', 'hsl'],
  [':root', '--primary', 'volt', 'hsl'], [':root', '--accent', 'volt', 'hsl'],
  [':root', '--ring', 'volt', 'hsl'], [':root', '--volt', 'volt', 'hex'],
  [':root', '--destructive', 'destructive', 'hsl'],
  [':root', '--border', 'border', 'hsl'], [':root', '--input', 'border', 'hsl'],
  [':root', '--border-ui', 'borderUI', 'hex'],
  [':root', '--marigold', 'marigold', 'hex'], [':root', '--coral', 'coral', 'hex'],
  [':root', '--mint', 'mint', 'hex'], [':root', '--violet', 'violet', 'hex'],
  [':root', '--pink', 'pink', 'hex'], [':root', '--lip-pink', 'sakura600', 'hex'],
  [':root', '--lip-volt', 'lipVolt', 'hex'],
  [':root', '--cta-a', 'ctaA', 'hex'], [':root', '--cta-b', 'ctaB', 'hex'],
  [':root', '--np-a', 'npA', 'hex'], [':root', '--np-b', 'npB', 'hex'],
  [':root', '--jp-a', 'jpA', 'hex'], [':root', '--jp-b', 'jpB', 'hex'],
  // The three Tailwind family aliases, which say in CSS what tailwind.config.ts says in
  // prose: `gold` IS marigold, `sakura` IS the Japan stop, `himalaya` IS the Nepal stop.
  [':root', '--gold', 'marigold', 'hsl'], [':root', '--sakura', 'jpA', 'hsl'],
  [':root', '--himalaya', 'npA', 'hsl'],
  [':root', '--paper', 'paper', 'hex'], [':root', '--on-paper', 'onPaper', 'hex'],
  [':root', '--paper-mid', 'paperMid', 'hex'], [':root', '--paper-lo', 'paperLo', 'hex'],
  [':root', '--ink-nepal', 'inkNepal', 'hex'], [':root', '--ink-japan', 'inkJapan', 'hex'],
  [':root', '--ink-green', 'inkGreen', 'hex'],
  [':root', '--duo-np-high', 'duoNpHigh', 'hex'], [':root', '--duo-jp-high', 'duoJpHigh', 'hex'],
  [':root', '--duo-np-shadow', 'duoNpShadow', 'hex'],
  [':root', '--scrim-ink', 'scrimInk', 'hex'], [':root', '--scrim-ink-rgb', 'scrimInk', 'rgb'],
  // Travel mode. The four surfaces are that block's "FOUR STEPS, FOUR VALUES" rule and the
  // two inks its "THREE TIERS, THREE VALUES" one; both are hardcoded copies of the base
  // ramp, which is exactly the drift this section exists to catch.
  [TM_SCOPE, '--surface', 'tmSurface', 'rgb'], [TM_SCOPE, '--surface-low', 'tmLow', 'rgb'],
  [TM_SCOPE, '--surface-raised', 'tmRaised', 'rgb'], [TM_SCOPE, '--surface-overlay', 'tmOverlay', 'rgb'],
  [TM_SCOPE, '--text-mid', 'tmMid', 'hex'], [TM_SCOPE, '--text-lo', 'tmLo', 'hex'],
  [TM_SCOPE, '--foreground', 'textHi', 'hsl'], [TM_SCOPE, '--border', 'borderUI', 'hsl'],
];

// tailwind.config.ts is the other half of the mirror: these ten are rendered as text
// (`text-gold-400` and friends), lib/token-auth.ts hashes traveller accents into two of
// them, and the ten published ratios above are measured on exactly these hexes.
const TW_MIRROR = [
  ['gold', 400, 'marigold'], ['gold', 500, 'gold500'], ['gold', 600, 'gold600'],
  ['sakura', 300, 'sakura300'], ['sakura', 400, 'jpA'],
  ['sakura', 500, 'sakura500'], ['sakura', 600, 'sakura600'],
  ['himalaya', 400, 'npA'], ['himalaya', 500, 'himalaya500'], ['himalaya', 600, 'himalaya600'],
];

const mirrorProblems = [];
let mirrored = 0;
for (const [scope, name, key, form] of MIRROR) {
  const declared = DECLS.get(scope)?.get(name);
  const want = ch(C[key]);
  if (!declared) {
    mirrorProblems.push(`${scope} { ${name} } is gone — ${key} ${C[key]} is pinned against a token that no longer exists`);
    continue;
  }
  if (declared.length > 1) {
    mirrorProblems.push(`${scope} { ${name} } is declared ${declared.length} times (${declared.join(' / ')}) — which one is the mirror?`);
    continue;
  }
  const got = FORM[form](declared[0]);
  if (!got) {
    mirrorProblems.push(`${scope} { ${name}: ${declared[0]} } is no longer a ${form} value — ${key} cannot be checked against it`);
    continue;
  }
  const drift = Math.max(...got.map((v, i) => Math.abs(v - want[i])));
  if (drift > CHANNEL_TOLERANCE) {
    mirrorProblems.push(`${scope} { ${name}: ${declared[0]} } renders rgb(${got.join(' ')}) but C.${key} is pinned at ${C[key]} = rgb(${want.join(' ')}) — off by ${drift}/255`);
    continue;
  }
  mirrored++;
}
for (const [family, step, key] of TW_MIRROR) {
  const declared = twColor(family, step);
  if (!declared) {
    mirrorProblems.push(`tailwind.config.ts ${family}-${step} is gone — C.${key} ${C[key]} is pinned against it`);
    continue;
  }
  if (declared.toUpperCase() !== C[key].toUpperCase()) {
    mirrorProblems.push(`tailwind.config.ts ${family}-${step} is ${declared} but C.${key} is pinned at ${C[key]}`);
    continue;
  }
  mirrored++;
}
// FAILS CLOSED. Zero parsed declarations means the file moved or the parser stopped
// matching, at which point every row above passed vacuously — the failure mode a green run
// hides, and the reason this is a count and not a boolean.
if ((DECLS.get(':root')?.size ?? 0) === 0) {
  mirrorProblems.push('no :root custom properties parsed out of app/globals.css — the mirror pass proves nothing');
}

let fail = 0;
console.log('pair'.padEnd(40), 'fg'.padEnd(9), 'bg'.padEnd(9), ' ratio  target  verdict');
for (const [label, fg, bg, target] of pairs) {
  if (target === undefined) { console.log('\n' + label); continue; }
  const r = ratio(fg, bg), ok = r >= target;
  if (!ok) fail++;
  console.log(label.padEnd(40), fg.padEnd(9), bg.padEnd(9),
    r.toFixed(2).padStart(6), '  ', String(target).padEnd(6), ok ? 'PASS' : '*** FAIL ***');
}
console.log('\nguards (each MUST stay below its threshold, proving the rule is load-bearing):');
for (const [label, fg, bg, t] of guards) {
  const r = ratio(fg, bg), ok = r < t;
  if (!ok) fail++;
  console.log(('  ' + label).padEnd(42), r.toFixed(2).padStart(6), ` <${t}  `, ok ? 'guard ok' : 'GUARD BROKEN');
}

console.log(`\ntravel mode, outdoor high legibility (each tier x surface MUST rise AND clear the ${TM_FLOOR}:1 outdoor floor):`);
console.log('  ' + 'pair'.padEnd(38), 'normal', '    high', '  floor   verdict');
for (const [label, nFg, nBg, tFg, tBg, target] of tmPairs) {
  const n = ratio(nFg, nBg), h = ratio(tFg, tBg), ok = h > n && h >= target;
  if (!ok) fail++;
  console.log('  ' + label.padEnd(38), n.toFixed(2).padStart(6), h.toFixed(2).padStart(7),
    '  ', String(target).padEnd(6),
    ok ? `RAISE +${(h - n).toFixed(2)}`
       : h <= n ? '*** FAIL (NOT A RAISE) ***'
       : `*** FAIL (below the ${TM_FLOOR}:1 outdoor floor) ***`);
}
// Assertion 3 — the tiers must stay three values. Neither the raise nor the floor can see a
// collapse: setting all three to #FFFFFF passes both and is exactly the shape of the deleted
// `text-white/*` rule, which flattened every tier onto white@0.92.
{
  const tm = [['hi', C.textHi], ['mid', C.tmMid], ['lo', C.tmLo]];
  const distinct = new Set(tm.map(([, h]) => h.toUpperCase())).size === 3;
  if (!distinct) fail++;
  console.log('  ' + 'the three tiers stay three values'.padEnd(38),
    tm.map(([t, h]) => `${t} ${h}`).join('  '),
    distinct ? '  DISTINCT' : '  *** FAIL (a collapsed tier ramp is the deleted rule\'s shape) ***');
}

console.log('\ncomposited worst-case pixels:');
for (const k of ['npScrim72', 'npScrim82', 'jpScrim72', 'jpScrim82', 'rowHover', 'rowSel', 'chip',
                 'docsRowHover', 'docsNoteFill', 'npHdrMin', 'jpHdrMin', 'npHdrRest', 'jpHdrRest',
                 'plateLay', 'plateLayBand', 'plateChip',
                 'doorWall', 'npScreen14', 'jpScreen14', 'npScreen18',
                 'heroScrim76', 'heroScrim90', 'heroHiFading', 'heroMidFading',
                 'heroCapNp76', 'heroCapJp76',
                 'paperFading', 'inkGreenFading',
                 'dangerHover08Bg', 'dangerHover08S1', 'dangerHover08S2', 'dangerHover15S2'])
  console.log('  ' + k.padEnd(11), C[k]);
console.log('\nhex -> hsl (the form the shadcn tokens in globals.css take):');
for (const k of Object.keys(C)) console.log('  ' + k.padEnd(11), C[k], ' hsl(' + hsl(C[k]) + ')');

console.log(`\npublished ratios (each MUST still measure the number this repo publishes, to ${MEASURED_DP} dp):`);
for (const [label, fg, bg, published] of measured) {
  const r = ratio(fg, bg);
  const ok = r.toFixed(MEASURED_DP) === published.toFixed(MEASURED_DP);
  if (!ok) fail++;
  console.log(('  ' + label).padEnd(42), fg.padEnd(9), r.toFixed(2).padStart(6), ` was ${published.toFixed(2)}  `,
    ok ? 'as published' : '*** FAIL (the published number is stale — republish it) ***');
}

fail += mirrorProblems.length;
console.log(
  `\nmirror identity (every pin above must still be what app/globals.css and tailwind.config.ts declare, +/-${CHANNEL_TOLERANCE}/255):`,
);
if (mirrorProblems.length) for (const p of mirrorProblems) console.log('  *** MIRROR BROKEN *** ' + p);
else console.log(`  ${mirrored} declaration(s) checked across ${DECLS.get(':root').size} :root properties — every mirrored token still matches`);

console.log(fail ? `\n${fail} PROBLEM(S)` : '\nALL PAIRINGS PASS, ALL GUARDS HOLD, THE MIRROR IS INTACT');
process.exit(fail ? 1 : 0);
