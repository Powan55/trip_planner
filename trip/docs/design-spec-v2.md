# v2 Design Language (S66)

> **Historical (S66, M14). The token values below are superseded — do not implement from this
> document.** The live token contract is `app/globals.css` plus `tailwind.config.ts`. Three things
> changed after S66: the single chrome accent is cyan `189 90% 60%` / `61, 217, 245`
> (`globals.css` declares it for `--accent-scroll`, `--accent`, `--primary` and `--ring` alike;
> `--gold` survives only as a warning colour), not gold; the per-route accent engine was retired
> and `components/route-accent-engine.tsx` was deleted at S354 (see the S366 annotations on D-058,
> D-062 and D-072 in `DECISIONS.md`); and the ambient aurora + grain decoration was removed along
> with several of the classes listed in constraint 3. Kept as the record of the v2 design language
> and its reasoning.

> Slice S66. The token-level design contract for the M14 v2 redesign, delivered as CSS
> variables plus a Tailwind theme so components elsewhere in the app upgrade visually
> without their files being edited (D-078). It lands in `app/globals.css` and
> `tailwind.config.ts`. S67 builds the hero, skeleton and route-transition components
> that consume these tokens.

## Concept
Editorial dark-luxe "liquid glass." A deep Himalayan-night navy field with layered ambient
depth (aurora wash plus fine film grain), a richer multi-tier glass surface hierarchy with
gradient hairline edges, an expressive editorial display type scale, an 8pt spacing rhythm,
and a spring-based motion vocabulary. It should read like a premium travel magazine that
happens to be an app. Nepal warms to himalaya-amber, Japan cools to sakura, and everything
rests on brand gold.

## Hard constraints (non-negotiable, verify every one)
1. **Accent literals (as authored at S66 — now superseded).** S66 pinned the default
   `--accent-scroll: 44 80% 61%` / `--accent-scroll-rgb: 240, 199, 96` byte-exact, with
   `route-accent-engine.tsx` (D-072) overwriting them per route: gold `240,199,96` (`/`), himalaya
   `255,140,66` (`/nepal/`), sakura `247,160,179` (`/japan/`); and shadcn `--accent` held at sakura
   `340 60% 65%` as a separate interactive-chrome token. **None of that is live.** There is one
   route-independent accent, cyan `189 90% 60%`, shared by `--accent-scroll`, `--accent`,
   `--primary` and `--ring`, and the engine component no longer exists. The durable rule that
   survives: `--accent-scroll` is a separate additive hook and must not be collapsed into shadcn's
   `--accent` semantics by a future engine.
2. **D-009 dark-only.** No light-mode variants, no `@media (prefers-color-scheme)` light branch.
3. **Consumed class names survive: restyle, never rename or remove** *(as authored at S66; the list
   has since shrunk — see the banner)*. Frozen components elsewhere used these, so the CSS selectors
   had to keep existing and keep working. Only their *look* changed. **Still live today:**
   `.glass-card` · `.glass-card-dark` · `.glass-nepal` · `.glass-japan` · `.text-gradient-sakura` ·
   `.text-gradient-himalaya` · `.hero-gradient` · `.scrollbar-hide`, plus the S66 additions
   `.glass-panel` and `.glass-subtle`. **Since deleted with their last consumer:**
   `.text-gradient-gold` (gold is no longer a chrome accent; `--gold` survives as a warning colour
   only), `.bg-aurora` / `.animate-aurora` (the ambient decoration was removed — see section 3),
   `.animate-float`, `.animate-pulse-glow`. Likewise keep every shadcn semantic var (`--card`,
   `--border`, `--primary`, `--muted`, `--accent`, `--ring`, `--radius*`, …) and the Tailwind
   color/name mapping. You may refine their values, never delete the keys.
4. **No new npm dependencies** (`package.json` is off-limits). Grain is an inline SVG
   data-URI; motion is CSS or the existing framer-motion only.
