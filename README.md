# How Patchwork++ Works

An interactive, step-by-step walkthrough of **Patchwork++**, the LiDAR ground-segmentation
algorithm from [Lee, Lim & Myung (IROS 2022)](https://arxiv.org/abs/2207.11919) — built with
Three.js and Vite.

The algorithm is not pre-baked into an animation. A faithful TypeScript port runs live in the
browser on a real KITTI scan, records every intermediate result, and the twelve tutorial stages
replay those results: the actual seed points, the actual plane from each PCA iteration, the
actual eigenvalues the classifier tested.

```
npm install
npm run dev
```

## What it covers

| #   | Stage                       | What you see                                                                 |
| --- | --------------------------- | ---------------------------------------------------------------------------- |
| 1   | One LiDAR scan              | 123,924 points from a Velodyne HDL-64E, coloured by height                   |
| 2   | Why one plane is not enough | A single global plane fit, and the road it throws away                       |
| 3   | RNR                         | Reflected noise: the mirror-image points hiding below the road               |
| 4   | CZM                         | The Concentric Zone Model — 504 cells, sized to the sensor's density falloff |
| 5   | Seeds                       | Sorting a cell by height, the Lowest Point Representative, the seed band     |
| 6   | R-GPF                       | Three PCA refinements turning seeds into a ground plane                      |
| 7   | R-VPF                       | Peeling a vertical structure away so the ground on top of it survives        |
| 8   | GLE                         | Uprightness, elevation and flatness, each shown on a cell that fails it      |
| 9   | 504 cells                   | The whole sweep, judged ring by ring                                         |
| 10  | TGR                         | A borderline cell getting a second hearing against its own ring              |
| 11  | A-GLE                       | The thresholds — and the sensor height — being measured rather than set      |
| 12  | The result                  | Ground vs not-ground, against the strawman from step 2                       |

Each stage zooms into a real cell, narrates what happens there, and pulls back to the whole
scene. **Continue** advances (and skips to the end of a stage still playing), **Replay**
rebuilds the current stage from scratch, and the speed control scales the whole timeline.
Keyboard: `→`/`space` continue, `←` back, `R` replay. Drag to orbit at any time.

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
npm run verify
```

Two things at once. It checks the implementation against an independent NumPy port of the
same reference C++ (`reference/patchworkpp_prototype.py`) — both agree exactly on
ground/non-ground counts, RNR removals, fitted cells, definite-ground cells, TGR candidates
and reverts across all six sample frames. And it prints a **digest**: a hash over every
point's label and every cell's intermediates, so a refactor can be shown to have changed
nothing. The current digest is `3e06cc1cd8b505c7e238bf8e1939ebbb`; if your change was meant
to be behaviour-neutral and that number moves, it was not.

## Data

`public/data/*.bin` are six KITTI Velodyne scans, redistributed from the
[Patchwork++ reference implementation](https://github.com/url-kaist/patchwork-plusplus)
(BSD-2-Clause), which ships them as demo data. Raw little-endian `float32`, four values per
point — `x, y, z, intensity` — in the sensor frame: x forward, y left, z up. See
`public/data/README.md` for attribution.

The tutorial runs on frame 5, which is the one that exercises every module from a cold start:
it contains reflected noise, a cell where the ground sits on a structure, and a cell that only
TGR resolves.

## Deploying

Cloudflare, as a static site on Workers Static Assets — no Worker script, just the Vite build
served from the edge. `wrangler.jsonc` holds the config and `public/_headers` sets immutable
caching for the scans and the fingerprinted bundles.

```
npx wrangler login
npm run deploy        # build, then wrangler deploy
npm run preview:cf    # build, then serve it locally the way Cloudflare will
```

## Development

```
npm run dev           # dev server
npm run typecheck     # browser sources, then the Node scripts
npm run verify        # algorithm cross-check + behaviour digest
npm run build         # typecheck + production build
npm run format        # prettier
```

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
