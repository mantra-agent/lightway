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

Canonical palette from Mantra Design Guide (dark mode):

- Background: #000000 (pure black)
- Card: #171C24 (hsl 222 20% 11%), warm dark blue-gray
- Card border: #212934 (hsl 222 16% 15%)
- Primary text: #E8EAED
- Secondary text: #828A96 (hsl 220 10% 55%)
- Brand accent: CTA blue #1A9BDB (hsl 200 80% 50%)
- Active blue: #8DD4F0 (in-progress states only)
- Semantic: Success #20A88E, Warning #E89820, Error #D4364B (use only where meaning is literally health/completion, caution, or error — never decorative)
- Rule: 60% neutral / 30% supporting / 10% accent. Warm neutrals (hue 220-222), never pure/cool grays
- /home tokens centralized in `:root` CSS variables in `src/home/index.html`
- Legacy /coaches still uses #4A90D9 / #2B5EA7 (not yet migrated)
- Mantra logo at `brand/mantra-logo.png`
- Clean, minimal, premium dark design

## Page Architecture

### /home (Landing Page 2.2 — Convergence Hero)
- **GSAP 3.12.5 + ScrollTrigger** (CDN). No SplitType.
- 7-section story arc: Hero → Definition (split-screen agent-at-work) → Vignettes (kinetic word cloud) → Emergence → Acceleration → Trust → Close/CTA
- **Hero**: Oversized clamp-based type (`clamp(3rem, 9vw, 10rem)`, line-height 0.95, letter-spacing -0.03em) + canvas convergence visual (scattered particles/icons + curved radiating lines → single blue glow point, scroll-linked convergence progression)
- 3-layer parallax system on non-hero sections: bg-layer (0.3×), mid-layer (0.6×), section-content (1.0×) via GSAP ScrollTrigger scrub
- Ambient gradient blobs (6 remaining) with radial-gradient + CSS blur, no canvas/SVG (hero uses canvas)
- Full-page grain texture overlay (SVG data URI, CSS-tiled)
- Kinetic word cloud replaces fake product UI vignettes — NO invented UI anywhere
- Entrance choreography: hero timeline on load, scroll-triggered one-shot reveals per section
- `prefers-reduced-motion` fallback: canvas draws static composed state, GSAP animations disabled
- Mobile: reduced particle/line density, headline scales via clamp
- CTA constant: `https://mono-prod-8d22.up.railway.app/start?source=lightway`

### /home_v2 (Neural Hyperspace Visual Prototype)
- Standalone Three.js-only visual route; does not modify or share state with `/home`
- Pinned Three.js ES modules from jsDelivr; no framework or bundler dependency
- `NeuralWorld` owns one coherent scene with distinct primary hubs, secondary shells, GPU micro-nodes, local arcs, cross-cluster highways, pulse packets, velocity streaks, and a radial destination atmosphere
- Hubs use front/back Fresnel glass-shell passes with broad volume falloff and no internal core particles; connectors use dynamically batched tube surfaces that are thick at sphere membranes and narrow through the middle; nodes and pulses remain instanced
- The default state is a locked three-hub composition: time may breathe shells, drift anchors subtly, and move pulse packets, but must not materially change camera-relative spacing
- Connector tendrils terminate outside sphere membranes, widen at both membrane roots, and narrow through the middle; no connector geometry may target or visibly penetrate a sphere center
- Hub-to-hub, local, and free-ended dendrite tendrils remain visible at every scroll level; velocity streaks add motion but never replace the neural connection graph
- Camera pose is scroll-owned only; pointer and tap input never alter framing, rotation, or parallax
- Neural shells, satellites, tendrils, pulses, particles, and streaks use the darkest CTA-blue family rather than pearl-white; traveling pulses follow shell-to-shell surface curves and dissolve at both membranes
- Hub-centered ellipsoidal 3D cloud volumes and sparse interstitial dust use instanced camera-facing billboard quads with uncapped perspective scale, randomized size/rotation/opacity, and procedural noisy multi-lobed silhouettes; they share the connected neural world transform; WebGL point sprites, background fog passes, and haze cards are forbidden
- The neural graph advances as one connected world and recycles only after the full connected-graph bound (shells, satellites, dendrite terminals, and highway controls) clears behind the camera; never wrap individual hubs while their tendrils or neighboring nodes remain visible
- Dynamic connection systems remain `frustumCulled=false` and rely on native per-triangle GPU clipping; source-shell visibility must never cull a still-visible tendril or highway
- Continuous graph travel uses one topology/state model rendered in two shared-buffer cycle instances; the trailing instance fills the recycle boundary without duplicating simulation state or exposing an empty gap
- Scroll releases additional hubs, satellites, micro-nodes, connectors, camera travel, velocity, bloom, and white arrival
- Caps DPR at 1.5, pauses when hidden, handles WebGL context loss, and honors reduced motion