5. **No new imagery** (the exact-location-free-photos rule leaves us with none). Heroes are
   gradient and type.
6. **Reduced-motion (D-007/D-056):** every new keyframe animation is neutralized under
   `prefers-reduced-motion: reduce`, and nothing ends stuck at `opacity: 0`.
7. **0-overflow at 360/390/414.** New depth comes from backgrounds, `box-shadow inset`,
   fixed decorative layers and borders only, none of which add a layout box (D-022). No new
   element may widen the page.
8. **WCAG AA on new surfaces.** Body and secondary text ≥ 4.5:1 against the *effective*
   (post-blur) glass fill; large display ≥ 3:1. Report measured ratios.

---

## 1 · Surface & elevation

Keep the existing semantic vars and apply these refinements. They are subtle, they give
richer separation, and none of them change layout:

| Var | Current | v2 | Rationale |
|---|---|---|---|
| `--background` | `222 36% 6%` | **`222 41% 5%`** | Deeper, slightly richer night field. |
| `--card` | `221 30% 9%` | **`221 33% 10%`** | Card lifts a touch further off the bg so elevation reads. |
| `--secondary` | `220 22% 15%` | `220 24% 16%` | Marginal richness. |
| `--muted` | `220 22% 13%` | `220 24% 14%` | " |
| `--muted-foreground` | `215 22% 62%` | **`214 20% 68%`** | +legibility on the deeper bg (AA headroom). |
| `--border` | `220 22% 19%` | **`220 26% 24%`** | Crisper luminous hairline against deeper bg + glass. |
| `--radius` | `0.75rem` | keep | Core radius stable (avoids layout surprise on every `rounded-lg`). |

**Add** larger radii and a full elevation ramp (new keys only):
```
--radius-xl: 1.25rem;      /* panels, heroes */
--radius-2xl: 1.75rem;     /* full-bleed hero cards */
/* Elevation ramp — deeper, layered, premium. Keep existing sm/md/lg/xl; ADD 2xl. */
--shadow-2xl: 0 40px 90px -20px rgba(2, 5, 16, 0.72), 0 12px 30px -10px rgba(2, 5, 16, 0.55);
/* Refine the accent glow a touch richer (still keyed to --accent-scroll so it warms/cools) */
--shadow-glow: 0 0 0 1px hsl(var(--accent-scroll) / 0.22), 0 0 34px hsl(var(--accent-scroll) / 0.26);
```
Wire `--radius-xl/2xl` into `tailwind.config.ts` `borderRadius` as `'2xl'`/`'3xl'` (additive keys),
and `--shadow-2xl` into `boxShadow` as `'2xl'`. Keep the `boxShadow.xl`/`.glow` mappings.

## 2 · Glass hierarchy (the main token-level upgrade, D-078)

Restyle the consumed glass classes into a **three-tier** system with **gradient hairline edges**
and a stronger inner top-highlight. The technique for the gradient edge (no extra element, no
layout box) is `border: 1px solid transparent;` plus `background: linear-gradient(fill)
padding-box, linear-gradient(edge) border-box;`. Keep `backdrop-filter: blur() saturate()`
(with the `-webkit-` prefix). Preserve each surface's brand tint: gold, white, himalaya, sakura.

- **`.glass-card`** (workhorse, gold-tinted): richer 2-stop navy fill, gradient edge from
  `rgba(240,199,96,0.22)` to `rgba(255,255,255,0.06)`, an `inset 0 1px 0 rgba(255,255,255,0.08)`
  top-highlight, `--shadow-lg`-class depth. Blur ~20px, saturate ~130%.
- **`.glass-card-dark`** (max contrast for popovers and dialogs): deeper opaque fill,
  white-hairline gradient edge, `--shadow-xl` depth, blur ~24px.
