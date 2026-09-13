# Handoff: Prunerr sidebar — animated nav icon hover states

## Overview

Adds polished micro-animations to the eight Menu icons in the Prunerr sidebar
(`client/src/components/Layout/Sidebar.tsx`), plus the five footer link icons.
Each icon's parts move independently on hover — tiles fan, a bin lid opens, a
clock hand rewinds — instead of the whole glyph scaling or sliding. Nothing else
about the sidebar changes: same geometry, same colours, same layout, same copy.

## About the design files

`Prunerr Sidebar.dc.html` in this bundle is a **design reference created in
HTML** — a working prototype of the intended look and behaviour, not production
code to copy. It is a faithful recreation of the current sidebar (built from the
repo source listed under *Source of truth*) with the new animations layered on.

`NavIcons.tsx` and `navIcons.css` **are** production-shaped: they were authored
against this repo's React + Tailwind + lucide setup and are intended to be
dropped in. `INTEGRATION.md` has the exact `Sidebar.tsx` diff.

## Fidelity

**High-fidelity.** Every colour, size, radius, font and spacing value in the
prototype was read out of the repo (`index.css` CSS variables,
`tailwind.config.js`, the component files). Icon geometry is lucide `0.562.0`
verbatim, matching the pinned `lucide-react@^0.562.0`. Implement pixel-for-pixel;
the animation timings below are the design.

## Source of truth

Recreated from `helliott20/prunerr@main`:

| Area | File |
| --- | --- |
| Sidebar markup, nav list, footer links | `client/src/components/Layout/Sidebar.tsx` |
| Sidebar shell, mobile drawer, swipe + blur suspension | `client/src/components/Layout/Layout.tsx` |
| Storage card | `client/src/components/Layout/StorageWidget.tsx` |
| Surface/accent tokens, `.nav-item`, perf rules | `client/src/index.css` |
| Palette, fonts, shadows | `client/tailwind.config.js` |
| Route shell / page transitions | `client/src/App.tsx` |
| Version string (`v1.4.10`) | `client/package.json` |
| Icon geometry | `lucide-icons/lucide@0.562.0`, `icons/*.svg` |

## Screens / views

### Sidebar (`<aside>`), 288px fixed

Only view in scope. Desktop: static column. Under `lg` (1024px): a fixed drawer
translated off-canvas, opened by swipe or the header menu button — owned by
`Layout.tsx`, unchanged by this work.

**Layout, top to bottom**

1. **Brand header** — 80px tall, `padding: 0 24px`, bottom border
   `1px solid rgb(15 23 42 / 0.5)`. 48px logo tile, `border-radius: 12px`,
   `linear-gradient(to bottom right, #f59e0b, #d97706)`, shadow
   `0 10px 15px -3px rgb(245 158 11 / 0.2)`; 24px `Scissors` stroked `#451a03`.
   A 12px emerald `#10b981` status dot sits at `top: -4px; right: -4px` with a
   2px `rgb(8 13 25)` ring and the Tailwind `animate-pulse` (opacity 1 → 0.5,
   2s). Title "Prunerr" — Outfit 700, 20px, `letter-spacing: -0.025em`,
   `#f8fafc`. Subtitle "Media Library Manager" — DM Sans 500, 12px,
   `rgb(71 85 105)`.
2. **Menu list** — `padding: 16px`, `gap: 6px`. Section label "Menu" in
   `padding: 8px 12px; margin-bottom: 16px`, 10px/12px, weight 600, uppercase,
   `letter-spacing: 0.1em`, `rgb(71 85 105)`.
3. **Storage card** — `padding: 16px` block with a top border; the card itself
   `padding: 14px`, `border-radius: 16px`,
   `linear-gradient(to bottom, rgb(15 23 42 / 0.55), rgb(15 23 42 / 0.3))`,
   border `1px solid rgb(30 41 59 / 0.45)`, shadow
   `0 1px 0 rgb(255 255 255 / 0.02) inset, 0 8px 24px -16px rgb(0 0 0 / 0.4)`.
   60px ring (r=22, stroke 5, circumference 138.23) over a
   `rgb(30 41 59 / 0.7)` track with a 1.5-length tick mark at
   `dashoffset -103.67`; progress arc `#f59e0b` with
   `drop-shadow(0 0 3px #f59e0b)`. Prototype shows 62% — 22.3 TB of 36 TB,
   13.7 TB free, +0.4 TB/mo. Real values come from `useUnraidStats()`.
