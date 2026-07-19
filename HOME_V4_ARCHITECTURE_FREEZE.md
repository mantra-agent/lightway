# Home V4 Architecture Freeze

Date: 2026-07-19  
Branch: `feat/home-v4-retreat`  
Base commit: `99dea1431643` (`fix: make one mobile swipe advance exactly one V3 section (#114)`)  
Platform Environment: Mantra / Landing Page / live (#21), GitHub `mantra-agent/lightway`, branch `main`

## Required context loaded

- `AGENTS.md`: static Lightway site, pure `src/` file-copy build, page-specific HTML/JS, no framework or client router.
- `CODING.md`: no tests or typecheck-only gates; production verification is `npm run build`; PRs target `main`.
- `DESIGN.md`: dark premium Mantra design, restrained accent use, interface clarity from the user backward.
- Subdirectory `AGENTS.md`: none exist beyond root in this repo.

## Base verification

Current branch was created from `main` at `99dea1431643`, which is PR #114 or later:

```text
99dea14 fix: make one mobile swipe advance exactly one V3 section (#114)
9fbe4a9 feat: give V3 distinct Kodamai-style scroll sections (#113)
39b010c fix: attach terminal connectors and grow child hubs (#112)
c5abe2a fix: preserve neural connections through graph recycle (#111)
fd0d560 fix: make terminal child-neuron growth visible and bounded (#110)
```

## V3 byte-for-byte checksums

These files are the immutable V3 baseline. Any future V4 implementation must not edit them.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `src/home_v3/index.html` | 16,886 | `00059df5e8e163d229a701aacbc77e84be270dab2f9a06319d552a49024ee8ca` |
| `src/home_v3/neural-hyperspace.js` | 74,272 | `4db9752a4593125e0927d76a6bf31ef9b42fd1300b498e27a9b7bc30f19c120c` |

## Current V3 architecture evidence

V3 is a standalone route at `src/home_v3/`:

- `index.html` declares seven scroll narrative sections with `data-scene-progress` values `0`, `0.14`, `0.32`, `0.5`, `0.68`, `0.83`, and `1`.
- `index.html` imports `neural-hyperspace.js` as the page-specific renderer.
- `neural-hyperspace.js` owns all Three.js scene state locally: renderer, camera, composer, graph generation, scroll progress, wheel/touch snap behavior, and animation loop.
- The V3 graph implementation uses a forward conveyor/recycle model: `worldCycleDistance`, `connectedWorldTravel = travel % this.worldCycleDistance`, per-cluster `z = cluster.z + connectedWorldTravel`, and reset/re-entry semantics near the camera.
- Topology is already partially progress-gated through visibility helpers: `clusterVisibility`, `clusterConnectionVisibility`, `satelliteConnectionVisibility`, and section-derived `state.progress`.
- The camera begins near a central hub: `PerspectiveCamera(56, 1, 0.1, 150)` with `camera.position.set(-0.35, 0.15, 7.2)`.

GitNexus note: Code search was attempted against Home V3 graph terms but the index for Platform Environment 21 is not enabled and returned unrelated monorepo symbols. Direct repo inspection is the authoritative navigation evidence for this static site. Platform source binding confirms `codeIndexingEnabled: false`.

## V4 implementation design

### Route boundary

Create a new independent route by copying V3 byte-for-byte first:

```text
src/home_v4/index.html
src/home_v4/neural-hyperspace.js
```

Then update only the V4 copies. V3 remains immutable. No shared mutable module is introduced in this step because the product goal is a safe retreat fork, not deduplication. The static build copies every `src/` directory, so `/home_v4/` becomes routable without build-system changes.

### Narrative contract

V4 keeps the seven-section landing-story contract and the section `data-scene-progress` source of truth. The story still scrolls section-by-section, but graph topology responds to section progress rather than appearing as an object stream moving past the camera.

The V4 visual metaphor is retreat and revelation:

1. Start close enough to feel an intelligence kernel.
2. Camera retreats backward from the central hub.
3. Nearby graph structure stabilizes instead of recycling forward.
4. Each section reveals another topology shell: core, first links, local satellites, grouped neighborhoods, cross-links, peripheral clusters, full system context.
5. Final CTA sees a coherent intelligence graph, not a conveyor.

### Graph model changes

Remove forward conveyor/recycle semantics from the connected graph:

- Eliminate modulo travel for connected graph placement.
- Replace `connectedWorldTravel = travel % worldCycleDistance` with a bounded retreat/reveal scalar derived from scroll progress.
- Keep ambient shimmer, fog, pulse, and small local drift, but remove world re-entry/cycle behavior for hubs, satellites, terminal children, and connection curves.
- Treat cluster base positions as stable world anchors. Section progress controls opacity, scale, link draw, and shell participation.

Progressive reveal should be expressed as named thresholds, not scattered magic numbers. Proposed structural contract:

```js
const REVEAL_PHASES = [
  { key: 'core', start: 0.00 },
  { key: 'firstLinks', start: 0.12 },
  { key: 'satellites', start: 0.28 },
  { key: 'neighborhoods', start: 0.45 },
  { key: 'crossLinks', start: 0.62 },
  { key: 'periphery', start: 0.78 },
  { key: 'wholeGraph', start: 0.92 },
];
```

A helper such as `revealAmount(key, progress)` should become the single source of truth for section-driven topology visibility.

### Camera model changes

V4 camera should retreat from the near hub instead of staying near a conveyor path:

- Start: close framing on the central hub, with shallow context.
- Middle: pull back and slightly rise/rotate to show neighborhoods.
- End: wider orbit/focal length that frames the whole revealed graph.
- Camera position should be a pure function of normalized progress plus gentle time-based breathing. It must not depend on recycled world travel.

Proposed contract:

```js
function cameraPoseForProgress(progress, elapsed) {
  const retreat = ease(progress);
  return {
    position: new THREE.Vector3(
      lerp(-0.25, -2.2, retreat),
      lerp(0.12, 1.35, retreat),
      lerp(4.4, 15.5, retreat),
    ),
    target: new THREE.Vector3(
      lerp(0.0, -0.45, retreat),
      lerp(0.0, 0.32, retreat),
      lerp(0.0, -1.8, retreat),
    ),
  };
}
```

Exact values may be tuned in implementation, but the invariant is stable: scroll progress moves the camera away from the graph, never moves the graph past the camera.

### Section-to-topology mapping

| Section progress | Visual topology |
| ---: | --- |
| `0.00` | Core hub, intimate local glow, minimal visible edges. |
| `0.14` | First connected links appear around the core. |
| `0.32` | Satellites and local memory/commitment nodes resolve. |
| `0.50` | Grouped neighborhoods become legible. |
| `0.68` | Cross-neighborhood bridges and long edges draw in. |
| `0.83` | Peripheral clusters and terminal child growth appear. |
| `1.00` | Full graph is visible, calm, coherent, and CTA-safe. |

### Engineering Principles audit

- **Single Source of Truth:** V4 should preserve `data-scene-progress` as the narrative progress source. Topology reveal must derive from a single `revealAmount`/phase table, not independent ad hoc thresholds across render paths.
- **Modular Systems:** Keep V4 self-contained in `src/home_v4/`. Do not alter `/home_v3/`, shared site styles, or build scripts unless implementation proves routing requires it.
- **Encode Invariants in Structure:** Immutable V3 is protected by route fork and checksums. Retreat-over-conveyor is protected by removing modulo travel from connected graph placement, not by adding a guard that hides the recycle.
- **Minimum Viable Protocol:** Copy V3 and modify the V4 copy. Avoid premature abstraction between V3 and V4 while the retreat concept is still being tuned.
- **Names Are Interfaces:** Rename conveyor/cycle concepts in V4 to retreat/reveal concepts during implementation so future readers do not preserve the wrong mental model.
- **Design From the User Backward:** The graph should communicate an expanding intelligence context tied to the story sections. Motion must feel premium and legible, not mechanically busy.
- **No Premature Optimization:** Keep the existing instanced rendering and postprocessing unless a specific V4 visual requirement forces a change.

## Impact boundary

Expected touched files for implementation steps after this freeze:

- Add `src/home_v4/index.html`.
- Add `src/home_v4/neural-hyperspace.js`.
- Optional only if navigation/root routing explicitly requires surfacing V4: update `src/index.html` or documentation. Not needed for direct `/home_v4/` route because the static build copies `src/`.

No database, server, auth, or multi-user ownership paths are involved.
