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
// It has NO dependencies, and every ratio it prints is derived from a pinned mirror of
// the token values, which means IT MUST BE EDITED IN THE SAME COMMIT AS THE TOKENS. That
// is deliberate: a harness that DERIVED its ratios from globals.css could only ever prove
// the file agrees with itself, whereas this one makes a value change a two-file decision.
//
// The accuracy of the mirror is the one thing that stance cannot check, so the tail of this
// file now does exactly that and nothing more (see THE MIRROR IS NOW CHECKED, below): it
// reads globals.css and tailwind.config.ts and asserts each mirrored key still declares the
// pinned value. No ratio is derived from what it reads, and nothing else in here parses.
//
// WORST-CASE-PIXEL RULE for text over photography: the duotone grade ends with a
// `mix-blend-mode:darken` layer of --duo-*-high, which caps EVERY channel of EVERY
// pixel at that colour. So the brightest possible pixel under a scrim is
// over(--scrim-ink, --duo-*-high, alpha) — a knowable number, not an average.
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
// The film-grain tile LIGHTENS: `mix-blend-mode:overlay` at opacity .06 over a dark
// base raises every channel (overlay(b,s)=2bs for b<=.5, so a white grain speck is 2b).
// This is the worst case — grain fully white — and it is a real ~0.4-0.6 ratio-point
// tax, which is why it is modelled rather than waved off. Applied even where the
// header ships NO grain layer, so the numbers still hold if one is ever added.
const grain = c => '#' + ch(c).map(v => {
  const b = v / 255, o = b <= 0.5 ? Math.min(1, 2 * b) : 1;
  return Math.round(255 * (b * 0.94 + o * 0.06)).toString(16).padStart(2, '0');
}).join('');
// ONE DECIMAL, NOT ZERO, and it is not tidiness: `#0A0818` rounds to `248 50% 6%`, which
// renders rgb(10 8 23) — a blue channel off by one from the hex it claims to be. globals.css
// declares the same four colours twice (HSL for the shadcn keys, RGB channels for --navy-*),
// so a triplet that does not round-trip makes the two copies disagree by construction.
// `+x.toFixed(1)` drops a trailing .0, so a value that never needed the decimal is unchanged.
const hsl = h => {
  const [r, g, b] = hex(h); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let H = 0; if (d) H = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  const Li = (mx + mn) / 2, S = d ? d / (1 - Math.abs(2 * Li - 1)) : 0;
  return `${+(H * 60).toFixed(1)} ${+(S * 100).toFixed(1)}% ${+(Li * 100).toFixed(1)}%`;
};

