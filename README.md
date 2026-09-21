# How Patchwork++ Works

An interactive, step-by-step walkthrough of **Patchwork++**, the LiDAR ground-segmentation
algorithm from [Lee, Lim & Myung (IROS 2022)](https://arxiv.org/abs/2207.11919) — built with
Three.js and Vite.

The algorithm is not pre-baked into an animation. A faithful TypeScript port runs live in the
browser on a real KITTI scan, records every intermediate result, and the twelve tutorial stages
replay those results: the actual seed points, the actual plane from each PCA iteration, the
actual eigenvalues the classifier tested.

```
pnpm install
pnpm dev
```

## What it covers

| #   | Stage                | What you see                                                                 |
| --- | -------------------- | ---------------------------------------------------------------------------- |
| 1   | How the scan is made | One pulse timed to a real return, then the fan, then a full turn             |
| 2   | One LiDAR scan       | 123,924 points from a Velodyne HDL-64E, unlabelled and unsorted              |
| 3   | RNR                  | Reflected noise: the mirror-image points hiding below the road               |
| 4   | CZM                  | The Concentric Zone Model — 504 cells, sized to the sensor's density falloff |
| 5   | Seeds                | Sorting a cell by height, the Lowest Point Representative, the seed band     |
| 6   | R-GPF                | Three PCA refinements turning seeds into a ground plane                      |
| 7   | R-VPF                | Peeling a vertical structure away so the ground on top of it survives        |
| 8   | GLE                  | Uprightness, elevation and flatness, each shown on a cell that fails it      |
| 9   | 504 cells            | The whole sweep, judged ring by ring                                         |
| 10  | TGR                  | A borderline cell getting a second hearing against its own ring              |
| 11  | A-GLE                | The thresholds — and the sensor height — being measured rather than set      |
| 12  | The result           | Ground vs not-ground, against the one-plane strawman it replaces             |

Each stage zooms into a real cell, narrates what happens there, and pulls back to the whole
scene. A **step rail** across the top stays on screen the whole time with the live pipeline
step lit, so "where are we" never has to be inferred.

The raw scan is one neutral colour, never a height ramp: a ramp bands the cloud into road,
cars and walls, so the reader would arrive at step 1 holding the answer the next eleven
stages are supposed to earn.

Structures are _built_, not faded in. The scan itself is built the way the sensor builds it:
a single pulse goes out, its echo comes back, and the range that falls out of the round trip
becomes one point — then sixteen of the sixty-four lasers fan out, the head turns, and the
sweep lays the cloud down behind it, every beam ending on a real return. The Concentric Zone Model is drawn the way the sensor
draws a scan: a hand sweeps round from straight ahead, the ring arcs trail behind it, and each
sector spoke appears as the sweep crosses it — zone by zone, inner to outer. Plane fits tween
between iterations, so R-GPF is seen to settle onto the road and R-VPF's plane is seen to
stand up as the wall is peeled away, rather than cutting between states.

**Continue** advances (and skips to the end of a stage still playing), **Replay** rebuilds the
current stage from scratch, and the speed control scales the whole timeline. Keyboard:
`→`/`space` continue, `←` back, `R` replay. Drag to orbit at any time. Every stage is
linkable — `/#gle` opens Ground Likelihood Estimation directly.

## Colour, and why there are only three of them

Three colours carry meaning, ever: **ground**, **not ground**, and **focus** — whatever the
current step is singling out (noise, seeds, peeled points, an undecided cell). Everything else
on screen is scaffolding: planes, seed bands, normals, grid. Unclassified returns get a fourth,
deliberately opinionless ink — one neutral colour, nudged ±20% by return strength so surfaces
still read in 3D, and nothing else.

That is not a style choice. A point cloud is a scatter form, so any two classes can end up
side by side, which means the palette has to clear the _all-pairs_ colour-blindness gate. Four
simultaneous hues cannot — measured, not assumed — and the obvious green/red for
ground vs not-ground scored ΔE 7.9 under deuteranopia, the classic red/green trap, on the
single most important distinction in the whole visualisation.

So each theme is three validated hues, checked for OKLCH lightness band, chroma floor, CVD
separation under simulated protanopia and deuteranopia, normal-vision separation, and contrast
against its own surface:

| Theme                | Surface     | worst CVD ΔE | worst normal ΔE |
| -------------------- | ----------- | ------------ | --------------- |
| **Signal** (default) | near-black  | 9.4          | 24.6            |
| **Ultraviolet**      | deep violet | 13.2         | 19.3            |
| **Daylight**         | light       | 9.2          | 27.6 ¹          |

¹ Daylight's aqua sits at 2.74:1 on its surface; the always-visible legend, which names every
class in text, is the relief channel that permits it. Never colour alone.

The numbers and the reasoning live in `src/viz/themes.ts`. Themes are switched from the top
bar and remembered per browser.

## On a phone

Yes. The bands (title, step rail, legend, scene, narration, transport) reflow: the legend
keeps its swatches and drops its explanations to stay one line, the primary action gets its
own full-width row, and the camera trades vertical field of view for horizontal on portrait
aspects — without that, poses framed for a wide screen crop the subject off the sides. The
rendered frame is also lifted on portrait, so the subject sits where the bands do not cover.

One finger turns the scene, two fingers zoom and slide it, and touch devices are told so
once. Scripted camera moves stand down the moment you take hold of the scene; **Recentre**
hands the camera back to the tour.

## The algorithm

`docs/patchwork-plusplus-guide.md` is the written companion: the full derivation, the lineage
from GPF (ICRA'17) through Patchwork (RA-L'21), the complete parameter table, the decision tree
as actually implemented, the places where the released code differs from the paper, and the
implementation gotchas.

### Where the code lives

Patchwork++ is strictly sequential, and the code is laid out that way: one module per step,
composed by one pipeline.

```
src/patchwork/
  steps/rnr.ts        1. drop mirror-reflection points that would poison the seeding
  steps/binning.ts    2. bin the cloud into the 504 Concentric Zone Model cells
  steps/seeds.ts      3. Lowest Point Representative — the deterministic seed set
  steps/rvpf.ts       4. peel vertical structure so ground resting on it survives
  steps/rgpf.ts       5. three PCA refinements -> the cell's ground plane
  steps/gle.ts        6. veto: uprightness, elevation, flatness
  steps/tgr.ts        7. re-hear borderline cells against their own ring
  steps/agle.ts       8. measure next frame's thresholds and the sensor height
  steps/index.ts      the running order, as data (PIPELINE_STEPS)
  pipeline.ts         composes exactly those, in exactly that order
  trace.ts            what it records; czm.ts, params.ts, state.ts, labels.ts
  index.ts            the public surface — `segmentGround` plus its vocabulary

src/core/linalg.ts    closed-form symmetric 3x3 eigensolver + PCA plane fit
src/core/kitti.ts     scan parsing (no browser APIs, so Node can run it)
src/tutorial/         the twelve tutorial stages
src/viz/              renderer, point cloud, cell gizmos, camera rig
src/anim/timeline.ts  the keyframe engine the stages are written against
```

Each step module is independently readable and independently testable: it takes what it needs,
returns what it produced, and mutates nothing it was not handed. The only shared mutable thing
is `AdaptiveState`, and only A-GLE writes to it.

`segmentGround()` returns a `FrameTrace` holding, per cell: the sorted point indices, the seed
count and LPR height, each R-VPF pass with the points it peeled, each R-GPF iteration with its
plane and accepted set, the GLE verdict with all five measured quantities, the TGR
probabilities, and a per-step timing breakdown. The visualisation reads that trace; it never
recomputes anything.

### Verification

```
pnpm verify
```

Two things at once. It checks the implementation against an independent NumPy port of the
same reference C++ (`reference/patchworkpp_prototype.py`) — both agree exactly on
ground/non-ground counts, RNR removals, fitted cells, definite-ground cells, TGR candidates
and reverts across all six sample frames. And it prints a **digest**: a hash over every
point's label and every cell's intermediates, so a refactor can be shown to have changed
nothing. The current digest is `3e06cc1cd8b505c7e238bf8e1939ebbb`; if your change was meant
to be behaviour-neutral and that number moves, it was not.

## Data

`data/raw/*.bin` are six KITTI Velodyne scans, redistributed from the
[Patchwork++ reference implementation](https://github.com/url-kaist/patchwork-plusplus)
(BSD-2-Clause), which ships them as demo data. Raw little-endian `float32`, four values per
point — `x, y, z, intensity` — in the sensor frame: x forward, y left, z up. See
`data/raw/README.md` for attribution.

They are not served. What ships is `public/data/*.pcq`, the same scans quantized by
`pnpm run data:quantize`: 16-bit fixed-point positions at 2.5 mm and one byte of intensity,
7 bytes a point against KITTI's 16. That is 1.99 MB → 0.87 MB per scan for a worst-case
position error of 1.25 mm, an eighth of what the sensor itself resolves. The verification
script hashes the quantized files, so the digest covers exactly what the browser is handed.

The tutorial runs on frame 5, which is the one that exercises every module from a cold start:
it contains reflected noise, a cell where the ground sits on a structure, and a cell that only
TGR resolves.

## Deploying

Cloudflare, as a static site on Workers Static Assets — no Worker script, just the Vite build
served from the edge. `wrangler.jsonc` holds the config and `public/_headers` sets immutable
caching for the scans and the fingerprinted bundles.

```
pnpm exec wrangler login
pnpm deploy          # build + deploy to production
pnpm preview:cf      # serve it locally the way Cloudflare will
pnpm preview:upload  # upload a version — preview URL, production untouched
```

The Cloudflare project (**Workers & Pages → segmentation**) is connected to this repo and
owns the build, so there is no token in CI and no deploy step in the workflows — the same
setup as the other sites in this account:

| Setting           | Value                                        |
| ----------------- | -------------------------------------------- |
| Build command     | `pnpm build`                                 |
| Deploy command    | `npx wrangler deploy`                        |
| Version command   | `npx wrangler versions upload`               |
| Production branch | `main`, with non-production branch builds on |

Because the project runs the build itself, `wrangler.jsonc` deliberately has **no**
`build.command`; that would build a second time inside `wrangler deploy`. The config is the
three keys the other repos use — name, compatibility date, assets — and nothing else.

Workers Builds reports each preview URL in the **check run summary** on the PR, not as a
comment (commenting is a Pages behaviour).

## Development

```
pnpm dev           # dev server
pnpm typecheck     # app, Node scripts, and tests
pnpm verify        # algorithm cross-check + behaviour digest
pnpm test          # Playwright, desktop + mobile
pnpm build         # typecheck + production build
pnpm format        # prettier
```

### Tests

`tests/tutorial.spec.ts` drives the real app in a real browser — it is a WebGL page, so
there is no useful unit-level substitute. It runs under two projects, desktop and a
390×844 phone, and covers: the app loading and actually segmenting the scan (asserted via
the live point count in the caption), walking all twelve stages with zero console errors,
Continue's finish-then-advance behaviour, Replay, Back, the speed control, deep links, the
step rail lighting the right steps, theme switching and persistence, every theme keeping its
three slots distinct, nothing overflowing the viewport, the transport staying on screen with
tappable targets, the page being usable while the scan is still downloading, a drag taking
the camera from the tour, the gesture hint, and the legend sitting above the scene.

CI (`.github/workflows/ci.yml`) runs typecheck, format check and the algorithm digest in one
job, and the two Playwright projects in a matrix. If a sandbox already ships a Chromium, set
`CHROMIUM_PATH` and Playwright will use it instead of downloading one.

`scripts/screenshot.mjs` walks every stage in headless Chromium and writes a screenshot per
stage, for checking the visuals without a display. It needs Playwright, which is deliberately
not a dependency:

```
npm i -D playwright && node scripts/screenshot.mjs ./shots
```

## Credits

- **Patchwork++** — S. Lee\*, H. Lim\*, H. Myung, _"Patchwork++: Fast and Robust Ground
  Segmentation Solving Partial Under-Segmentation Using 3D Point Cloud"_, IROS 2022.
- **Patchwork** — H. Lim, M. Oh, H. Myung, RA-L 2021.
- **GPF** — D. Zermas, I. Izzat, N. Papanikolopoulos, ICRA 2017.
- **KITTI** — Geiger et al., CVPR 2012.

This is an independent explainer. It is not affiliated with the authors of Patchwork++.