4. **Footer** — `padding: 12px 24px`, top border. Five 16px icons in a
   `gap: 12px` centred row, each in a `padding: 10px; border-radius: 8px`
   button. Version line in JetBrains Mono 10px `rgb(51 65 85)`.

**Nav row (the thing being animated)**

| | Inactive | Active |
| --- | --- | --- |
| Padding | `12px 16px` | same, plus 1px border |
| Radius | 12px | 12px |
| Type | DM Sans 500, 14px | same |
| Text | `rgb(100 116 139)` → hover `rgb(226 232 240)` | `rgb(251 191 36)` |
| Background | transparent → hover `rgb(15 23 42 / 0.6)` | `rgb(245 158 11 / 0.1)` |
| Border | none | `1px solid rgb(245 158 11 / 0.2)` |
| Shadow | none | `0 1px 2px 0 rgb(245 158 11 / 0.1)` |
| Icon | 20px, `rgb(71 85 105)` → hover `rgb(148 163 184)` | `rgb(251 191 36)` |
| Colour transition | 200ms ease | — |

Queue row carries a count badge: `margin-left: auto`, `padding: 2px 8px`, 12px
weight 600, pill radius, `rgb(244 63 94 / 0.2)` on `#fb7185` text with a
`rgb(244 63 94 / 0.3)` border. The active row carries a 12px `Sparkles` at
`rgb(251 191 36 / 0.6)` — **static, does not animate** (deliberate: it read as
noise when it spun).

## Interactions & behaviour

Every animation is transform-only (plus one opacity fade), driven by a single
inherited custom property `--h` that goes 0 → 1. Easing is
`cubic-bezier(0.34, 1.4, 0.64, 1)` — a soft overshoot — unless noted.

| Icon | Motion | Duration / stagger |
| --- | --- | --- |
| Dashboard | 4 tiles translate 0.8px diagonally away from centre | 420ms, 0/55/110/165ms |
| Library | 3 bars `scaleY` from bottom (+16%, −12%, +10%), leaning book lifts 1.6px | 440ms, 0/50/100/150ms |
| Collections | top layer −1.8px, middle +0.3px, bottom +1.4px | 420ms, 0/60/120ms |
| Rules | top line `scaleX` 0.92, middle +2.4px, bottom −2.4px | 400ms, 0/70/140ms |
| Queue | lid group rotates −17° about `4px 6px` and lifts 0.7px; two bars `scaleY` 0.68 from bottom | 460ms lid; 420ms bars at 80/150ms |
| History | hand rotates −50° about `12px 12px`; arrow head pulls 1px up-left | 560ms hand (`cubic-bezier(0.34,1.25,0.64,1)`), 420ms arrow |
| Activity | trace `scaleY` +18%; a duplicate path at `stroke-width: 2.6`, `stroke-dasharray: 9 55` fades to 0.9 opacity and sweeps via `@keyframes navSweep` (dashoffset 64 → 0, 1.2s linear, infinite) | 460ms scale, 240ms fade |
| Settings | cog rotates 45° about `12px 12px`; hub circle scales +16% | 620ms cog (`cubic-bezier(0.34,1.2,0.64,1)`), 420ms hub at 60ms |

Footer icons, same mechanism (`--f` in the prototype, `--h` in the CSS build):
sun rays rotate 60° with the core +22%; globe meridian `scaleX` 0.38 (reads as a
spin); GitHub mark hops 1.6px with the tail flicking 1.9px left; chat bubble
scales +16% from its tail corner; Docker fins lift 1.5px, staggered 0/60ms. The
storage card's trend arrow nudges up-right 0.9px on card hover.

**Trigger rules**

- Pointer hover — `@media (hover: hover) and (pointer: fine)` only, so touch
  devices never get stuck in a hover state after a tap.
- `:focus-visible` — same as hover, for keyboard parity.
- `:active` — touch press plays it once. This matters: on mobile the drawer is
  the only nav surface and it closes ~300ms after a tap, so the press animation
  is the only acknowledgement the user gets. Safari needs a touch handler on the
  element or an ancestor for `:active` to fire; the rows already have `onClick`
  (`handleNavClick`).
