---
name: brand-tokens
description: The contract for packages/brand (tokens.css, Logo, fonts) and how both apps consume it. Use for any color, font, token, theme-mode or logo change.
---

# Brand tokens

`packages/brand` owns the visual identity both apps share: `tokens.css` (semantic color/token overrides), `logo.svg`, `Logo.tsx`, `Logo.astro`, `theme.ts` (mode helpers). Design A = 'Notice board': navy ink on paper, sparse marker-yellow highlight.

## tokens.css

- It **overrides Kumo's semantic tokens** (`--color-kumo-*`) and defines brand ones (`--color-kumo-brand`, fonts). Each token is declared once inside `light-dark()` — light and dark values in a single declaration, no `dark:` classes anywhere.
- Consumption: `apps/web/src/index.css` imports `@cloudflare/kumo/styles` then the brand tokens; `apps/site/src/styles.css` does the same for the site's plain CSS.
- **Adding a token**: only add when no existing `kumo-*` semantic token covers the job, name it `--color-kumo-<thing>`, declare light+dark via `light-dark()`, and reference it in both apps by token name (never the resolved value).
- **Reuse first**: line/border, canvas/elevated/recessed surfaces, default/subtle text, brand accent — check tokens.css before inventing — it also defines `--brand-*` (ink/lite/tint), `--marker`/`--marker-ink`, `.marker`, `.font-display`, and `.bg.a/.bg.p/.bg.r` status tints. Marker is for the logo, one home h1 word, the job-page tear strip and `::selection` only. Values are documented in DESIGN.md; keep the two in sync.

## Fonts

Schibsted Grotesk Variable (`--font-display`, headings/wordmark, `letter-spacing -0.02em`), Atkinson Hyperlegible Next Variable (`--font-sans`, body), Martian Mono Variable (`--font-mono`, labels/meta/dates) — all via `@fontsource-variable/*`. Don't add other typefaces.

## Logo

`Logo.tsx` (web) / `Logo.astro` (site) render the wordmark "hire**juniors**" (marker-highlighted "juniors") or a marker-yellow rounded square with "hj", via `size` + `wordmark` props. `logo.svg` is the resolved-light mark. Don't inline new logo art.

## Changing a token

A token change is a cross-app visual change: after editing, (1) update `DESIGN.md` at repo root — it's impeccable's design-system doc and must mirror tokens.css, no invented colors/fonts — and (2) run `verify-ui` — screenshots of a web route AND the site in both light and dark mode. If a token only makes sense for one surface, don't add it globally.
