# Patchwork++ — A Comprehensive Guide

A from-first-principles walkthrough of the Patchwork++ ground-segmentation algorithm,
written as the reference document for the Three.js/Vite step-by-step tutorial.

Primary sources:

- **Patchwork++** — S. Lee\*, H. Lim\*, H. Myung, _"Patchwork++: Fast and Robust Ground
  Segmentation Solving Partial Under-Segmentation Using 3D Point Cloud"_, IROS 2022.
  [arXiv:2207.11919](https://arxiv.org/abs/2207.11919)
- **Patchwork** — H. Lim, M. Oh, H. Myung, _"Patchwork: Concentric Zone-based Region-wise
  Ground Segmentation with Ground Likelihood Estimation Using a 3D LiDAR Sensor"_, RA-L 2021.
  [arXiv:2108.05560](https://arxiv.org/abs/2108.05560)
- **GPF** — D. Zermas, I. Izzat, N. Papanikolopoulos, _"Fast segmentation of 3D point clouds:
  A paradigm on LiDAR data for autonomous vehicle applications"_, ICRA 2017.
- **R-GPF / ERASOR** — H. Lim, S. Hwang, H. Myung, _"ERASOR: Egocentric Ratio of Pseudo
  Occupancy-based Dynamic Object Removal"_, RA-L 2021.
- **Reference implementation** — [url-kaist/patchwork-plusplus](https://github.com/url-kaist/patchwork-plusplus)
  (BSD-2-Clause), `cpp/patchworkpp/{include,src}`.

Everything below has been cross-checked against the reference C++ implementation and verified
with an independent NumPy re-implementation run on the six KITTI scans shipped in that repo
(`data/raw/000000.bin` … `data/raw/000005.bin`). Where the code and the paper differ, both are given.

---

## 1. The problem

Given one LiDAR sweep `P = {p_1 … p_N}`, `p_k = (x_k, y_k, z_k)` in the sensor frame, label
every point as **ground** (road, parking, sidewalk, lane markings, other ground, terrain) or
**non-ground** (cars, buildings, people, poles, vegetation…).

The estimate `Ĝ` splits into true/false positives, and `N̂` into true/false negatives:

|                              | actually ground | actually non-ground |
| ---------------------------- | --------------- | ------------------- |
| **estimated ground `Ĝ`**     | TP              | FP                  |
| **estimated non-ground `N̂`** | FN              | TN                  |

Ground segmentation is almost always a _preprocessing_ stage — for clustering, detection,
traversability, or LiDAR odometry — so it has three hard requirements:

1. **Fast.** It must cost a small fraction of the 100 ms sensor period.
2. **Balanced.** High precision _and_ high recall, with low variance across scenes.
3. **Robust to non-flat ground.** Slopes, bumpy terrain, curbs, elevated ground.

The dominant failure mode is **under-segmentation**: real ground points are kept as
non-ground (false negatives), which downstream clustering then merges into giant phantom
objects. Patchwork++ exists almost entirely to kill the _partial_ form of this failure —
where most of the scan segments fine but a handful of bins fail.

### Why a single plane is not enough

Fit one plane to the whole scan (RANSAC, or PCA) and you assume the world is flat over an
80 m radius. It isn't. A 2° slope over 40 m is 1.4 m of error — larger than the whole
distance threshold budget. Hence: **fit many local planes**.

---

## 2. The lineage — four papers in one diagram

```
GPF (Zermas, ICRA'17)              R-GPF (ERASOR, RA-L'21)
  split cloud along x into            polar bins instead of x-strips;
  N segments; per segment:            per-bin GPF
    LPR seeds -> PCA plane                 |
    -> iterate 3x                          v
         |                          Patchwork (RA-L'21)
         +------------------------>   CZM bins + R-GPF + GLE
                                           |
                                           v
                                    Patchwork++ (IROS'22)
                                      + RNR, R-VPF, A-GLE, TGR
```

**GPF** contributed the core primitive that everything else reuses:

1. Sort points by `z`; take the `N_LPR` lowest and average their height → the _Lowest Point
   Representative_ (LPR).
2. Seeds = all points with `z < z_LPR + Th_seeds`. (Deterministic — no RANSAC sampling.)
3. Fit a plane to the seeds by PCA: normal = eigenvector of the smallest eigenvalue of the
   point covariance.
4. Re-select ground as points within `Th_dist` of the plane; refit. Repeat `N_iter` (=3) times.

This is ~10× cheaper than RANSAC because there is no random sampling loop. Its weakness is
that it is _only_ as good as its seeds: one spurious point below the road and the plane tips.

**R-GPF** (from ERASOR) moved GPF from x-strips to polar bins — the right shape for a
spinning LiDAR, whose point density falls off radially.

**Patchwork** added the two ideas that make polar-bin GPF actually work: the **Concentric
Zone Model** (bin sizes that match the density profile) and **Ground Likelihood Estimation**
(a per-bin sanity test that rejects planes fitted to car roofs and walls).

**Patchwork++** adds four modules — RNR, R-VPF, A-GLE, TGR — that attack the specific
remaining failure cases, and makes the whole thing _self-tuning_.

---

## 3. Pipeline overview

```
raw scan (x, y, z, intensity)
      |
      v
 [0] RNR    — reflected noise removal        (drop mirror-image points below the road)
      |
      v
 [1] CZM    — bin the cloud into 504 polar patches
      |
      v   for each patch, in ring order:
      |
 [2] sort patch by z, pick seeds  (LPR)
      |
 [3] R-VPF  — peel off vertical structure (walls/curbs) hiding under the ground
      |
 [4] R-GPF  — fit the local ground plane, 3 PCA iterations
      |
 [5] GLE    — is this plane really ground? (uprightness / elevation / flatness)
      |            |
      |            +--> "maybe" ---> [6] TGR — second chance vs this frame's statistics
      v
 [7] A-GLE  — update elevation/flatness/sensor-height thresholds from this frame
      |
      v
 ground / non-ground point sets
```

Steps 0–6 run per scan; step 7 feeds the _next_ scan. That feedback loop is what makes
Patchwork++ "self-adaptive" — and it's the single most visually interesting thing to animate.

---

## 4. Step 0 — RNR: Reflected Noise Removal

### The problem

LiDAR beams that hit a mirror-like surface (a car bonnet, a roof, glass) bounce, travel
further, and return late. The sensor reports the point along the _outgoing_ ray direction at
the _total_ path length — producing a **virtual point below the actual road surface**.

That is catastrophic for GPF-style seeding, because seeds are "the lowest points in the bin".
A single virtual point 3 m under the road drags the seed set down, tips the fitted plane, and
the entire bin under-segments.

### The old fix, and why it's bad

Patchwork just dropped everything with `z < z_min` (a fixed floor). On a downhill this deletes
_real_ ground — the road legitimately goes below the threshold — producing a band of false
negatives exactly where you need the ground most.

### The Patchwork++ fix

Two physical observations (following Zhao et al., SSRR 2020):

1. Reflected points come from **low-elevation rays** (small incident angle → the virtual point
   lands far below). So only the bottom rings can produce them.
2. Reflected rays undergo **one extra bounce**, so they return with **lower intensity**.

So RNR rejects a point only if _all three_ hold:

```
vertical_angle(p) < RNR_ver_angle_thr        (-15°, i.e. bottom rings only)
z(p)              < -sensor_height - 0.8     (well below the road)
intensity(p)      < RNR_intensity_thr        (0.2 — dim, so probably a double bounce)
```

where `vertical_angle = atan2(z, sqrt(x² + y²))`.

Crucially `sensor_height` is **not** a constant — A-GLE re-estimates it every frame from the
measured ground elevation of the innermost ring (§8). So the "floor" tracks the real road and
follows you downhill. In the paper this is written as an adaptive `h_noise ← mean(E_1) + δ`
with `δ < 0`; in the code the same thing is expressed as `sensor_height ← -mean(E_1)` with a
fixed `-0.8` margin.

The paper describes the ring test as "check the bottom `N_noise = 20` rings"; the released
code uses the equivalent vertical-angle test, which does not require ring indices in the input.

> **Measured:** on KITTI `000000.bin` this removes **1 point out of 124,668** — and on frames
> 1–5, between 2 and 5. RNR is a scalpel, not a filter. Its value is that each removed point
> would have wrecked an entire bin.

---

## 5. Step 1 — CZM: the Concentric Zone Model

### Why not a uniform polar grid?

A spinning LiDAR's point density falls off roughly as `1/r²`. With uniform polar bins
(`N_r × N_θ` over the full range) you get two opposite failures:

- **Sparsity issue** (far away): bins contain 3–4 points. PCA on 4 points gives a meaningless
  normal, so distant ground is rejected.
- **Representability issue** (close in): bins are a few cm across. The patch is smaller than
  the road's texture, so again the normal is noise.

Adaptive schemes that grow bin size linearly or quadratically help, but never fully fix it.
And empirically (the CDF in the Patchwork paper), **>90% of ground points lie within 20 m** —
so that's where the resolution belongs.

### The model

Split the annulus `[L_min, L_max]` into **four zones**, each with its own ring count, sector
count, and therefore its own bin shape:

| Zone | Name    | Radial range (m) | Rings | Sectors | Ring width (m) | Sector width |
| ---- | ------- | ---------------- | ----- | ------- | -------------- | ------------ |
| Z1   | central | 2.7 – 12.3625    | 2     | 16      | 4.831          | 22.5°        |
| Z2   | quarter | 12.3625 – 22.025 | 4     | 32      | 2.416          | 11.25°       |
| Z3   | half    | 22.025 – 41.35   | 4     | 54      | 4.831          | 6.67°        |
| Z4   | outer   | 41.35 – 80.0     | 4     | 32      | 9.663          | 11.25°       |

The zone boundaries are not arbitrary — they are fixed fractions of the range:

```
L_min,1 = L_min                      = 2.7
L_min,2 = (7·L_min + L_max) / 8      = 12.3625
L_min,3 = (3·L_min + L_max) / 4      = 22.025
L_min,4 = (L_min + L_max) / 2        = 41.35
```

Bin membership for a point with `ρ = √(x²+y²)`, `θ = atan2(y, x) ∈ [0, 2π)`:

```
S(i,j,m) = { p ∈ Z_m :  (i-1)·ΔL_m/N_r,m ≤ ρ - L_min,m < i·ΔL_m/N_r,m
                        (j-1)·2π/N_θ,m   ≤ θ         < j·2π/N_θ,m      }
```

Note the deliberate non-monotonicity: Z1 has **wide** bins (fight representability), Z2 and Z3
have **narrow** bins (dense data, fine resolution), Z4 has **wide** bins again (fight sparsity).
Z3 has the most sectors (54) because that's the sweet spot of density × area.

**Total: 2·16 + 4·32 + 4·54 + 4·32 = 504 bins**, versus 3,240 for the uniform grid the paper
compares against. Fewer bins, better conditioned — that's where the speed comes from.

Points with `ρ ≤ L_min` or `ρ > L_max` are immediately labeled non-ground (the near-field
hole under the vehicle, and everything past 80 m).

### The "concentric index"

Rings are processed in radial order and given a **global** index
`concentric_idx = 0, 1, 2, …, 13` across all four zones. The first
`num_rings_of_interest = 4` concentric rings — Z1's two rings plus Z2's first two, i.e.
**radius 2.7 m to 17.19 m** — are the only ones subject to the elevation and flatness tests
(§7) and the only ones that contribute to adaptive statistics. Beyond 17 m, an upright plane
is simply trusted.

---

## 6. Steps 2–4 — per-patch fitting

Everything from here runs independently per bin. Bins with fewer than
`num_min_pts = 10` points are entirely non-ground and skipped.

### 6.1 Sorting and seed selection

Sort the bin's points by `z` ascending. Then:

```
init_idx = 0
if zone == Z1:                                   # adaptive seed selection
    skip points with z < adaptive_seed_selection_margin · sensor_height   # -1.2 · 1.723 ≈ -2.07 m
z_LPR  = mean of the next num_lpr = 20 points' z
seeds  = { p in bin : z(p) < z_LPR + th_seeds }  # th_seeds = 0.125 m
```

The `init_idx` skip is Patchwork's **adaptive initial seed selection** — a second line of
defense against sub-ground outliers, applied only in Z1 because that's where reflections are
strong enough to occur. RNR (§4) is the more surgical version of the same idea; both are kept.

### 6.2 Plane fitting by PCA

Given a point set, compute the mean `p̄` and the 3×3 covariance `C`. Eigendecompose:

```
C v_α = λ_α v_α ,   λ_1 ≥ λ_2 ≥ λ_3
n = v_3            (eigenvector of the SMALLEST eigenvalue = surface normal)
d = -nᵀ p̄
```

Flip `n` so that `n_z ≥ 0`. Signed point-to-plane distance is then `dist(p) = nᵀp + d`.

Three eigenvalues, three meanings — remember these, the classifier uses all of them:

- `λ_1` — extent along the plane's longest direction
- `λ_2` — extent along the plane's second direction
- `λ_3` — **thickness perpendicular to the plane** → this is _flatness_
- `λ_1/λ_2` — _line variable_: large means the points form a line, not a surface

PCA is chosen over RANSAC because it is 2× faster and, on a small bin where most points
really are ground, accurate enough. Its known weakness — sensitivity to outliers — is what
RNR, adaptive seeding and R-VPF exist to neutralise.

### 6.3 R-VPF: Region-wise Vertical Plane Fitting

**The failure case.** The ground can sit _on top of_ a vertical structure: a retaining wall,
a low fence, a flower bed, a raised sidewalk. The wall's points have _lower_ `z` than the
elevated ground above it, so they win the seed selection, and the fitted "ground plane" ends
up as a tilted surface smeared across the wall. The real ground above is then rejected — a
textbook partial under-segmentation.

You might argue that elevated ground is non-ground. The authors' position: a person can stand
on it, so it's ground.

**The fix.** Before fitting the ground, _peel the vertical planes off_ the bin, up to
`K_v = 3` times:

1. Select seeds from the remaining points `P̂ᵏ` using a looser margin `th_seeds_v = 0.25`.
2. PCA → mean `mᵏ`, normal `v₃ᵏ`.
3. Take the points lying _in_ that plane:
   `Ŵᵏ = { p : |(p − mᵏ)·v₃ᵏ| < d_v }`, `d_v = th_dist_v = 0.1 m`.
4. Accept them as vertical only if the plane really is vertical:
   `V̂ᵏ = Ŵᵏ if π/2 − arccos(v₃ᵏ·u_z) < θ_v, else ∅`.
   In code the equivalent test is `n_z < uprightness_thr = 0.707` (i.e. the plane is tilted
   more than 45° from horizontal).
5. Remove `V̂ᵏ` from the bin (straight to non-ground) and repeat.

`V̂ = ⋃ₖ V̂ᵏ`. As soon as an iteration's plane _is_ upright, the loop breaks — the wall is gone
and what remains is ground. In the reference implementation R-VPF is applied **only in zone
Z1**, where the geometry actually occurs.

The side effect worth showing in the tutorial: after R-VPF the remaining bin is genuinely
planar, so its `λ_3` (flatness) collapses — which means the GLE flatness test now _also_
accepts it. One fix, two benefits.

> **Measured:** R-VPF is bursty — 0 points on frames 0, 1, 3, 4; then 2,465 points on frame 2
> and 1,615 on frame 5 of the sample sequence. Exactly the "occasional but fatal" profile.

### 6.4 R-GPF: Region-wise Ground Plane Fitting

Now the plain GPF loop on what R-VPF left behind:

```
seeds  = LPR seeds (th_seeds = 0.125)
n, d   = PCA(seeds)
repeat num_iter = 3 times:
    ground = { p in bin : nᵀp + d  <  th_dist }        # th_dist = 0.125 m
    n, d   = PCA(ground)
non_ground = bin \ ground
```

Note the distance test is **signed**, not absolute: points _below_ the plane are kept as
ground (they're road texture or slight dips), points _above_ by more than 12.5 cm are not.
On the final iteration the partition is written out; `Ĝ_n = Ĝ³_n`, as in GPF.

The output per bin is: a ground point set, a non-ground point set, and the plane's
`(n, d, p̄, λ₁, λ₂, λ₃)` — which feed the classifier next.

---

## 7. Step 5 — GLE → A-GLE: is this plane actually ground?

R-GPF _always_ returns a plane, even in a bin that contains nothing but a car roof. GLE is
the per-bin veto, and it's what lifts precision from R-GPF's 74.7% to Patchwork's 94.2%.

Patchwork formulated it as a likelihood, assuming bins are independent:

```
L(θ|X) = ∏ₙ f(Xₙ|θₙ),   f(Xₙ|θₙ) = φ(v₃,ₙ) · ψ(z̄ₙ, rₙ) · ϕ(ψ(·), σₙ)
Ĝ = ⋃ₙ [ f(Xₙ|θₙ) > 0.5 ] · Ĝₙ
```

with three factors:

**Uprightness `φ`** — the normal of real ground points up.

```
φ = 1  if  (v₃·ẑ)/‖v₃‖ > cos(π/2 − θ_τ),  else 0        θ_τ = 45°  ⇔  n_z > 0.707
```

This alone rejects walls and steeply tilted fits. It can't reject a car roof, which is
perfectly horizontal.

**Elevation `ψ`** — a horizontal plane 1.5 m above the road is a car roof, not ground.

```
ψ(z̄ₙ, rₙ) = (1 + exp(z̄ₙ − κ(rₙ)))⁻¹   if rₙ < L_τ
           = 1                          otherwise
```

`κ(r)` is an adaptive midpoint that grows with range: near the sensor, elevation is a sharp
discriminator (the PDFs of TP and FP `z̄` are well separated); far away they overlap, because
a high `z̄` might be a hill, so the test is disabled past `L_τ`. This is the origin of the
"rings of interest" idea — in Patchwork++ the test is simply

```
is_not_elevated = (concentric_idx < 4)  AND  (z̄ₙ < elevation_thr[concentric_idx])
```

**Flatness `ϕ`** — rescue the planes that elevation wrongly rejected. A steep but genuinely
smooth uphill has a high `z̄` yet is unmistakably a surface:

```
ϕ = ζ·exp(−(σₙ − σ_τ,ₘ))   if ψ < 0.5,   else 1          ζ > 1
```

In Patchwork++: `is_flat = flatness_n < flatness_thr[concentric_idx]`.

### The flatness definition changed

Patchwork used **local surface variation** `σₙ = λ₃/(λ₁+λ₂+λ₃)` (Weinmann et al.). Patchwork++
points out this is _inconsistent_: because CZM bins have different shapes and sizes, `λ₁` and
`λ₂` change with where the bin boundary falls even when the ground itself is identical, so the
normalised ratio moves for no physical reason. Patchwork++ therefore uses

```
f_n = λ₃
```

— the raw variance along the normal, i.e. the plane's physical thickness in m². That number
means the same thing in every bin.

### The actual decision tree (from the reference implementation)

Per bin, with `e_n = z̄_n` (elevation), `f_n = λ₃` (flatness), `u_n = n_z` (uprightness),
`heading = p̄ · n`, and `line_variable = λ₁/λ₂`:

```
is_upright        = u_n > 0.707
is_near_zone      = concentric_idx < 4
is_heading_outside= heading < 0                  # the plane sits below the sensor origin
is_not_elevated   = is_near_zone AND e_n < elevation_thr[concentric_idx]
is_flat           = is_near_zone AND f_n < flatness_thr[concentric_idx]

if   not is_upright          -> NON-GROUND        (wall, tilted junk)
elif not is_near_zone        -> GROUND            (>17 m: trust uprightness alone)
elif not is_heading_outside  -> NON-GROUND        (plane above the sensor: roof/bonnet)
elif is_not_elevated or is_flat -> GROUND
else                         -> TGR CANDIDATE     (§8 — second chance)
```

And in parallel, the **definite ground** set `D_m` used for learning:

```
if is_upright and is_not_elevated and is_near_zone:
     record e_n into E_m,  f_n into F_m           # m = concentric_idx
```

`D_m` is deliberately conservative. The paper measures it as **95.8% true ground**, covering
85.3% of all true ground points — clean enough to learn thresholds from.

---

## 8. Step 7 — A-GLE: learning the thresholds

In Patchwork, `elevation_thr` and `flatness_thr` were hand-tuned constants. The paper shows
(Fig. 6) that the true distributions of `e_n` and `f_n` differ substantially between urban,
highway and country scenes — so any fixed value is wrong somewhere. Tuning per scene is
exactly the laborious work the paper sets out to remove.

A-GLE fits them online from `D_m`, at the end of every frame:

```
elevation_thr[m] ← mean(E_m) + a_m · stdev(E_m)         a_m: 3 for m=0, 2 otherwise
flatness_thr[m]  ← mean(F_m) + b_m · stdev(F_m)         b_m = 1  (code)
sensor_height    ← -mean(E_0)                            → feeds RNR's floor
```

`E_m` and `F_m` are rolling buffers capped at `max_elevation_storage = max_flatness_storage
= 1000` samples. Initial values are `elevation_thr = flatness_thr = {0,0,0,0}`.

> **Paper vs code:** the paper specifies `b_m = 3` for `m = 1` and `2` otherwise; the released
> code uses `mean + 1·stdev` for every ring. The elevation gains match. Worth surfacing in the
> tutorial as a "what the shipped code actually does" note.

**The cold-start behaviour is worth animating.** On frame 0, `flatness_thr = 0`, so `is_flat`
is _never_ true, and `elevation_thr = 0`, so `is_not_elevated` just means "the plane's mean is
below the sensor" — which is true for essentially all real ground. So frame 0 is carried
almost entirely by uprightness + elevation, and TGR sees zero candidates. By frame 1 the
thresholds are real numbers and the full machinery engages.

> **Measured across the six sample frames:**
>
> | frame | ground | non-ground | definite-ground bins | TGR candidates | reverted | sensor_height |
> | ----- | ------ | ---------- | -------------------- | -------------- | -------- | ------------- |
> | 0     | 72,665 | 52,003     | 76                   | 0              | 0        | 1.723 (init)  |
> | 1     | 71,866 | 52,739     | 74                   | 5              | 1        | 1.763         |
> | 2     | 71,093 | 53,385     | 70                   | 3              | 0        | 1.762         |
> | 3     | 69,964 | 54,203     | 67                   | 5              | 0        | 1.756         |
> | 4     | 68,805 | 55,164     | 67                   | 5              | 0        | 1.750         |
> | 5     | 67,615 | 56,309     | 66                   | 3              | 0        | 1.748         |
>
> The self-estimated sensor height converges to ≈1.75 m against KITTI's nominal 1.723 m,
> and `elevation_thr` settles around −1.3 to −1.47 m — i.e. the algorithm discovers the road.

---

## 9. Step 6 — TGR: Temporal Ground Revert

A-GLE is a low-pass filter over time. That's the point — but it means a bin that is
_temporarily_ rough (grass, gravel, a bumpy verge) has `f_n` above a threshold learned from
hundreds of smooth frames, and gets rejected. Partial under-segmentation, again.

TGR is the coarse-to-fine second opinion: judge the borderline bin not against the _historical_
threshold but against **this frame's own ring statistics**.

For ring `m` at time `t`, using `F^t_m` = flatness of the definite-ground bins in this ring,
this frame:

```
f^t_τ,m = mean(F^t_m) + c_m · stdev(F^t_m)              c_m = 1.5
```

A candidate is reverted to ground if `f_n < f^t_τ,m`. The implementation softens this into two
probabilities:

```
μ  = mean(F^t_m) + 1.5·stdev(F^t_m)
p_flatness = 1 / (1 + exp( (f_n − μ) / (μ/10) ))        # smooth step around μ
if  |candidate| > 1500 points  and  f_n < th_dist²:     # 0.125² = 0.015625
        p_flatness = 1.0                                 # big and thin => definitely a surface
p_line     = 0  if  λ₁/λ₂ > 8   else 1                   # it's a line, not a plane => reject
revert  ⇔  p_line · p_flatness > 0.5
```

The `p_line` veto is important: a long thin strip of points (a curb edge, a guardrail seen
edge-on) has tiny `λ₃` and would sail through a pure flatness test. Requiring `λ₁/λ₂ ≤ 8`
demands the patch be two-dimensional.

TGR is the last stage; "ring statistics" are collected during that ring's sector loop, so TGR
runs once per ring, after its sectors are done.

**Effect (Table I):** recall 97.64% → 98.18% with precision 94.98% → 94.92%. Almost free recall.
It costs throughput though: 67.84 Hz without TGR, 54.85 Hz with.

---

## 10. Parameters — the complete table

| Parameter                                        | Value                  | Module        | Meaning                                                    |
| ------------------------------------------------ | ---------------------- | ------------- | ---------------------------------------------------------- |
| `sensor_height`                                  | 1.723 m                | global        | LiDAR height; **self-updated** by A-GLE                    |
| `min_range` / `max_range`                        | 2.7 / 80.0 m           | CZM           | valid annulus                                              |
| `num_zones`                                      | 4                      | CZM           | concentric zones                                           |
| `num_rings_each_zone`                            | {2, 4, 4, 4}           | CZM           | radial divisions per zone                                  |
| `num_sectors_each_zone`                          | {16, 32, 54, 32}       | CZM           | azimuthal divisions per zone                               |
| `num_rings_of_interest`                          | 4                      | GLE           | concentric rings where elevation/flatness apply (≤17.19 m) |
| `num_min_pts`                                    | 10                     | R-GPF         | below this, the whole bin is non-ground                    |
| `num_lpr`                                        | 20                     | seeds         | points averaged for the LPR                                |
| `th_seeds`                                       | 0.125 m                | R-GPF         | seed band above the LPR                                    |
| `th_dist`                                        | 0.125 m                | R-GPF         | ground plane thickness                                     |
| `num_iter`                                       | 3                      | R-GPF / R-VPF | refinement iterations                                      |
| `adaptive_seed_selection_margin`                 | −1.2                   | seeds         | skip points below −1.2·`sensor_height` (Z1)                |
| `uprightness_thr`                                | 0.707                  | GLE / R-VPF   | `n_z` threshold ⇔ 45°                                      |
| `th_seeds_v`                                     | 0.25 m                 | R-VPF         | seed band for vertical planes                              |
| `th_dist_v`                                      | 0.1 m                  | R-VPF         | vertical plane thickness                                   |
| `RNR_ver_angle_thr`                              | −15°                   | RNR           | only rays below this can be reflections                    |
| `RNR_intensity_thr`                              | 0.2                    | RNR           | reflections return dim                                     |
| `elevation_thr`                                  | {0,0,0,0} → learned    | A-GLE         | per-ring elevation ceiling                                 |
| `flatness_thr`                                   | {0,0,0,0} → learned    | A-GLE         | per-ring λ₃ ceiling                                        |
| `max_elevation_storage` / `max_flatness_storage` | 1000                   | A-GLE         | rolling window                                             |
| gains `a_m`                                      | 3 (m=0), 2 (else)      | A-GLE         | σ multiplier, elevation                                    |
| gains `b_m`                                      | 1 (code) / 3,2 (paper) | A-GLE         | σ multiplier, flatness                                     |
| gain `c_m`                                       | 1.5                    | TGR           | σ multiplier, per-frame flatness                           |
| line-variable veto                               | λ₁/λ₂ > 8              | TGR           | reject 1-D patches                                         |

---

## 11. Results, and where the wins come from

SemanticKITTI, all sequences (Patchwork++ Table I):

| Method              | Precision (%) | Recall (%)       | F1 (%)    |
| ------------------- | ------------- | ---------------- | --------- |
| LineFit             | 98.26 ± 1.35  | 87.88 ± 7.94     | 92.75     |
| RANSAC              | 89.87 ± 14.16 | 93.97 ± 13.16    | 91.83     |
| CascadedSeg         | 95.25 ± 7.88  | 74.53 ± 10.78    | 83.59     |
| GPF                 | 95.78 ± 3.76  | 83.89 ± 22.42    | 89.14     |
| R-GPF               | 74.68 ± 15.7  | **98.15 ± 1.47** | 84.52     |
| Patchwork           | 94.23 ± 3.96  | 97.62 ± 3.42     | 95.88     |
| Patchwork++ w/o TGR | 94.98 ± 3.44  | 97.64 ± 3.58     | 96.28     |
| **Patchwork++**     | 94.92 ± 3.50  | **98.18 ± 2.41** | **96.51** |

Read the table as a story: R-GPF has great recall and terrible precision (it accepts every
plane) → GLE fixes precision at a small recall cost → Patchwork++'s four modules recover that
recall without giving the precision back. Note also the **standard deviations**: Patchwork++
has the lowest recall variance of the robust methods, which is precisely the "no partial
failures" claim.

Speed on an i7-7700K, sequence 05 (Table II): Patchwork++ **54.85 Hz** vs Patchwork 43.97 Hz,
RANSAC 15.43 Hz. Faster _and_ better, mostly from one change: Patchwork sorted the entire
cloud by `z` before binning — `O(N log N)` — while Patchwork++ sorts **inside each bin**,
`O(L·M log M)` for `L` bins of `M` points, saving `L·M·log L`. The current repository reports
~110 Hz on KITTI after further optimisation.

---

## 12. Implementation notes & gotchas

Things that bite when you re-implement it (all learned by doing exactly that):

1. **`θ` must be in `[0, 2π)`**, not `atan2`'s `[−π, π]`, or sector indices go negative.
2. **The R-GPF distance test is signed** (`nᵀp + d < th_dist`), but **R-VPF's is absolute**
   (`|nᵀp + d| < th_dist_v`). Easy to copy the wrong one.
3. **Normal sign convention:** flip `n` so `n_z ≥ 0` _before_ using `n_z` as uprightness, or
   half your bins read as vertical.
4. **Eigenvalue ordering:** `eigh` returns ascending; flatness is the _smallest_ eigenvalue and
   the normal is _its_ eigenvector, while `line_variable = λ₁/λ₂` uses the two largest.
5. **`ringwise_flatness` must be cleared every ring**, not only when candidates exist — this
   was a real bug (issue #69 in the repo): a ring with no candidates leaked its statistics into
   the next ring's TGR.
6. **RNR marks, it doesn't delete:** flagged points get `z = FLT_MIN` and are skipped during
   binning, so indices stay aligned with the input cloud.
7. **`concentric_idx` is global across zones**, so "ring of interest 3" is Z2's ring 1, not
   Z4's ring 3.
8. **Everything is in the sensor frame.** The ground sits near `z ≈ −1.72`, not `z ≈ 0`.

### KITTI data format

Velodyne scans are raw `float32` little-endian, 4 values per point: `x, y, z, intensity`.
`intensity ∈ [0,1]`. A file of 1,994,688 bytes is 124,668 points. Axes: **x forward,
y left, z up**. The reference repo ships six frames (BSD-2-Clause) — enough for a tutorial,
and they avoid making users register for the KITTI download.

---

## 13. Storyboard for the Three.js tutorial

A proposed scene-by-scene breakdown. Each step is a camera pose + a colouring + a subset of
overlay geometry; transitions animate colour and opacity rather than teleporting.

| #   | Scene                | What's on screen                                                                | The transition into it                                                   |
| --- | -------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0   | **The scan**         | 124k points, coloured by height; sensor origin + axes                           | fade in, slow orbit                                                      |
| 1   | **The question**     | same points, ground-truth colouring (green/red)                                 | colour lerp                                                              |
| 2   | **Naive: one plane** | a single RANSAC plane + its errors in blue                                      | plane slides into place; FN points flash                                 |
| 3   | **RNR**              | zoom to a reflected point; show the ray, the bonnet, the virtual point          | camera dive; the noise point pulses then vanishes                        |
| 4   | **CZM**              | 504 wireframe bins drawn on the ground plane, zone-coloured                     | rings grow outward from the origin, one zone at a time                   |
| 4b  | **Why CZM**          | side-by-side ghost of the uniform grid; point-count heat map per bin            | cross-fade between grids                                                 |
| 5   | **One bin**          | isolate a single bin, points sorted by z, LPR band highlighted                  | camera flies into the bin; other bins fade to 5%                         |
| 6   | **R-GPF**            | seed points → plane quad → iterate 3×                                           | plane visibly tilts/settles per iteration; distance band shown as a slab |
| 7   | **R-VPF**            | a bin containing a wall; the wall points peel away in purple                    | 3 iterations, each peel animated                                         |
| 8   | **GLE**              | the 3 tests as gauges: normal arrow vs cone, z̄ vs threshold line, λ₃ bar        | each gauge lights green/red in turn                                      |
| 9   | **All bins judged**  | full scan, per-bin colour = decision (ground/non-ground/candidate)              | ripple outward in ring order                                             |
| 10  | **TGR**              | candidate bins vs this ring's flatness histogram; reverted ones flip to cyan    | histogram slides up; bar crosses μ                                       |
| 11  | **A-GLE**            | play frames 0→5; watch elevation/flatness thresholds and sensor height converge | live plot alongside the 3D view                                          |
| 12  | **Result**           | final ground/non-ground split; toggle to compare with step 2                    | split-screen wipe                                                        |

Interaction worth having: a parameter panel (`th_dist`, `uprightness_thr`, ring/sector counts,
module on/off toggles) that re-runs the affected step live — Patchwork++'s whole thesis is
about parameters, so letting people break it is the lesson.

**Implementation note for the app:** the algorithm is ~1,000 lines of TypeScript across the
step modules and runs in ~110 ms per frame on 124k points, so it runs live in the browser
rather than replaying precomputed results. That keeps a parameter panel honest.

Because the algorithm is strictly sequential, the code mirrors it one-to-one — `steps/rnr.ts`,
`steps/binning.ts`, `steps/seeds.ts`, `steps/rvpf.ts`, `steps/rgpf.ts`, `steps/gle.ts`,
`steps/tgr.ts`, `steps/agle.ts`, composed by `pipeline.ts` in exactly the order above. Each
section of this guide corresponds to one of those files. `reference/patchworkpp_prototype.py`
is the NumPy version used to verify both.

---

## 14. One-paragraph summary

Patchwork++ segments ground by dividing a LiDAR scan into 504 polar patches whose sizes are
chosen to match the sensor's radial density falloff (CZM), fitting a small plane to the lowest
points of each patch by PCA (R-GPF), and then deciding per patch whether that plane is really
ground using three geometric tests — is it upright, is it low enough, is it thin enough (GLE).
Its four contributions over Patchwork all target the cases where that pipeline breaks: **RNR**
deletes mirror-reflection points that would poison the seeds, **R-VPF** peels away walls and
curbs so that ground elevated on a structure is still found, **A-GLE** learns the elevation and
flatness thresholds (and the sensor height) online from the patches it is most confident about,
so no per-scene tuning is needed, and **TGR** gives borderline patches a second chance against
the current frame's statistics rather than the long-run average. The result is 96.51 F1 on
SemanticKITTI at 55+ Hz on a CPU, with no training data.
