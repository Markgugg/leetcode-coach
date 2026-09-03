# Handoff: Coach — Liquid Glass (variation 1b, "Clear glass · daylight")

## Overview
Restyle the **Coach** surface — the inline assistant card that raises heads-up
notices, hints, and review results — as an Apple-style *liquid glass* material,
and apply that material consistently across **all Coach screens** (heads-up
notice, hint, review result, ask, collapsed state, and any future Coach
message). This bundle is the chosen direction **1b**: light/clear glass, dark
text, saturated green primary action.

## About the Design Files
The files here are **design references created in HTML** — a prototype showing
intended look and behavior, not production code to ship. The task is to
**recreate this design in the target codebase's existing environment** (React,
Vue, SwiftUI, native, whatever Coach currently lives in), using its established
component patterns, theming, and icon set. If Coach has no styling layer yet,
`liquid-glass.css` + `CoachCard.jsx` can be adopted directly as the starting
point.

Two things about this material that are easy to get wrong and worth reading
before writing code:

1. **Glass needs something behind it.** `backdrop-filter` refracts whatever
   renders underneath. Over a flat dark grey app background it looks like plain
   translucent grey. Either place Coach over a colorful/animated backdrop (see
   `.lg-stage`), or accept a *tinted* glass over the app surface (see
   "If the app background is flat" below).
2. **The bezel and the card are two nested elements.** The outer element carries
   the bright gradient rim; the inner one carries the blur, the 1px rim, and the
   `::before` specular sheen. Collapsing them into one div loses the "edge lit"
   read that makes it look like Apple glass.

## Fidelity
**High-fidelity.** All colors, type sizes, radii, blurs, shadows, and transition
timings below are final and are the exact values in the prototype. Recreate
pixel-perfectly, then substitute the codebase's own icons/fonts only where
noted.

## Screens / Views

All Coach screens share **one anatomy**. Only the tone, badge, body copy, and
button set change.

```
Stage (colorful backdrop, app-level)
└─ Panel        radius 34, padding 5, bezel gradient, drop shadow
   └─ Card      radius 29, blur(28) saturate(200%) brightness(1.06),
      │         fill rgba(255,255,255,.50), 1px rim rgba(255,255,255,.60),
      │         ::before specular sheen over top 60%
      ├─ Header      dot · title · subtitle · spacer · chevron button
      ├─ Divider
      ├─ Body        inline badge + message text (mono code spans)
      ├─ Actions     primary · secondary · spacer · dismiss
      ├─ Divider (quiet)
      └─ Footer      usage meta line
```

### 1. Heads up (canonical screen)
- **Purpose**: warn the user about a likely bug before they run the code.
- **Layout**: card is full content width (prototype: 530px inner at a 620px
  stage); vertical stack, no internal scroll. Header `18/20/16` padding,
  body `20/20/18`, actions `2/20/20`, footer `14/20/16`.
- **Components**
  - **Status dot** — 11×11, radius 50%, `linear-gradient(180deg,#ffb340,#f97b00)`,
    glow `0 0 10px rgba(249,123,0,.55)` + `inset 0 1px 1px rgba(255,255,255,.8)`.
  - **Title** "Coach" — 19px/1, weight 600, letter-spacing −.01em, `#181820`.
  - **Subtitle** "heads up" — 17px/1, weight 400, `rgba(30,30,45,.50)`.
  - **Chevron button** — 30×30 circle, bg `rgba(255,255,255,.45)`,
    border `1px rgba(255,255,255,.70)`, glyph `rgba(30,30,45,.65)` 11px.
    Hover: bg `.85`, `translateY(1px)`.
  - **Divider** — 1px, `linear-gradient(90deg, transparent, rgba(255,255,255,.85) 12%, rgba(255,255,255,.85) 88%, transparent)`.
  - **HEADS UP badge** — inline-flex, height 26, padding 0 11, margin-right 9,
    radius 13, bg `linear-gradient(180deg,rgba(255,255,255,.80),rgba(255,196,107,.45))`,
    border `1px rgba(255,255,255,.80)`,
    shadow `inset 0 1px 0 rgba(255,255,255,.90), 0 2px 6px -3px rgba(180,110,0,.60)`,
    type 700 12px, letter-spacing .09em, color `#8a4a00`, `vertical-align:2px`.
  - **Body text** — 18px/1.5, weight 400, `rgba(24,24,34,.88)`, `text-wrap:pretty`.
    Copy: *"Check the last-index case, indexing `flowerbed[len(flowerbed)]` will
    crash and the boundary logic looks off."*
  - **Code span** — 16px/1 mono, weight 500, padding 2px 6px, radius 7,
    bg `rgba(255,255,255,.60)`, border `1px rgba(255,255,255,.80)`, color `#2a2a3a`.
  - **Primary "Check code"** — height 46, padding 0 22, radius 23,
    bg `linear-gradient(180deg,rgba(52,214,130,.95),rgba(20,168,98,.90))`,
    border `1px rgba(255,255,255,.55)`,
    shadow `0 12px 26px -12px rgba(20,150,90,.85), inset 0 1px 0 rgba(255,255,255,.75)`,
    type 600 17px, `#fff`.
    Hover `scale(1.035)` + stronger glow; active `scale(.97)`;
    transition `.18s cubic-bezier(.32,1.4,.5,1)`.
  - **Secondary "Hint"** — same metrics, padding 0 20, bg `rgba(255,255,255,.50)`,
    `backdrop-filter: blur(12px)`, border `1px rgba(255,255,255,.70)`,
    `inset 0 1px 0 rgba(255,255,255,.90)`, type 500 17px, `#1e1e2c`.
    Hover bg `.80` + `scale(1.03)`.
  - **Dismiss "Got it"** — right-aligned via a flex spacer; bg
    `rgba(255,255,255,.30)`, border `1px rgba(255,255,255,.55)`,
    color `rgba(30,30,45,.70)`; hover bg `.70`, color `#1e1e2c`, **no scale**.
  - **Footer meta** — 14px/1, `rgba(30,30,45,.55)`, letter-spacing .01em.
    Copy: *"35 AI calls · 22 checks, 8 reviews, 4 hints, 1 asks"*.