- `prefers-reduced-motion: reduce` — pins `--h` to 0 and kills the sweep
  keyframe. Colour and background hover still apply.

**Performance** — transform and opacity only, so all of it is compositor-driven:
no layout, no paint, and no conflict with the `.nav-animating` /
`.page-animating` `backdrop-filter` suspension in `index.css`.

## State management

None. `--h` inherits from the row, and the rows already carry Tailwind's `group`
class, so hover/press/focus are pure CSS. No new state, props, hooks or
dependencies. (The `.dc.html` prototype uses React state for hover only because
it can't rely on descendant CSS selectors — do not port that part.)

Optional: call the existing `lib/haptics.ts` helper from `handleNavClick` for a
10ms tick on nav taps. `navigator.vibrate` is unavailable in some webviews
(including nzb360's) and degrades silently.

## Design tokens

Dark theme, from `index.css` `.dark` and `tailwind.config.js`:

| Token | Value |
| --- | --- |
| `--surface-950` (app bg) | `rgb(3 7 18)` |
| `--surface-900` (sidebar bg) | `rgb(8 13 25)` |
| `--surface-800` (hover bg, borders) | `rgb(15 23 42)` |
| `--surface-700` | `rgb(30 41 59)` |
| `--surface-600` | `rgb(51 65 85)` |
| `--surface-500` (idle icon, muted text) | `rgb(71 85 105)` |
| `--surface-400` (idle label) | `rgb(100 116 139)` |
| `--surface-300` (hover icon) | `rgb(148 163 184)` |
| `--surface-100` (hover label) | `rgb(226 232 240)` |
| `--surface-50` (headings) | `rgb(248 250 252)` |
| `accent-500` / `accent-600` | `#f59e0b` / `#d97706` |
| `--accent-text` / hover | `rgb(251 191 36)` / `rgb(252 211 77)` |
| `accent-900` (logo glyph) | `#451a03` |
| `ruby-400` / `ruby-500` | `#fb7185` / `#f43f5e` |
| `emerald-500` (status dot) | `#10b981` |
| Radii | 8px footer button, 12px nav row + logo tile, 16px storage card, 999px pills |
| Type | Outfit 600/700 display, DM Sans 400–600 body, JetBrains Mono 400 numerals |
| Sizes | 10px label · 11px meta · 12px subtitle · 14px nav · 20px brand · 22px storage value |
| Spacing | 6px row gap · 12px footer gap · 14px icon-to-label · 16px nav padding · 24px header padding |
| Icon sizes | 20px nav · 16px footer · 12px sparkle · 24px logo |

## Assets

No image assets. All icons are inline SVG, geometry copied verbatim from
`lucide-icons/lucide@0.562.0` (`icons/layout-dashboard.svg`, `library.svg`,
`layers.svg`, `list-filter.svg`, `trash-2.svg`, `history.svg`, `activity.svg`,
`settings.svg`, `scissors.svg`, `sparkles.svg`, `globe.svg`, `github.svg`,
`message-circle.svg`, `container.svg`, `sun.svg`, `trending-up.svg`) so they are
identical at rest to what `lucide-react` renders today. They are inlined rather
than imported because `lucide-react` renders its own paths, leaving no handle on
the individual `rect`/`path`/`circle` each animation moves.

Fonts are already loaded by the app (Outfit, DM Sans, JetBrains Mono).

## Files

| File | What it is |
| --- | --- |
| `NavIcons.tsx` | Production component — drop at `client/src/components/Layout/NavIcons.tsx` |
| `navIcons.css` | Production CSS — append to `client/src/index.css` |
| `INTEGRATION.md` | Exact `Sidebar.tsx` diff and integration notes |
| `Prunerr Sidebar.dc.html` | Design reference prototype — open in a browser and hover |

## Not done / open

- Footer link icons animate in the prototype but their buttons lack the `group`
  class in `Sidebar.tsx`; add `group` and move those five icons into
  `NavIcons.tsx` the same way if you want them shipped.
- Light theme was not designed. Token names are theme-aware, but the animations
  were only reviewed against dark.
- Storage ring still jumps to its value on mount rather than sweeping in; the
  active-row pill still snaps rather than sliding between rows. Both discussed,
  neither built.
