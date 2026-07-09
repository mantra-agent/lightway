# Lightway — Mantra Landing Pages

Static marketing site for Mantra. Pure HTML/CSS with GSAP animations.

## Tech Stack

- **Build:** Static file copy (`build.mjs` copies `src/` → `dist/`)
- **Styling:** Vanilla CSS (shared `styles.css` + page-scoped `<style>` blocks)
- **Animation:** GSAP 3.12.5 + ScrollTrigger + SplitType 0.3.4 (CDN)
- **Hosting:** Cloudflare Pages (auto-deploy from `main`)
- **Repo:** github.com/mantra-agent/lightway

## Architecture

Multi-page static site. Each page is a standalone HTML file under `src/`. No bundler, no framework, no client-side routing. Build is a file copy.

```
src/
  index.html          # Splash / root redirect
  styles.css          # Shared CSS (CTA, reveal, orbs, dividers, progress bar)
  brand/              # Logo assets
  home/index.html     # /home landing page
  coaches/index.html  # /coaches landing page
```

## Animation Architecture

Progressive enhancement: CSS animations serve as fallback if GSAP CDN fails.

- **Layer 1 (Kinetic Hero):** SplitType word/line splitting + GSAP spring timeline
- **Layer 2 (Scroll Parallax):** ScrollTrigger-driven reveals, directional headers, accent bars
- **Layer 3 (Ambient Life):** Hue shift, shimmer sweep, breathing dividers, count-up
- **Layer 4 (Scroll Progress):** Fixed right-edge progress bar via ScrollTrigger scrub

Reduced motion: `prefers-reduced-motion` disables all GSAP animations via early return. CSS fallback shows content immediately.

FOUT prevention: Hero `h1` has `visibility: hidden` in CSS, switched to `visible` via `.split-ready` class after SplitType initialization.

## Brand

- Black background (#000)
- Blue accent: #4A90D9 / #2B5EA7
- Mantra logo at `brand/mantra-logo.png`
- Clean, minimal, premium dark design
