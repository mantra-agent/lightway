# DESIGN.md — Lightway

## Brand

- Background: Black (#000000)
- Text: White (#FFFFFF)
- Logo: Mantra mark (public/mantra-logo.png)
- Style: Minimal, brand-forward, clean typography

## Type Scale

Product UI type scale follows the Mantra product DESIGN.md (up to 30px / 3xl).

### Display Sizes (Marketing / Hero contexts only)

These sizes are reserved for landing page heroes, section headlines, and marketing display copy. They must not be used in product UI.

| Token     | Size  | Weight | Use case                        |
|-----------|-------|--------|---------------------------------|
| display-sm | 36px | 700    | Section headlines on landing pages |
| display-md | 48px | 700    | Hero headlines (mobile max)     |
| display-lg | 56px | 700    | Hero headlines (desktop max)    |

All display sizes use `font-weight: 700` and `letter-spacing: -0.025em`.

## Radius

Border radius follows the product token: `8px` (`0.5rem`). Do not use other radius values unless a specific component (e.g. circular avatar, pill badge) requires it.

## CTA

CTA buttons use flat `hsl(200 80% 50%)` background with `hsl(220 14% 98%)` text. No gradients on buttons.
