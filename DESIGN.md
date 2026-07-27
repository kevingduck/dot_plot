# DotChart design system

The rules the UI is built to. Change values here and in `src/styles.css`
(`:root` tokens) / `src/theme.ts` (canvas copy) together — the canvas reads
the TS copy.

## Layout zones (the dashboard, top → bottom)

1. **Topbar** — brand lockup left; actions right (primary action first,
   then menus, then icon buttons). Status line (project source, live chip,
   account) hugs directly beneath it.
2. **Stat strip** — ONE segmented card, four cells with hairline dividers.
   Never four competing boxes; never taller than ~64px. Headline numbers
   only.
3. **Hero: the Daily activity card** — the product. Header (title + one-line
   how-to-read | legend chips right), then the **toolbar** (filters on a
   wash background, inside the card — filters live with what they filter),
   then the grid. The grid must start above the fold at 1360×900.
4. **Below the hero** — Insights (results ride here; empty state is a slim
   band, never a cavern), then Cohort retention.

The wizard, plan panel, and settings interpose between zones 1 and 2 when
open. One primary action per screen region.

## Tokens (`src/styles.css :root`)

- **Surfaces**: `--plane` (page), `--surface-1` (cards). Dark mode is its
  own selection, not an inversion. The page behind the cards is not flat:
  a faint dot-grid field (`--atmo-dot`, the product's own motif) under a
  soft accent glow at the top (`--atmo-glow`), fixed-attached.
- **Ink**: `--text-primary` / `--text-secondary` / `--text-muted`. Text
  never wears series colors.
- **Lines**: `--border` (hairlines ~8% ink), `--gridline`, `--baseline`.
- **Elevation**: `--shadow-card` (whisper, cards) and `--shadow-pop`
  (menus/dialogs). Dark mode: card shadow off — borders carry separation.
- **Accent**: one blue, `--accent`, for primary actions and focus. Never a
  second accent.
- **Radii**: 12px cards, 10px popovers/toolbars, 8px controls, 999px chips.

## Type

Three faces, high-contrast pairing (display grotesque + Plex), loaded from
Google Fonts with system fallbacks (`--font-display/-body/-mono`):

- **Bricolage Grotesque** — display: brand lockup, card titles. 700–800.
- **IBM Plex Sans** — body, controls, canvas labels.
- **IBM Plex Mono** — data voice: KPI values, event keys, paths, code,
  diffs. Never for human input like email.

| Use | Spec |
|---|---|
| KPI value | mono 23px / 600 / -0.03em |
| Card titles | display 16px / 700 |
| Brand | display 19px / 800 |
| Body / controls | body 13–14px / 400–500 |
| Hints, subs | 12–12.5px muted |
| Overlines | 10.5–11px / 600 / uppercase / +0.06em |

## Motion

One orchestrated moment: the page-load reveal — sections rise in top to
bottom on a 50ms stagger. Menus pop in (140ms). Chips and cards lift 1px
on hover. Everything inside `prefers-reduced-motion: no-preference`;
nothing loops except the scan pulse.

## Chart rules

Follow the dataviz method (palette validated by its script — do not eyeball):

- Series palette: 4 categorical slots, fixed order, **shape per series**
  (circle/square/diamond/triangle) as CVD/contrast relief; extra event
  types fold into "Other" (muted dot), never a 5th hue.
- Light `#2a78d6 #1baf7a #eda100 #008300` · dark `#3987e5 #199e70 #c98500
  #008300` — both validated; revalidate after ANY change.
- Cell = day's rarest event; ring = first day; weekends washed. Legend
  always present; legend chips are toggles.
- Status colors (live green, danger red) are reserved — never series.

## Components (one implementation each, in `styles.css`)

`.btn` (+`-primary`, `-ghost`, `-danger`, `-icon`) · `.card` (+`.card-head`,
`.card-sub`) · `.stat-row`/`.stat-tile` · `.filter-row`/`.grid-toolbar` ·
`.menu` (+`.menu-confirm` for destructive two-step) · `.legend-item` ·
tier/src/mode chips · `.scan-hint`/`.scan-error`/`.scan-status` (+pulse) ·
`.provider-card` · `.picker-*` · `.diff` · `.instr-snippet` · `.onboarding`
· `.demo-banner` / `.first-event-banner` · `.auth-card`.

Before inventing a component, reuse one of these. Before shipping UI,
screenshot light AND dark at 2× and look at it.

## Voice

Buttons say what happens ("Show me my users", "Create branch & push to
GitHub"). Hints say why and what's safe ("used once, never stored"; "merged
as-is, this branch is a no-op"). Destructive actions spell out blast radius
and are two-step. Honest states always: ● reporting / ◐ in database / ○ no
events yet.