### 2. Hint
Same shell. Dot → amber (unchanged), badge → `HINT` using the amber treatment.
Actions: primary **"Show hint"**, dismiss **"Not yet"**; no secondary.

### 3. Review result (pass)
Dot → `.lg-dot--green` (`#6ff0a8 → #14a862`), badge → `.lg-badge--success`
(`REVIEWED`, ink `#0a5233`). Actions: primary **"Open diff"**, dismiss **"Close"**.

### 4. Error / crash
Dot → `.lg-dot--red`, badge → `.lg-badge--error` (`ERROR`, ink `#7a1410`).
Primary stays green (it is the *action*, not the severity) — severity is carried
by dot + badge only. Never restyle the primary red.

### 5. Ask (input state)
Body swaps for a textarea styled as glass: bg `rgba(255,255,255,.45)`,
border `1px rgba(255,255,255,.70)`, radius 18, padding 12/14, 17px/1.45 text,
placeholder `rgba(30,30,45,.45)`, focus ring
`outline: 2px solid rgba(20,168,98,.85); outline-offset: 3px`.
Actions: primary **"Ask"** + dismiss **"Cancel"**.

### 6. Collapsed
Header only — hide divider, body, actions, footer. Chevron rotates 180°
(`transform: rotate(180deg)`, `.18s`). Card keeps radius 29 and all glass
properties; height animates `max-height`/`grid-template-rows`, never `display`
toggling, so the material doesn't pop.

## Interactions & Behavior
- **Primary** → runs the check; while pending, show a 3-dot pulse inside the
  button and set `disabled` (opacity .45, no transform).
- **Secondary** → reveals the hint inline (expands the body; same
  `max-height` animation as collapse).
- **Dismiss** → collapses to nothing with `opacity 0 / scale(.98)` over `.2s`,
  then unmounts.
- **Chevron** → collapse/expand.
- **Hover** — glass surfaces brighten (fill alpha up ~.2–.3) and lift
  `scale(1.03)`; the primary uses the spring easing
  `cubic-bezier(.32,1.4,.5,1)`. Active always `scale(.97)`.
- **Focus** — `:focus-visible` ring `2px rgba(20,168,98,.85)`, offset 3px.
  Do not remove; glass has low-contrast edges and needs it.
- **Backdrop motion** — 3 blurred blobs drifting on 15/18/22s loops. Must be
  gated behind `@media (prefers-reduced-motion: reduce)`.
- **Responsive** — below ~420px: body text 17px, buttons `.lg-btn--sm`
  (height 38, radius 19, 15px), actions wrap to two rows with the dismiss
  button full-width last; panel radius 28 / card 24.

## State Management
| State | Type | Trigger |
|---|---|---|
| `collapsed` | boolean | chevron |
| `visible` | boolean | dismiss → unmount after exit anim |
| `tone` | `'amber' \| 'green' \| 'red'` | message severity from server |
| `badge`, `body`, `meta` | string / node | message payload |
| `pending` | boolean | primary action in flight |
| `hintShown` | boolean | secondary action |
| `reducedMotion` | boolean | `matchMedia('(prefers-reduced-motion: reduce)')` |