const C = {
  // ---- canvas. RE-CAST: the field cools and the floor drops. The shipped ramp was one
  // hue at four lightnesses (253/255/254/255), so depth was signalled by brightness alone
  // and every surface read as the same wash — which is also why a Nepal panel and a Japan
  // panel came out the same plum and the country channels did no visible work. Now the
  // floor goes 253 -> 248 and the rise cools with it (247/244/243); warmth arrives only as
  // screened country tint on top (the SCREENED TINT block below). It stops at 243-248
  // rather than rotating to blue because a generic dark-blue product shell is an anti-goal.
  bg: '#0A0818', surface1: '#141033', surface2: '#1C1948', surface3: '#26235C',
  // D-294: the passport page is PARCHMENT, not the earlier cream #F4EDE0. It is a
  // material scoped to one surface, not a light mode.
  paper: '#DCCDAE',
  // ---- text ----
  textHi: '#FFFFFF', textMid: '#CFC6E0', textLo: '#A79BC0',
  // --paper-lo BINDS FIRST when the page darkens: on the old cream it was #6B5B7E
  // with only 5.27:1 of headroom, and D-294's darker parchment forced it to #524563.
  // Re-measure this one before ever changing --paper again.
  // THREE PAPER INKS, not two. The dark ramp has hi/mid/lo, so a two-ink paper block could
  // not carry the component recipes and /passport painted with the stamp inks instead.
  // paperMid is the sRGB midpoint of the other two; globals.css scopes all three onto
  // --text-hi/-mid/-lo inside `.passport-page`.
  onAccent: '#140F20', onPaper: '#2A2036', paperMid: '#3E334D', paperLo: '#524563',
  // --destructive #EF5D66 (hsl 356 82% 65%). It was NOT modelled here, which is how four
  // delete-confirms shipped `bg-rose-500 text-white` — an off-palette fill at 3.27:1 — and
  // how the ink rule's own worked example stayed an unmeasured number in a comment.
  destructive: '#EF5D66',
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
  // ---- borders (--border-ui's worst case is 4.30, on --surface-3) ----
  border: '#4A3880', borderUI: '#9184C9',
  // ---- the derived steps of the three Tailwind brand families ----
  // Not part of the ruled palette, but they are rendered as TEXT (`text-gold-400`
  // and friends) and lib/token-auth.ts hashes traveller accents into two of them, so
  // they need a guard like anything else. himalaya600 at 5.05 is the tightest of the SOLID
  // pairs (12% over the floor; only the two screened tints below sit closer), which is
  // exactly why it is here rather than asserted in a comment.
  // ALL NINE STEPS ARE HERE NOW, not the three that happened to be needed: the family's ten
  // ratios were published as MEASURED in a comment in tailwind.config.ts, and all ten were
  // stale by exactly one field re-cast — they reproduce against the retired #0E0920 and not
  // against the field the app paints. A number nothing runs drifts silently, so those ten
  // live in the PUBLISHED RATIOS table below instead, and the comment that carried them is
  // gone. The 400s are deliberately absent from this block: they ARE marigold, --jp-a and
  // --np-a to the bit, and a fourth copy of a hex is the drift this file exists to catch
  // (the mirror pass at the tail asserts that identity against tailwind.config.ts).
  gold500: '#d4a843', gold600: '#C08400',
  sakura300: '#FFB1D8', sakura500: '#e88fa2', sakura600: '#C25C90',
  himalaya500: '#e67635', himalaya600: '#C2692E',
  // ---- stamp inks on paper (D-294 values, NOT the pre-D-294 #B3123C/#2B4B9B/#0F6E5C) ----
  inkNepal: '#8E0E30', inkJapan: '#223C7C', inkGreen: '#0C5849',
  // ---- TRAVEL MODE, outdoor high-legibility (`html[data-tm-legibility='high']`) ----
  // The one mode built for direct sunlight on a screen, and until now the ONE ramp this
  // harness did not model — which is how it stayed green while the feature was dead. The
  // block re-values the four SEMANTIC surface names one step darker (--surface takes a new
  // deepest step BELOW --bg), so a TM card fills from tmRaised, not surface2. These eight
  // hexes are a mirror of that block; edit both or /travel silently drifts.
  // The deepest step KEEPS its shipped #070510: the relationship TM[i] == normal[i-1]
  // carries the re-cast on its own, so no new outdoor value is derived. The pair that binds
  // first if the field is ever deepened again is `text-hi on TM --surface` — deepening
  // raises normal-mode contrast faster than TM's, so the outdoor advantage narrows.
  tmSurface: '#070510', tmLow: '#0A0818', tmRaised: '#141033', tmOverlay: '#1C1948',
  // The tiers move WITH it. They did not before: issue #27's sweep put TM's body copy on
  // fixed hexes, which the surface ramp cannot lift, and the `[class*='text-white/']`
  // catch-all that used to raise them stopped matching anything. --text-hi is #FFFFFF in
  // both modes; only mid and lo need an override, and they stay three DISTINCT values
  // (same hue 258) rather than flattening onto one the way the deleted rule did.
  tmMid: '#F2EFF9', tmLo: '#E9E4F5',
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
// ---- THE SCREENED COUNTRY TINT, and the ceiling is measured post-grain --------------
// `color-mix(in srgb, var(--np-a) 14%, var(--surface-2))`. This is the only place warmth
// touches the cool field, and --text-lo is the pair that binds.
//
// 14% FOR BOTH CHANNELS, and the reason the tempting 18% is wrong is the whole lesson here:
// measured against the raw color-mix RESULT, npA at 18% reads 4.71 and looks legal. That is
// not what renders. Anything composited over a screened tint moves the pair that binds, and
// this app paints a film-grain tile (mix-blend-mode:overlay at .06) which LIGHTENS a dark
// ground ~6% — worth ~0.2 of ratio under light text. Through grain() the same 18% is 4.48
// and under the floor, which is what the guard below pins. Precision applied to the wrong
// quantity is more dangerous than a rough number, because it carries false authority.
//
// JAPAN CANNOT BUY HEADROOM BY SWAPPING CHANNELS. The field sits at hue 244 and jp-b
// #C08CFF is 13 deg away, so a jp-b screen rotates the surface by 7 deg and does no visible
// work; jp-a moves it 19 deg and reads. So Japan is forced onto the channel with less room.
C.npScreen14 = grain(over(C.npA, C.surface2, 0.14));
C.jpScreen14 = grain(over(C.jpA, C.surface2, 0.14));
C.npScreen18 = grain(over(C.npA, C.surface2, 0.18));
// ---- issue #27 route 1 (/checklist) — the fills that route's text ACTUALLY sits on ----
// Worked out from the markup rather than assumed: app/checklist/page.tsx is `bg-surface`
// (= --bg) and the section cards fill from --surface-low, i.e.
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
// THE WORST-CASE PIXEL IS STILL PURE WHITE, AND THAT IS STILL DELIBERATE — but the reason
// changed with issue #89 and this paragraph is the one that has to say so. The photograph
// branch NOW carries a --duo-*-high darken cap (`.hero-cap`, modelled ~20 lines below), so
// on THAT branch the brightest pixel really is the cap. The scrim, however, also covers the
// two branches that have NO cap and no photograph: the custom-trip vibe gradient (whose
// stops this repo does not author) and the SVG fallback art. White is the bound that holds
// for all three, so the ramp is sized by it and the cap is only ever headroom.
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
// ---- issue #89: the hero photograph now carries a highlight cap ---------------------
// `.hero-cap` is one `mix-blend-mode: darken` div of --duo-*-high over the raster (and
// ONLY over the raster — see below). Darken keeps the darker of the two per channel, so
// every channel of every photo pixel is clamped at the cap and the brightest pixel the
// scrim can sit on stops being white. Same engine as `.photo-header`, minus its
// `filter: grayscale(1)` opening — greyscaling Home would spend the Tier-1 photographic
// privilege D-292 grants it.
//
// The cap FOLLOWS THE LEG, exactly as the photograph does, so both are modelled: the
// Himalaya frame takes --duo-np-high, the Shinjuku frame --duo-jp-high.
//
// THE WHITE PAIRS ABOVE STAY, AND ARE STILL THE RULE. Two of the hero's three backdrop
// branches have no cap because they have no photograph — a custom trip's vibe gradient
// (D8, stops this repo does not author) and the SVG fallback art when the raster fails.
// The scrim is sized by the branch with the least protection; these rows only record the
// headroom the graded branch gains, and NOTHING may be re-tiered off them.
C.heroCapNp76 = over(C.bg, C.duoNpHigh, 0.76);
C.heroCapJp76 = over(C.bg, C.duoJpHigh, 0.76);

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

// ---- `.btn--2.btn--danger`'s hover wash, on each ground it can sit on ------------------
// The outline danger button tints itself with its OWN ink on hover, so both sides of the
// pair move together and the token pairing is not the rendered one. The three bundles that
// hand-rolled this button used 15%, which measures 4.17 on --surface-2 — under the floor on
// a surface these buttons do sit on. 8% is what holds on every ground the shape is legal on.
C.dangerHover08Bg = over(C.destructive, C.bg, 0.08);
C.dangerHover08S1 = over(C.destructive, C.surface1, 0.08);
C.dangerHover08S2 = over(C.destructive, C.surface2, 0.08);
C.dangerHover15S2 = over(C.destructive, C.surface2, 0.15);

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

// ---- issue #373, the photographic plate (.plate in globals.css) --------------------
// `.plate .ramp` spans BOTH grid rows, so the alpha under the caption is decided by where
// row 2 starts. The stops used to be fixed percentages authored for ONE split while the
// recipe shipped two, which put the 42% modifiers at 0.307 instead of 0.753. They are now
// OFFSETS FROM `--plate-split`, so the two stops bracketing the row line are always 0.69 at
// split-4% and 0.88 at split+8% and the line always lands 4/12 of the way between them:
//   .plate                      56% -> stops 34/52/64/80 -> 0.69 + (4/12) * 0.19 = 0.753
//   .plate--band / .plate--wide 42% -> stops 20/38/50/66 -> 0.69 + (4/12) * 0.19 = 0.753
// Both rows below therefore measure the same composite BY CONSTRUCTION, and they are both
// kept because that is the property being asserted — a stop that stopped tracking the split
// would move one of them and not the other.
// The row TOP is the highest any glyph can sit and `.lay` is flex-end, whose overflow
// goes upward out of the row — so these are the best case for the pairs below, not a
// pessimistic one. There is no duotone cap on `.plate` (the caps are `.photo-header__duo-*`
// and the halftone screen is transparent between its dots), so the brightest pixel under
// the ramp is white — the same bound the hero scrim is sized by.
const plateRamp = a => grain(over(C.scrimInk, '#FFFFFF', a));
const PLATE_ROW_TOP = 0.69 + (4 / 12) * (0.88 - 0.69);
C.plateLay = plateRamp(PLATE_ROW_TOP);
C.plateLayBand = plateRamp(PLATE_ROW_TOP);
// The country chip is the one caption element the ramp cannot cover, and it failed at the
// DEFAULT split too (np-a 3.81, jp-a 4.26) — `.chip` sets no fill, so the stop landed on the
// ramp itself. globals.css gives `.plate .chip` the rgb(--surface / .82) ground that
// components/added-badge.tsx already uses for a chip over photography. THE GROUND IS
// MEASURED ON BARE WHITE, not on the ramp: the chip is `self-start` at the top of a flex-end
// column, so it is the one element that can be pushed clear of the ramp (#376's failure
// mode), and a backing measured that way holds at either split and off the ramp entirely.
C.plateChip = grain(over(C.bg, '#FFFFFF', 0.82));

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
  // Issue #89. The SAME pairings over the CAPPED photograph. Every one of them is a strict
  // improvement on the white bound above (hi 9.22 -> 10.60/10.84, mid 5.62 -> 6.46/6.61)
  // because darken can only ever remove light. Listed so the improvement is a measured
  // number rather than an assumption.
  //
  // THESE FOUR CANNOT FAIL ON A CAP RE-VALUE, AND CLAIMING THEY COULD WOULD BE THE USUAL
  // LIE. Lightening --duo-*-high walks them back toward the pure-white limit measured
  // above — 9.22 hi / 5.62 mid — which still clears 4.5; darkening it only improves them.
  // So they bind on --text-hi/--text-mid moving, not on the cap. The lines that DO fire on
  // a cap re-value are the two guards below, and they fire on DARKENING.
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

// ---- TRAVEL MODE HIGH LEGIBILITY (the one ramp nothing measured) ----------------------
// `html[data-tm-legibility='high']` promises, in its own comment, "a monotonic contrast
// RAISE only, never a lowering, at every site it touches". Nothing measured that, and it
// quietly stopped being true: issue #27's sweep moved TM's body copy onto fixed-hex tiers,
// the `[class*='text-white/']` catch-all that used to raise them stopped matching anything,
// and the tiers were left riding the surface ramp alone (text-lo on a TM card: 15.47 ->
// 7.03). AA passed at every site throughout, which is precisely why an AA-floor assertion
// could not have caught it — an outdoor mode that is merely AA has lost the thing it is for.
//
// TWO ASSERTIONS PER ROW, AND THE SECOND ONE IS THE LOAD-BEARING ONE. Each row is one tier
// on one SEMANTIC surface name; both sides move between the modes (the tier hex AND the
// surface that name resolves to), which is what makes the pairing the right unit.
//
//   1. THE RAISE. TM-high > normal, strictly, at every pairing. This is the block's own
//      stated promise — and ON ITS OWN IT IS NOT ENOUGH, which was measured rather than
//      assumed: with the tiers left at their normal hexes (i.e. the exact defect being
//      fixed here) every pairing still "rises", by 0.29-1.40, purely because the surface
//      ramp darkens one step under them. A check that shipped with only this in it would
//      have been green on the broken tree and this comment would be a lie.
//
//   2. THE OUTDOOR FLOOR, 12:1, and it is deliberately NOT 4.5. TM exists to be readable
//      with the sun on the screen; the number it has to hold is a headroom number, not a
//      legality number. 12 is calibrated against the two real reference points rather than
//      picked: the deleted `text-white/*` rule's OWN WORST pairing was 14.02 (white@0.92 on
//      --surface-overlay) and the tier overrides that replace it bottom out at 13.17. So 12
//      sits below everything TM has ever actually delivered, with 1.17 of room for a re-tune
//      — 13 would leave 0.17 and go red on any nudge.
//      BE PRECISE ABOUT WHAT IT CATCHES, because the tempting sentence here is false: 12 is
//      NOT far above what the surface ramp reaches on its own. The defect state fires 7 of
//      these 12 rows and every `lo` row, but its own ceiling is 12.34 (text-mid on
//      --surface), which CLEARS 12 by 0.34. The floor is sized to catch the ramp that broke,
//      not to be unreachable. If a future retune genuinely cannot hold 12, that is a decision
//      to make on purpose, having watched this line go red.
//
//   3. TIER DISTINCTNESS, asserted separately below. The raise and the floor are both
//      satisfied by setting all three tiers to #FFFFFF — which is the deleted rule's exact
//      shape, the tier system collapsing in outdoor mode. Measured: without this assertion a
//      flattened ramp exits 0. So the three TM tier hexes must differ from each other.
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
  // THE OUTLINE DANGER BUTTON'S TWO CEILINGS, both stated as the number that would have to
  // move. (1) --destructive as text on --surface-3 is 4.35 — the shape is legal on bg /
  // surface-1 / surface-2 and not below, and the fix if it is ever wanted there is the
  // FILLED variant, not a lighter ink. (2) The 15% hover wash three bundles hand-rolled
  // reads 4.17 on --surface-2, which is why the recipe screens at 8%. A reader who finds
  // 15% in git history will reach for it; this is what it measures.
  ['destructive as text on surface-3', C.destructive, C.surface3, 4.5],
  ['destructive ink on a 15% hover wash, s2', C.destructive, C.dangerHover15S2, 4.5],
  // THE 18% SCREEN. A reader who finds `npMaxUngrained: 0.18` written down will reach for it,
  // because it is the more precise-looking number and Nepal genuinely has 4 points of headroom
  // against the raw color-mix. This is what it measures once the grain lands: 4.48, under the
  // floor. 18% is legal ONLY on a surface proven to carry nothing composited over it — prove
  // it, never assume it. If this guard starts passing, the grain or --text-lo moved.
  ['np-a screened at 18% under --text-lo', C.textLo, C.npScreen18, 4.5],
  // Issue #26. The hero's rule is "no floor-tier TEXT over the photograph", and this is
  // what makes it load-bearing instead of a comment: --text-lo is 3.55:1 at the scrim
  // floor, fine for a decorative mark and NOT fine for a word. If this guard ever starts
  // passing, the scrim got darker and hero copy can be re-tiered — which is a decision
  // somebody should make on purpose, having seen this line flip.
  ['--text-lo as hero copy over the photo', C.textLo, C.heroScrim76, 4.5],
  // Issue #89. THE CAP DOES NOT UNLOCK THE FLOOR TIER, and this is the line that proves it
  // rather than asserting it. The `.hero-cap` darken layer lifts the floor tier from 3.55
  // to 4.08 (NP) / 4.18 (JP) — a real gain, and still short of 4.5. Somebody reading the
  // capped rows above will reasonably wonder whether hero copy can now drop a tier; the
  // answer is no, on both legs, and these two guards keep answering it after the comment
  // above has been skimmed past.
  //
  // AND THESE ARE THE TWO LINES THAT CAN ACTUALLY FIRE, unlike the four capped pairings up
  // in `pairs`. A guard trips when its pair starts PASSING, and --text-lo clears 4.5 over
  // this composite only once the composite gets DARKER — i.e. on darkening --duo-*-high
  // (or the page field it composites over). That is precisely the direction in which a
  // floor-tier re-tier would become defensible, so it should be a decision somebody makes
  // having watched this line flip, not a side effect of a palette tweak.
  ['--text-lo as hero copy over the capped photo, NP', C.textLo, C.heroCapNp76, 4.5],
  ['--text-lo as hero copy over the capped photo, JP', C.textLo, C.heroCapJp76, 4.5],
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

// ---- PUBLISHED RATIOS, ASSERTED RATHER THAN WRITTEN DOWN ----------------------------
// [label, fg, bg, published ratio]. Every pairing above asserts a FLOOR ("at least 4.5");
// these ten assert the NUMBER, which is a different obligation. tailwind.config.ts used to
// publish them in a comment marked MEASURED, and all ten were stale by exactly one field
// re-cast: each reproduces to two decimals against the retired #0E0920 and not against the
// #0A0818 the app paints. Every error was in the conservative direction — the real ratios
// are higher — so it was a documentation defect and nothing was ever failing.
//
// They are recomputed here from the same first principles as everything else in this file,
// which is the whole point: a number in a comment has no runner and drifts the next time
// the field moves; a number in this table fails the run and prints the new value. If one
// fires after a token change, read the printed ratio and update the row deliberately.
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

// ---- THE MIRROR IS NOW CHECKED, NOT ASSUMED ----------------------------------------
// Every ratio above is derived from a pinned hex, and the argument for pinning them is in
// the header. What pinning cannot do is notice that a pin has stopped being what the app
// paints: a token edit that skips this file leaves every number here measuring a colour
// nothing renders, and the run still prints ALL PAIRINGS PASS. That is the one assertion
// the design could not make about itself, so it is the only thing this section does — it
// derives no ratio from what it reads, and a mismatch names both values and stops.
//
// TOLERANCE IS ONE CHANNEL, and it is not slack. globals.css declares the shadcn tokens as
// HSL triplets rounded to whole degrees and percents (`--primary: 192 100% 62%`), which
// renders up to 1/255 away from the hex the same line is annotated with. That rounding
// ships today and 1/255 cannot move any ratio in the tables above. Anything larger is a
// real token change and fails here.
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
console.log(`\npublished ratios (each MUST still measure the number this repo publishes, to ${MEASURED_DP} dp):`);
for (const [label, fg, bg, published] of measured) {
  const r = ratio(fg, bg);
  const ok = r.toFixed(MEASURED_DP) === published.toFixed(MEASURED_DP);
  if (!ok) fail++;
  console.log(('  ' + label).padEnd(42), fg.padEnd(9), r.toFixed(2).padStart(6), ` was ${published.toFixed(2)}  `,
    ok ? 'as published' : '*** FAIL (the published number is stale — republish it) ***');
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
fail += mirrorProblems.length;
console.log(
  `\nmirror identity (every pin above must still be what app/globals.css and tailwind.config.ts declare, +/-${CHANNEL_TOLERANCE}/255):`,
);
if (mirrorProblems.length) for (const p of mirrorProblems) console.log('  *** MIRROR BROKEN *** ' + p);
else console.log(`  ${mirrored} declaration(s) checked across ${DECLS.get(':root').size} :root properties — every mirrored token still matches`);

console.log(fail ? `\n${fail} PROBLEM(S)` : '\nALL PAIRINGS PASS, ALL GUARDS HOLD, THE MIRROR IS INTACT');
process.exit(fail ? 1 : 0);
