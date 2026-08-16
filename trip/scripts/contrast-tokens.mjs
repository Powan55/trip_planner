// Contrast harness for the D-291 / D-292 / D-293 / D-334 token layer. Exits 1 on any failure.
//   npm run contrast-check     (or: node scripts/contrast-tokens.mjs)
//
// WHY THIS EXISTS. Accessibility is an acceptance criterion in this repo, not polish,
// and a palette is the one part of a design system where "it looks fine" and "it
// measures fine" come apart silently. Every hex below is also written into
// app/globals.css and tailwind.config.ts; this file re-derives the ratios from first
// principles (WCAG 2.x relative luminance) so a token edit that breaks a pairing
// fails here with the pair named, instead of on someone's phone in daylight.
//
// It has NO dependencies and reads nothing — it is a pinned mirror of the token
// values, which means IT MUST BE EDITED IN THE SAME COMMIT AS THE TOKENS. That is
// deliberate: a harness that parsed globals.css could only ever prove the file agrees
// with itself, whereas this one makes a value change a two-file decision.
//
// WORST-CASE-PIXEL RULE for text over photography: the duotone grade ends with a
// `mix-blend-mode:darken` layer of --duo-*-high, which caps EVERY channel of EVERY
// pixel at that colour. So the brightest possible pixel under a scrim is
// over(--scrim-ink, --duo-*-high, alpha) — a knowable number, not an average.
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = h => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const ch = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const over = (fg, bg, a) => '#' + ch(fg).map((v, i) =>
  Math.round(v * a + ch(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('');
// The film-grain tile LIGHTENS: `mix-blend-mode:overlay` at opacity .06 over a dark
// base raises every channel (overlay(b,s)=2bs for b<=.5, so a white grain speck is 2b).
// This is the worst case — grain fully white — and it is a real ~0.4-0.6 ratio-point
// tax, which is why it is modelled rather than waved off. Applied even where the
// header ships NO grain layer, so the numbers still hold if one is ever added.
const grain = c => '#' + ch(c).map(v => {
  const b = v / 255, o = b <= 0.5 ? Math.min(1, 2 * b) : 1;
  return Math.round(255 * (b * 0.94 + o * 0.06)).toString(16).padStart(2, '0');
}).join('');
const hsl = h => {
  const [r, g, b] = hex(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let H = 0; if (d) H = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const Li = (mx + mn) / 2, S = d ? d / (1 - Math.abs(2 * Li - 1)) : 0;
  return `${Math.round(H * 60)} ${Math.round(S * 100)}% ${Math.round(Li * 100)}%`;
};

const C = {
  // ---- canvas (D-334: more chromatic and cooler; the base hue barely moved, the
  // saturation went 32% -> 50%, and that lift is what removes the warm cast) ----
  bg: '#0E0920', surface1: '#170F2F', surface2: '#221745', surface3: '#2F2159',
  // D-294: the passport page is PARCHMENT, not the earlier cream #F4EDE0. It is a
  // material scoped to one surface, not a light mode.
  paper: '#DCCDAE',
  // ---- text ----
  textHi: '#FFFFFF', textMid: '#CFC6E0', textLo: '#A79BC0',
  // --paper-lo BINDS FIRST when the page darkens: on the old cream it was #6B5B7E
  // with only 5.27:1 of headroom, and D-294's darker parchment forced it to #524563.
  // Re-measure this one before ever changing --paper again.
  onAccent: '#140F20', onPaper: '#2A2036', paperLo: '#524563',
  // ---- accents. STILL SIX. D-334 retires `sky` #5CD2F5 and puts `volt` in its slot,
  // because the chrome accent must be one of the six rather than a seventh bolted on.
  // The other five keep their hexes — marigold most deliberately of all: it stops being
  // the interaction colour and stays Nepal's gold stop (npB below is the same 24 bits).
  marigold: '#FFC43D', coral: '#FF7A6B', mint: '#4ADE80',
  volt: '#3ED8FF', violet: '#C08CFF', pink: '#FF8FC7',
  // The chrome accent's lip and the primary CTA's gradient stops. The lip is a SHADING
  // (1.96 against its own fill, by design); what it owes is 3:1 against the page field
  // so a button never dissolves at its bottom edge. Both CTA stops must carry the ink
  // ALONE — a gradient fill under text is measured per stop, never averaged.
  lipVolt: '#1C97CC', ctaA: '#6E8BFF', ctaB: '#43E4FF',
  // ---- country gradient stops. BYTE-IDENTICAL ACROSS D-334 and that is the point of
  // it: these are CONTENT wayfinding for a two-country product, the chrome accent is
  // not, and the reason the chrome moved is that marigold was doing both jobs. ----
  npA: '#FF8A3D', npB: '#FFC43D',            // Nepal: orange -> gold
  jpA: '#FF8FC7', jpB: '#C08CFF',            // Japan: pink -> violet
  // ---- borders (D-334: --border-ui's worst case goes 3.72 -> 4.28) ----
  border: '#4A3880', borderUI: '#9184C9',
  // ---- the derived steps of the three Tailwind brand families ----
  // Not part of the ruled palette, but they are rendered as TEXT (`text-gold-400`
  // and friends) and lib/token-auth.ts hashes traveller accents into two of them, so
  // they need a guard like anything else. himalaya600 at 4.96 is the TIGHTEST PAIR
  // IN THE WHOLE HARNESS — 10% over the floor — which is exactly why it is here
  // rather than asserted in a comment.
  gold600: '#C08400', sakura300: '#FFB1D8', himalaya600: '#C2692E',
  // ---- stamp inks on paper (D-294 values, NOT the pre-D-294 #B3123C/#2B4B9B/#0F6E5C) ----
  inkNepal: '#8E0E30', inkJapan: '#223C7C', inkGreen: '#0C5849',
  // ---- duotone highlight caps (the photo engine) ----
  duoNpHigh: '#F5D4AC', duoJpHigh: '#EFC6D6',
  // The duotone SHADOW stop, i.e. the other end of the same grade. Modelled because
  // `.photo-header__duo-lo` is `mix-blend-mode: lighten`, so the grade FLOORS every channel
  // as well as capping it — an EDGE has to survive both ends of that range, not just the
  // bright one a text pairing cares about. See the D-332 pairs below.
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
// ---- issue #27 route 1 (/checklist) — the fills that route's text ACTUALLY sits on ----
// Worked out from the markup rather than assumed: app/checklist/page.tsx is `bg-surface`
// (= --bg) and the section cards are `.glass-subtle`, which fills from --surface-low, i.e.
// SURFACE-1 — one step DOWN from a raised card, so surface-2's numbers would have been the
// wrong reference. Two white tints composite on top of that: the row label's
// `hover:bg-white/[0.06]` and the note input's `bg-white/[0.03]`. The flat pairs (hi/mid/lo
// on --bg and on surface-1) are already asserted above; these are the two the route adds.
C.docsRowHover = over('#FFFFFF', C.surface1, 0.06);
C.docsNoteFill = over('#FFFFFF', C.surface1, 0.03);
// ---- issue #26, the Home hero: text over the PHOTOGRAPH ----------------------------
// The hero used to hold its photo at opacity .45 under TWO stacked overlays; it now paints
// at full strength under ONE ramp, `.hero-scrim`, whose floor is 0.76 (globals.css).
//
// THE WORST-CASE PIXEL IS PURE WHITE, NOT A DUOTONE CAP, AND THAT IS DELIBERATE. The
// duotone tokens above (--duo-*-high) cap every channel of every pixel and would let this
// be measured against #F5D4AC — but the hero has no duotone layer, so that cap does not
// exist on this surface and assuming it would be measuring a photograph that is not there.
// White is the honest bound for an ungraded photo, and it is also the bound for the
// custom-trip vibe gradient, whose stops this repo does not author.
//
// The scrim ramps toward --bg (the page field) rather than --scrim-ink so its last stop IS
// the page below it and the section blends with no seam; that also makes it very slightly
// STRICTER than ramping toward the darker ink, so nothing here is flattered.
C.heroScrim76 = over(C.bg, '#FFFFFF', 0.76); // the ramp's floor — where hero copy sits
C.heroScrim90 = over(C.bg, '#FFFFFF', 0.90); // the ramp's top/bottom, under the navbar
// The entrance reveal runs each hero element from FADE_FLOOR (0.95) to 1, and the axe scan
// runs WITHOUT reduced motion, so it can sample that frame. These are the tiers painted at
// 95% over the floor stop — the darkest frame the reveal can be caught in.
C.heroHiFading = over(C.textHi, C.heroScrim76, 0.95);
C.heroMidFading = over(C.textMid, C.heroScrim76, 0.95);

// ---- issue #5, the passport sheet DURING its entrance -------------------------------
// Same mechanism as the two rows above and the reason it is measured on this page too: a
// wrapper opacity multiplies every descendant's alpha, so <Reveal>'s FADE_FLOOR (0.95) does
// not merely fade the ink — it composites THE WHOLE SHEET, paper included, toward the dark
// page field behind it. Both sides of the pair move, which is why measuring the ink alone
// would be measuring the wrong thing.
//
// The ~3% of headroom this costs is real but small; it is measured rather than waved off
// because the light material is the one surface where a darkening composite works against
// the text instead of for it. The GREEN ink is the tightest of the three (5.34 at rest), so
// it is the one that would bind first if --paper or the floor ever moved.
C.paperFading = over(C.paper, C.bg, 0.95);
C.inkGreenFading = over(C.inkGreen, C.bg, 0.95);

// ---- issue #3, the Tier-2 photographic page header (.photo-header in globals.css) ----
// A Tier-2 header band's HEIGHT is per-route, so bottom-alignment alone is not a
// guarantee — the text block therefore carries its own local scrim (the ruled
// "safer implementation" for headers this spec does not pin). Two ramps stack:
//
//   band scrim  .52 at 0%  ->  .56 at 30%  ->  .86 at 72%  ->  .94 at 90%  -> --bg
//   text floor  0 at 0px   ->  .62 at 68px ->  .78 at 100%  (on .photo-header__body,
//                                              whose padding-top is 92px, so EVERY
//                                              text pixel sits at floor >= .62)
//
// hdrMin is the worst case ANY text pixel in the header can land on: the band scrim at
// its own minimum (.52, i.e. the very top of the band, where no text can actually be)
// under the floor's minimum (.62). hdrRest is where the text really sits. The floor's
// px stops are what make this a number rather than a layout hope: change the 92px
// padding or the 68px stop and this pair stops being the worst case.
const hdr = (cap, scrimA, floorA) => over(C.scrimInk, grain(over(C.scrimInk, cap, scrimA)), floorA);
C.npHdrMin = hdr(C.duoNpHigh, 0.52, 0.62);
C.jpHdrMin = hdr(C.duoJpHigh, 0.52, 0.62);
C.npHdrRest = hdr(C.duoNpHigh, 0.86, 0.78);
C.jpHdrRest = hdr(C.duoJpHigh, 0.86, 0.78);

// The app's own chrome is text over this photograph too. `components/navbar.tsx` is
// fixed and `bg-transparent` until you scroll, so on a full-bleed band the brand, the
// primary links and the MapPin glyph sit on the top 64px of a graded photo. On the band
// ramp alone that measured white/70 at 3.25:1 and --text-lo at 1.84:1, which is why the
// scrim carries a flat top layer across the bar: same .62-over-.52 stack as the text
// floor, so the same composite. The links' /70 is a REAL alpha (Tailwind has a 70 step,
// and the @layer floor only reaches /60), so it is composited rather than assumed solid.
C.navWhite70Np = over(C.textHi, C.npHdrMin, 0.7);
C.navWhite70Jp = over(C.textHi, C.jpHdrMin, 0.7);

// ---- issue #25, the WALL's second view: the auth card sits ON the cover ---------------
// The front door is photographic in both of its views. The landing owns the cover inside the
// wall panel, so it unmounts when a CTA swaps the view; the wall therefore carries its own
// copy of the same graded photo as a sibling of the panel, under the ruled PANEL SCRIM —
// a flat rgba(10,7,20,.72), one ramp and no local floor ramp, because the card floats
// mid-screen instead of sitting in the dark end of a band.
//
// Same worst-case-pixel rule as everything else here: the brightest pixel the duotone grade
// can produce, under .72, with the grain multiplier applied (this layer ships no grain
// either, and the tax is modelled anyway). The cover is Nepal-graded.
//
// .72 is comfortably over the ruled .52 body-text floor, which is the property that makes
// this backdrop safe for whatever the wall puts on it — measured below, not asserted.
C.doorWall = grain(over(C.scrimInk, C.duoNpHigh, 0.72));
// D-332 — the DARK end of the same graded backdrop, same scrim, same grain tax. The auth
// panel's fill sits between this and `doorWall`, which is exactly why a fill can never carry
// a ratio here (it hits 1.00:1 somewhere on the photograph), and why the card is held by its
// edge instead. The edge is measured against both ends below.
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
  // The subtitle is authored text-ink-MID, not the text-ink-lo the flat header used.
  // These two are measured anyway because lo is the TIGHTEST pair in the whole header
  // (~11% of headroom against mid's ~76%), so it is the one that would bind first if
  // the scrim or the floor is ever lightened. It still clears AA — the subtitle moved
  // for the role rule (a subtitle qualifies the title, so it is mid), not to fix a fail.
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
  // /map's page accent was --sky, so it MECHANICALLY inherited --volt when that slot was
  // re-valued — making /map the one route whose identity accent was the chrome accent,
  // which page-hero.tsx's own rule forbids. Resolved to --marigold rather than left for
  // the /map palette slice, because the collision was introduced by D-334 and should not
  // outlive the commit that caused it.
  //
  // MARIGOLD IS GENUINELY FREE, and that is the whole argument: it had exactly two roles,
  // primary action (now --volt's) and Nepal. Nepal's identity is carried by --np-a/--np-b/
  // --grad-nepal, which are their own tokens — --np-b merely SHARES marigold's hex, it is
  // not this token. So handing /map --marigold does not re-double-book the way D-334 just
  // un-double-booked the accent. What /map's palette slice still owes is the map PINS
  // (D-292), which is a different question from the header eyebrow.
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

  ['-- THE FRONT DOOR, ISSUE #25 --'],
  // The cover and the two chapters REUSE `.photo-header` unchanged, so their scrim composites
  // ARE npHdrMin / jpHdrMin above and nothing about the ramp is re-derived here. What is new is
  // the set of FOREGROUNDS the front door puts on them, and that is what this block measures.
  // The cover is Nepal-graded, chapter 01 Nepal, chapter 02 Japan.
  // The eyebrow, the join link and the step numerals are all `text-primary` in
  // landing-page.tsx, i.e. the CHROME ACCENT — so they moved with it under D-334 and
  // are measured as volt. The two chapter NUMERALS are not: they are `var(--marigold)`
  // / `var(--pink)`, the country stops, and they stay put.
  ['door eyebrow (volt) on the NP cover', C.volt, C.npHdrMin, 4.5],
  ['door headline (hi) on the NP cover', C.textHi, C.npHdrMin, 4.5],
  ['door lead + join note (mid) on the NP cover', C.textMid, C.npHdrMin, 4.5],
  // The secondary CTA over a photograph is an outline and nothing else, so its EDGE is the only
  // thing separating a control from the picture — 1.4.11's 3:1, over the graded worst case. This
  // is why it is --border-ui and not --border: --border measures 1.31:1 here and would be a
  // button with no visible boundary on the loudest surface in the product.
  ['door ghost CTA edge (border-ui) on the cover', C.borderUI, C.npHdrMin, 3],
  ['door join link (volt) on the NP cover', C.volt, C.npHdrMin, 4.5],
  // The chapter numerals are Instrument Serif at the editorial-lg step (>=2.4rem), i.e. LARGE
  // text, so 3:1 — measured over each chapter's own grade rather than borrowing the other's.
  ['chapter 01 numeral (marigold) on NP', C.marigold, C.npHdrMin, 3],
  ['chapter 02 numeral (pink) on JP', C.pink, C.jpHdrMin, 3],
  ['chapter title (hi) on JP', C.textHi, C.jpHdrMin, 4.5],
  ['chapter body (mid) on JP', C.textMid, C.jpHdrMin, 4.5],
  // The three colour blocks. All four gradient stops carry the ink and are measured above; the
  // celebration gradient is jp-a -> np-b, i.e. two stops that are already there under other
  // names, so it adds no new pair. The closing block is the flat mint fill, and its button
  // INVERTS — the ink becomes the fill and marigold becomes the label.
  ['closing block ink on mint', C.onAccent, C.mint, 4.5],
  ['inverted CTA label (volt) on ink', C.volt, C.onAccent, 4.5],
  // The inverted button's FOCUS INDICATOR, both halves of it. The ring is the chrome accent and
  // the 2px offset gap is --surface, so what a keyboard user sees is ring-on-gap and gap-on-block.
  // Both are measured because 1.4.11 asks about the indicator against what surrounds it, and the
  // surround here is a saturated fill rather than the page.
  ['closing CTA focus ring vs its offset gap', C.volt, C.bg, 3],
  ['closing CTA offset gap vs the mint block', C.bg, C.mint, 3],
  // The wall's second view — the auth card, Tier 3, on the opaque surface-2 panel. The field
  // fill is surface-3 and its EDGE is the interactive boundary token (both measured under
  // 1.4.11 above); these are the text tiers and the one error colour on those fills.
  ['auth field value (hi) on surface-3', C.textHi, C.surface3, 4.5],
  ['auth field placeholder (lo) on surface-3', C.textLo, C.surface3, 4.5],
  ['auth error (coral) on the panel', C.coral, C.surface2, 4.5],
  // ...and what that panel now floats ON. The wall keeps the cover mounted behind the auth
  // card under the ruled .72 panel scrim, so the second view has photography too. The panel
  // fill is OPAQUE surface-2, so none of the three rows above moved — these two are the
  // surface itself, measured at the two tiers the front door is allowed to put on a
  // photograph (the floor tier is a guard below, not a pairing).
  ['white over the cover at the panel scrim .72', C.textHi, C.doorWall, 4.5],
  ['text-mid over the cover at the panel scrim .72', C.textMid, C.doorWall, 4.5],
  // D-332. The auth panel's own edge, at BOTH ends of the graded backdrop. The `2` at the
  // bright end is the RULED FLOOR FOR THIS CONTAINER EDGE, not a WCAG number: 3 is
  // unreachable there for anything that is not a text tier or the focus ring (only --text-lo
  // at 3.58, --volt at 5.52 and --marigold at 5.85 clear it, and none may be spent on a
  // resting border),
  // and a harness that pretends otherwise is a harness that has started lying. The fill guard
  // further down proves why the edge has to carry this rather than the fill.
  ['auth panel edge (border-ui) on the cover, brightest', C.borderUI, C.doorWall, 2],
  ['auth panel edge (border-ui) on the cover, darkest', C.borderUI, C.doorWallLo, 3],

  ['-- THE HOME HERO, ISSUE #26 (one scrim, floor .76, worst pixel = pure white) --'],
  ['hero title (hi) at the scrim floor', C.textHi, C.heroScrim76, 4.5],
  ['hero copy (mid) at the scrim floor', C.textMid, C.heroScrim76, 4.5],
  ['hero title (hi), darkest reveal frame', C.heroHiFading, C.heroScrim76, 4.5],
  ['hero copy (mid), darkest reveal frame', C.heroMidFading, C.heroScrim76, 4.5],
  ['hero mark (lo) at the floor, 3:1 only', C.textLo, C.heroScrim76, 3],
  ['hero copy (mid) at the ramp top .90', C.textMid, C.heroScrim90, 4.5],
  ['countdown value (hi) on a cell', C.textHi, C.surface2, 4.5],
  ['countdown label (lo) on a cell', C.textLo, C.surface2, 4.5],
  ['live cell digits, japan stop A', C.jpA, C.surface2, 4.5],
  ['live cell digits, japan stop B', C.jpB, C.surface2, 4.5],
  ['live cell edge (jp-a), 1.4.11 3:1', C.jpA, C.surface2, 3],
  ['stat value (hi) on a stat cell', C.textHi, C.surface1, 4.5],
  ['stat caption (lo) on a stat cell', C.textLo, C.surface1, 4.5],

  ['-- PASSPORT PARCHMENT (a light material inside the dark app, D-294) --'],
  ['on-paper ink on paper', C.onPaper, C.paper, 4.5],
  ['paper-lo on paper', C.paperLo, C.paper, 4.5],
  ['nepal stamp ink on paper', C.inkNepal, C.paper, 4.5],
  ['japan stamp ink on paper', C.inkJapan, C.paper, 4.5],
  ['green stamp ink on paper', C.inkGreen, C.paper, 4.5],
  // Issue #5 gives the block above its first consumers (/passport). What the page ADDS is the
  // REVERSED pairing — the "New" badge is a solid ink pill with the page colour as its label —
  // and the stamp's ring, which is a non-text edge. Contrast is symmetric, so each badge row is
  // the same number as its ink row above; they are listed anyway because a pairing that is only
  // true by an unstated symmetry is the kind that gets broken by "let me lighten the badge text".
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
  ['--border as text/UI cue (decorative only)', C.border, C.bg, 3],
  // Issue #26. The hero's rule is "no floor-tier TEXT over the photograph", and this is
  // what makes it load-bearing instead of a comment: --text-lo is 3.55:1 at the scrim
  // floor, fine for a decorative mark and NOT fine for a word. If this guard ever starts
  // passing, the scrim got darker and hero copy can be re-tiered — which is a decision
  // somebody should make on purpose, having seen this line flip.
  ['--text-lo as hero copy over the photo', C.textLo, C.heroScrim76, 4.5],
  // Issue #25. The front door reuses the header ramp, so the floor tier DOES clear AA over the
  // cover — but the ghost CTA's edge is the pair that would bind first if that ramp is ever
  // lightened, and --border is what an author reaches for when they do not know that. Measured
  // at 1.31:1 on the graded worst case: it is a decorative wash and it may never be the edge of
  // a control sitting on a photograph. If this starts passing, the scrim got darker and somebody
  // should decide that on purpose, having seen this line flip.
  ['--border as the door CTA edge (decorative)', C.border, C.npHdrMin, 3],
  // Issue #25. The closing CTA's ring offset is --surface and it looks like an inconsistency
  // sitting on a mint block, so somebody will eventually "fix" it to match. This is the number
  // that fix produces: the chrome-accent focus ring directly on mint, 1.03:1, i.e. no focus ring
  // at all on the loudest button on the front door. It got WORSE under D-334, not better —
  // volt and mint are closer in luminance than marigold and mint were.
  ['volt ring straight onto mint (no offset)', C.volt, C.mint, 3],
  // Issue #25, the wall's second view. Two rules about the cover behind the auth card, each
  // stated as the number that would have to move for it to stop being true.
  //
  // (1) The floor tier is not text over this photograph. --text-lo measures 3.58 on the .72
  // panel scrim: fine for a decorative mark, not fine for a word. It is the same rule the
  // hero's guard above carries, on the other photographic surface, and nothing renders in
  // that tier over either of them today — this is what keeps it that way.
  ['--text-lo as copy over the wall cover', C.textLo, C.doorWall, 4.5],
  // (2) The auth panel is separated from the picture by DEPTH, not by contrast: an opaque
  // surface-2 fill measures 1.74:1 against the graded worst-case pixel behind it, and its
  // --border hairline is decorative like every other one in the app (the `--border as the
  // door CTA edge` guard above says so on the cover's own composite, at 1.34). What draws
  // the card is the elevated shadow plus that fill step — the F-8 finding recorded against
  // D-291, that a border and a shadow are what separate a surface here, not a ratio. The
  // panel is a container and not a control, so 1.4.11 does not bite; the controls inside it
  // are all on opaque fills and are measured above. If this ever starts passing, the scrim
  // or the surface ramp moved and somebody should decide that on purpose.
  ['auth panel fill vs the cover behind it', C.surface2, C.doorWall, 3],
  // (2b) D-332, and the reason (2) above is now proven rather than argued. `--border` is what
  // `.glass-card-dark` draws with, and on this cover it measures 1.04:1 — an edge that is not
  // merely decorative but INVISIBLE wherever the card crosses the photograph's highlights.
  // That is the F-8 failure mode (separated by shadow alone) arriving on the one surface F-8
  // was written about. globals.css therefore steps the wall's dialog to --border-ui, and this
  // guard is what makes that override load-bearing: if it ever starts passing, --border or the
  // scrim moved and the override may no longer be needed — decide that on purpose.
  ['--border as the auth panel edge over the cover', C.border, C.doorWall, 2],
  // Issue #5 / D-294. The app-wide :focus-visible fallback is the chrome accent, an ~11.6:1
  // signal on the near-black canvas and nothing at all on parchment — a light material dropped
  // into a dark-only app inherits chrome that was measured against a different surface.
  // globals.css therefore overrides the ring to --ink-nepal inside `.passport-page`, and this is
  // what makes that override load-bearing rather than a preference: if this guard ever starts
  // passing, the accent became legible on the page and somebody should decide that on purpose.
  // D-334 moved the ring marigold -> volt and this guard held at 1.07 (it was 1.31), so the
  // override is MORE necessary now, not less.
  ['volt focus ring on parchment (=> use --ink-nepal)', C.volt, C.paper, 3],
];

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

console.log('\ncomposited worst-case pixels:');
for (const k of ['npScrim72', 'npScrim82', 'jpScrim72', 'jpScrim82', 'rowHover', 'rowSel', 'chip',
                 'docsRowHover', 'docsNoteFill', 'npHdrMin', 'jpHdrMin', 'npHdrRest', 'jpHdrRest',
                 'doorWall',
                 'heroScrim76', 'heroScrim90', 'heroHiFading', 'heroMidFading',
                 'paperFading', 'inkGreenFading'])
  console.log('  ' + k.padEnd(11), C[k]);
console.log('\nhex -> hsl (the form the shadcn tokens in globals.css take):');
for (const k of Object.keys(C)) console.log('  ' + k.padEnd(11), C[k], ' hsl(' + hsl(C[k]) + ')');
console.log(fail ? `\n${fail} PROBLEM(S)` : '\nALL PAIRINGS PASS, ALL GUARDS HOLD');
process.exit(fail ? 1 : 0);
