# Design system — Notice board

Hire Juniors looks like a pinned-up community notice board: navy ink on
paper, a marker-yellow highlight used sparingly, and a signature
perforated "tear-off" apply tab on job listings.

Single source of truth for tokens: `packages/brand/tokens.css` — one
`light-dark()` declaration per token, no `dark:` classes.

## Type

| Role    | Family                     | Package                                           | Weights     |
| ------- | -------------------------- | ------------------------------------------------- | ----------- |
| Display | Schibsted Grotesk Variable | `@fontsource-variable/schibsted-grotesk`          | 500/700/800 |
| Body    | Atkinson Hyperlegible Next | `@fontsource-variable/atkinson-hyperlegible-next` | 400/500/700 |
| Mono    | Martian Mono Variable      | `@fontsource-variable/martian-mono`               | 400/500     |

CSS tokens: `--font-display`, `--font-sans` (body), `--font-mono`.
`.font-display` sets `letter-spacing: -0.02em`. Mono is for labels,
meta, dates and kickers at 11–12px, uppercase, `letter-spacing .06–.08em`.

## Colour

| Token                   | Light     | Dark      | Use                           |
| ----------------------- | --------- | --------- | ----------------------------- |
| `--color-kumo-canvas`   | `#f4f6fa` | `#0e1424` | page paper                    |
| `--color-kumo-elevated` | `#ffffff` | `#151d31` | cards, job rows               |
| `--color-kumo-recessed` | `#eaedf3` | `#1a2339` | inset surfaces                |
| `--color-kumo-line`     | `#d5dae5` | `#26304a` | hairline borders              |
| `--color-kumo-default`  | `#172036` | `#e9edf6` | body ink                      |
| `--color-kumo-subtle`   | `#5a6377` | `#9aa3b8` | secondary text                |
| `--color-kumo-brand`    | `#172036` | `#e9edf6` | primary fills = ink           |
| `--brand-ink`           | `#ffffff` | `#0e1424` | text on the brand fill        |
| `--marker`              | `#ffe14d` | `#ffe14d` | highlight, both modes         |
| `--marker-ink`          | `#172036` | `#172036` | anything placed ON the marker |

Hover on ink fills goes one step lighter in light mode (`#25345a`) and
one step darker in dark mode (`#cdd6e6`). Links are ink-coloured and
underlined — no hue links. Kumo neutrals (`control`, `overlay`, `tint`,
`fill`, `fill-hover`, `hairline`, `interact`, `contrast`, `focus`) derive
from the same navy scale in `tokens.css`. Status hues (active / paused /
archived / danger) keep their semantics, re-tuned to sit with navy.

### The marker — use sparingly

Marker yellow appears in exactly four places:

1. the wordmark's "juniors",
2. one highlighted word in the home h1,
3. the job page's apply tear strip,
4. `::selection`.

Anything on the marker uses `--marker-ink`, in both modes. The admin
dashboard gets no marker outside the logo.

## Logo

`Logo.tsx` / `Logo.astro` keep `size` + `wordmark` props.

- Wordmark: "hire" + "juniors" in Schibsted 800, `letter-spacing -0.02em`,
  ink colour. "juniors" carries the marker via
  `linear-gradient(transparent 18%, marker 18%, marker 88%, transparent 88%)`,
  `padding 0 3px`, `radius 2px`, text in `--marker-ink`.
- Mark-only: rounded square (`rx 7` at 32px) in `--marker` with "hj" in
  `--marker-ink`, Schibsted 800.
- `logo.svg` is the mark with resolved light values.

## Signature: the tear-off tab

Every job row is a card (`1fr 64px` grid, elevated, 1px line border,
`radius 10px`). The right cell is a perforated tab: a radial-gradient
dotted left edge, vertical "Apply ↗" text via `writing-mode`. On row
hover/focus-within the tab does `translateX(3px) rotate(1.5deg)`,
`transform-origin: left top`, `180ms cubic-bezier(.2,.7,.3,1)`, and the
row border turns ink. `prefers-reduced-motion`: border only, no
transform. Below 480px the tab becomes a horizontal strip under the row
(top perforation, horizontal text) — it never squeezes the title.

On the job detail page the same idea becomes a "stub" aside: 1.5px ink
border, `radius 12px`, a `dl` of facts with mono `dt` labels, and a
marker-yellow tear strip (2px dotted top rule, `--marker-ink` text,
"Apply on {host} ↗"). Retired (410) pages get no tear strip.

Focus is always a 2px ink outline with 2px offset.

## Contrast (measured)

| Pair                                       | Ratio              | Threshold | Pass |
| ------------------------------------------ | ------------------ | --------- | ---- |
| control-line vs canvas / elev / rec, light | 4.06 / 4.40 / 3.75 | ≥3:1      | ✓    |
| control-line vs canvas / elev / rec, dark  | 6.52 / 5.96 / 5.55 | ≥3:1      | ✓    |
| body ink vs canvas / elev, light           | 14.97 / 16.20      | ≥4.5:1    | ✓    |
| body ink vs canvas / elev, dark            | 15.65 / 14.30      | ≥4.5:1    | ✓    |
| subtle vs canvas / elev / rec, light       | 5.57 / 6.02 / 5.14 | ≥4.5:1    | ✓    |
| subtle vs canvas / elev / rec, dark        | 7.26 / 6.63 / 6.18 | ≥4.5:1    | ✓    |
| brand button: #fff on #172036              | 16.20              | ≥4.5:1    | ✓    |
| brand hover: #fff on #25345a               | 12.23              | ≥4.5:1    | ✓    |
| brand button dark: #0e1424 on #e9edf6      | 15.65              | ≥4.5:1    | ✓    |
| brand hover dark: #0e1424 on #cdd6e6       | 12.55              | ≥4.5:1    | ✓    |
| danger: #fff on #b3261e                    | 6.54               | ≥4.5:1    | ✓    |
| danger dark: #121212 on #ff8f88            | 8.51               | ≥4.5:1    | ✓    |
| marker-ink on marker                       | 12.44              | ≥4.5:1    | ✓    |