Usage meta (`35 AI calls · 22 checks…`) comes from the existing usage endpoint;
it is display-only and should be hidden entirely when unavailable (do not render
an empty footer or the divider above it).

## Design Tokens
All tokens are declared as CSS custom properties at the top of
`liquid-glass.css` — treat that file as the source of truth and port it into
the codebase's token system. Summary:

- **Glass fills**: `rgba(255,255,255,.50)` card · `.80` hover · `.50` secondary ·
  `.30` tertiary
- **Rims**: `rgba(255,255,255,.60)` card · `.70` control · `.55` quiet
- **Specular**: `inset 0 1px 0 rgba(255,255,255,.90)`; sheen
  `linear-gradient(170deg, rgba(255,255,255,.55), transparent 80%)` over top 60%
- **Bezel**: `linear-gradient(155deg, rgba(255,255,255,.75), rgba(255,255,255,.14) 45%, rgba(255,255,255,.55))`
- **Blur**: card `blur(28px) saturate(200%) brightness(1.06)`; controls `blur(12px)`
- **Ink**: `#181820` title · `rgba(24,24,34,.88)` body · `rgba(30,30,45,.50)`
  subtitle · `.55` footer · `.70` quiet label
- **Accent green**: `rgba(52,214,130,.95) → rgba(20,168,98,.90)`,
  glow `rgba(20,150,90,.85)`
- **Accent amber**: dot `#ffb340 → #f97b00`; badge ink `#8a4a00`
- **Radii**: 34 panel · 29 card · 24 tile · 23 control · 19 small control ·
  13 badge · 7 code
- **Spacing**: bezel pad 5 · card pad-x 20 · control gap 12 · header
  18/20/16 · body 20/20/18 · footer 14/20/16
- **Type**: SF via `-apple-system, BlinkMacSystemFont, system-ui,
  "Helvetica Neue", Helvetica, sans-serif`; mono `ui-monospace,
  SFMono-Regular, Menlo, monospace`. Scale: 19/600 title · 18/400 body ·
  17/500-600 controls · 16/500 code · 14/400 footer · 12/700 badge.
- **Elevation**: panel `0 26px 60px -26px rgba(40,30,80,.60)`;
  primary `0 12px 26px -12px rgba(20,150,90,.85)`
- **Motion**: `.18s` default; spring `cubic-bezier(.32,1.4,.5,1)`;
  backdrop drift 15/18/22s ease-in-out infinite

## If the app background is flat (likely)
Coach currently sits on a dark IDE-ish surface. Two supported options:

1. **Local stage** — give the Coach container its own `.lg-stage` backdrop
   (recommended: it keeps 1b's exact look and confines the color to one
   component).
2. **Tinted glass** — keep the app background and change the card fill to
   `rgba(255,255,255,.10)` with ink flipped to the light-on-dark set
   (`rgba(255,255,255,.95)` title, `.90` body, `.45` secondary) and rims to
   `rgba(255,255,255,.16)`. This is variation **1a** in the prototype — the same
   geometry and shadows, dark material. Do not mix: pick one per product surface.

Always keep a `@supports not (backdrop-filter: blur(1px))` fallback (already in
the CSS): opaque `rgba(255,255,255,.86)` fill.

## Accessibility
- Body ink on the light glass measures ≈ 9:1 over the prototype backdrop; the
  `rgba(30,30,45,.50)` subtitle is decorative-adjacent — never put
  load-bearing information there.
- The green primary uses white text at 17/600 — verify ≥ 4.5:1 against the
  final gradient in your build; darken the bottom stop to
  `rgba(16,150,86,.95)` if it falls short.
- Badge text is uppercase 12px: expose the severity to AT via
  `role="status"` + `aria-live="polite"` on the card, not the badge alone.
- Chevron button needs `aria-expanded` and an `aria-label`.

## Assets
None. No images, no icon fonts. The only glyph is the disclosure chevron `▾` —
replace it with the codebase's own chevron icon at 11–12px, color
`rgba(30,30,45,.65)`. The status dot and all glass effects are pure CSS.

## Files
- `liquid-glass.css` — tokens + component layer (`.lg-stage`, `.lg-panel`,
  `.lg-card`, `.lg-head`, `.lg-badge`, `.lg-code`, `.lg-btn*`, `.lg-footer`,
  fallbacks). Source of truth for all values.
- `CoachCard.jsx` — reference React implementation of the anatomy above
  (presentational; wire your own state/handlers).
- `Coach Card Liquid Glass.dc.html` — the original HTML prototype. Open in a
  browser: turn 1 holds **1b** (this direction) and 1a (dark), turn 2 holds two
  further Apple-flavoured takes (Lock Screen notification, Control Center tile)
  for reference only.