- **`.glass-nepal`** / **`.glass-japan`**: keep the himalaya / sakura tint recipe but adopt the
  gradient-edge and inner-highlight treatment so they match the new tier. The tint rgba has to
  derive from the himalaya `255,140,66` / sakura `247,160,179` literals. Those are visual tint
  only, not the pinned `--accent-scroll-rgb`, but keep them recognizably on-brand.
- **New optional tiers** (additive; used by the S67 hero and skeleton, and available for
  progressive adoption): `.glass-panel` (max elevation, `--radius-2xl`, `--shadow-2xl`) and
  `.glass-subtle` (low-key list rows). Do not rename anything to introduce these.

## 3 · Ambient depth: aurora + grain (app-wide, static, reduced-motion-safe)

> **Removed since.** The whole ambient layer described in this section is gone: `--gradient-aurora`,
> both `--grain` tiles, and the `body::before` / `body::after` decorative layers were deleted, and
> `tailwind.config.ts` dropped the `bg-aurora` key with them. The page background is now
> `bg-background` alone. Kept below as the record of what was built at S66.

**Enrich `--gradient-aurora`** (keep the var name; it feeds `.bg-aurora` and Tailwind `bg-aurora`).
Add a 4th cool stop and nudge opacities up slightly for more presence, still decorative and subtle:
```
--gradient-aurora:
  radial-gradient(58% 52% at 16% 10%, hsl(44 80% 61% / 0.16) 0%, transparent 60%),
  radial-gradient(48% 44% at 84% 16%, hsl(344 80% 78% / 0.14) 0%, transparent 62%),
  radial-gradient(52% 48% at 78% 88%, hsl(22 100% 63% / 0.12) 0%, transparent 65%),
  radial-gradient(40% 40% at 50% 50%, hsl(220 60% 30% / 0.10) 0%, transparent 70%),
  linear-gradient(180deg, hsl(222 42% 4%) 0%, hsl(221 36% 7%) 100%);
```
**Film grain.** Add an inline SVG `feTurbulence` noise as a CSS var:
```
--grain: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E");
```
**Apply app-wide via `body` decorative layers** (fixed, `inset:0`, `pointer-events:none`,
`z-index:-1` behind content). These add no layout box, so 0-overflow holds:
- `body::before` → `background: var(--gradient-aurora);` (static, not the `.animate-aurora`
  drift, which stays an opt-in utility).
- `body::after` → `background-image: var(--grain);` `opacity: 0.035;` `mix-blend-mode: overlay;`
  `background-size: 140px 140px;`.

Keep `body { @apply bg-background text-foreground; }` as the base beneath these layers.

## 4 · Type scale (editorial display; additive, default `text-*` untouched)

Fonts are injected in `layout.tsx` (off-limits) as `--font-display` / `--font-sans` /
`--font-mono`, so do **not** change families. Add a fluid **display** scale as new Tailwind
`fontSize` keys. Do not redefine `text-base/lg/xl…`, which would shift every existing component
and risk overflow. Each entry is `[size, { lineHeight, letterSpacing, fontWeight }]`:

```
'display-2xl': ['clamp(2.75rem, 6vw, 4.5rem)',  { lineHeight: '1.02', letterSpacing: '-0.03em', fontWeight: '600' }],
'display-xl':  ['clamp(2.25rem, 4.6vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '600' }],
'display-lg':  ['clamp(1.875rem, 3.4vw, 2.75rem)',{ lineHeight: '1.1',  letterSpacing: '-0.02em', fontWeight: '600' }],
'display-md':  ['clamp(1.5rem, 2.4vw, 2rem)',    { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '600' }],
'eyebrow':     ['0.75rem', { lineHeight: '1', letterSpacing: '0.22em', fontWeight: '600' }],  /* uppercase overline */
```
Display sizes use `font-display`; body stays `font-sans`. Usage: heroes take `text-display-*`
plus `.text-gradient-*`, section eyebrows take `text-eyebrow uppercase`.