### /home_v3 (Narrative Landing Experience)
- Independent evolution of the corrected `/home_v2` Three.js scene; v2 remains live and byte-frozen during v3 work
- Owns separate `index.html` and `neural-hyperspace.js` files so section states, copy, foreground layout, and pulse choreography evolve without regressing v2
- Full-height narrative sections carry explicit `data-scene-progress` anchors; the nearest narrative section owns the exact background state, with native proximity settling on desktop and mandatory one-section settling on mobile; mobile sections use `scroll-snap-stop: always`, every mobile narrative beat is exactly one snapport tall so one deliberate swipe advances one section; no wheel/touch input is intercepted
- Foreground story uses restrained alternating glass cards over the fixed WebGL world; HTML owns copy/accessibility and Three.js owns atmosphere
- V3 pulse packets use five closely spaced beads; destination hubs flash white only when the pulse head completes the shell-to-shell curve and crosses the destination membrane; V2 retains its original three-bead packet
- Cascade pulses: highway collision spawns child pulses from hub to visible satellites; satellite shells flash on cascade arrival via `satelliteImpact` attribute
- V3 hub impacts emit 1–3 child signals total; bounded terminal-growth signals fire every 2–4 eligible visible hub impacts, reserve a unique free dendrite, travel its live curve, and grow a persistent child hub at the tip
- Each terminal branch owns one canonical child-hub geometry contract (center, grown radius, incoming tangent, and membrane contact); shell and connector rendering must derive from it so a visible gap is structurally impossible
- Spawned child hubs emit 2–3 stable one-sided tapered dendrites from their own membrane; child topology is generated once and rendered from the parent branch state, never regenerated per frame
- V3 dynamic connector tubes use 8 radial segments; free dendrites stay pointed until terminal growth creates a child membrane
- Velocity-aware spawn distance: `effectiveCycleDistance` scales the static `worldCycleDistance` by `1 + smoothstep(0.1, 0.75, progress) * 1.5` so neural structures recycle farther from camera at high scroll speeds
- V3 uses one mobile-derived population budget on every viewport while retaining the complete feature set: hub shells, satellites, fog clouds, connected tendrils, free dendrites, pulse packets, and hyperspace streaks
- Responsive branches may change camera framing and foreground layout only; neural population counts and feature lifecycle remain unified

### /home_v4 (Retreat Neural Narrative)
- Independent copy of locked `/home_v3`; `/home_v2` and `/home_v3` remain byte-frozen while V4 evolves.
- V4 preserves V3's kinetic equation, camera framing, main-tunnel population budget, and snap behavior; the baseline world-travel vector is reversed so acceleration carries the connected field away from the camera. V4 owns its foreground story, currently Hero → Action strip → Continuity → Compounding → Ambient → blank exit trigger.
- Reversed lifecycle boundaries are geometry-owned. Shared shell/tendril visibility never derives from only the primary cycle instance; each rendered primary or replica instance fades from its own view depth after its complete geometry clears the frustum.
- Micro-nodes, low-fidelity outer-shell nodes, and fog clouds wrap independently through one reversed cycle distance and fade to zero on both sides of their own wrap boundary. Global modulo resets and progress-owned density dropouts are forbidden.
- The authored tunnel closes its first major depth interval gradually. A low-detail, bounded outer spherical shell sits beyond the main tunnel and enters the frustum through perspective as reverse travel accumulates; it extends context without becoming a second simulation or obscuring foreground copy.
- The white arrival is a discrete, time-owned hyperspace exit. Final-section scroll entry and CTA clicks cross one replay-safe `triggerExit()` boundary. When the opaque frame lands, one terminal fork is resolved from live input state: Space held opens the public looping `/visualizer`; when Space is not held, the exit opens `/start`. The blank terminal contains no foreground copy or CTA, and navigation waits until after the white frame paints.
- The bounded outer shell visibly grows with story intensity: later-ranked nodes begin farther beyond the frustum and pull inward toward a broader sphere as retreat and exit progress increase.
- Browser history traversal always restarts V4 from the top. Scroll restoration is manual, and a back-forward-cache restore reloads the document so terminal animation and generated world state cannot replay into another fork navigation.

### /coaches
- Uses GSAP + ScrollTrigger + SplitType (CDN)
- Uses shared styles.css reveal system