## 5 · Spacing rhythm (8pt; additive semantic keys)

Add to Tailwind `spacing` (new keys only; Tailwind's 4pt base already covers the rest):
```
'section': 'clamp(4rem, 8vw, 7rem)',   /* vertical rhythm between major sections */
'gutter':  'clamp(1rem, 4vw, 2rem)',   /* responsive page inset */
'18': '4.5rem', '22': '5.5rem',        /* fill common gaps on the 8pt grid */
```

## 6 · Motion vocabulary (spring; reduced-motion aware)

**Easing and duration tokens (CSS vars):**
```
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);   /* gentle overshoot */
--ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);    /* expo-ish settle */
--duration-slower: 500ms;                            /* editorial reveals (anti-pattern: fast/cheap) */
```
**Keyframes and utilities** (defined here in S66, consumed by S67 components):
- `@keyframes reveal-up { from { opacity:0; transform: translateY(14px); } to { opacity:1; transform:none; } }`
  → `.animate-reveal-up { animation: reveal-up var(--duration-slower) var(--ease-out-soft) both; }`.
  The base opacity of any element using this has to be 1 (the keyframe supplies the entrance)
  so reduced motion shows it settled.
- `@keyframes shimmer { 100% { background-position-x: -200%; } }`
  → `.animate-shimmer` (skeleton sweep). It loops infinitely, so add it to the reduced-motion
  `animation:none` list.
- `@keyframes route-fade { from { opacity:0; } to { opacity:1; } }`
  → `.animate-route-fade { animation: route-fade var(--duration-fast) var(--ease-out-soft) both; }`.
  S67's `template.tsx` also hard-checks `useReducedMotion()` and renders a plain div, which is
  the "none under reduced motion" guarantee.
- **Stagger:** `.reveal-stagger > *` sets `animation-delay` in 40ms steps for `:nth-child(1..8)`,
  and children opt in with `.animate-reveal-up`. Document the framer equivalent
  (`staggerChildren: 0.04`, spring) for components that animate via framer instead.

**Reduced-motion block:** extend the existing explicit neutralize list to cover the new
*infinite/looping* utilities (`.animate-shimmer`) with `animation: none !important`. The
one-shot entrances (`reveal-up`, `route-fade`) are already covered by the universal
`animation-duration: 0.01ms` rule and land on their visible end-state. Verify nothing sticks at 0.

## 7 · Per-page hero guidance (implemented in S67, recorded here so the tokens fit)
- **variant `nepal`**: himalaya gradient wash, `text-gradient-himalaya` display title, warm.
- **variant `japan`**: sakura gradient wash, `text-gradient-sakura`, cool.
- **variant `plan`**: neutral gold (`text-gradient-gold`), utilitarian-premium.
- **variant `map`**: neutral gold, slightly more restrained.

All heroes: `.glass-panel` shell, `text-display-*` title, `text-eyebrow` overline, gradient only
(no imagery), compact enough that it does not push content below the fold on mobile, and an
`.animate-reveal-up` entrance.

---

## Evidence required at S66 (real runs)
- `tsc --noEmit` clean, `npm run build` green, First Load JS reported per route (token-only, so
  expect a ~0 delta).
- **Byte-exact proof** (headless, serving `out/`, guest bypass, ports 8821 / CDP 9341): at rest,
  `getComputedStyle(root).getPropertyValue('--accent-scroll-rgb')` = `240, 199, 96` on `/`,
  `255, 140, 66` on `/nepal/`, `247, 160, 179` on `/japan/`.
- **Before/after screenshots** of all 5 pages at 390 and 1280 showing the token upgrade with no
  broken layout.
- 0-overflow at 360/390/414 on all 5 pages; a reduced-motion sweep (no stuck opacity-0, grain and
  aurora static); measured **AA contrast ratios** on the new glass fills (report the numbers);
  0 console errors.
