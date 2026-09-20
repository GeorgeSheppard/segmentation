import { fitPlane, planeDistance, type PlaneFit } from "../core/linalg.ts";
import { binKey, buildCzm, ringRadii, sectorAngles, xy2radius, xy2theta } from "./czm.ts";
import { DEFAULT_PARAMS, type Params } from "./params.ts";
import {
  cloneState,
  initialState,
  PointLabel,
  type AdaptiveState,
  type BinTrace,
  type FrameTrace,
  type GleVerdict,
  type PointCloud,
  type RgpfIteration,
  type RingTrace,
  type RvpfIteration,
  type TgrVerdict,
} from "./types.ts";

/**
 * Patchwork++ (Lee, Lim & Myung, IROS 2022), instrumented.
 *
 * A faithful port of url-kaist/patchwork-plusplus `PatchWorkpp::estimateGround`, extended to
 * record every intermediate result so the tutorial can replay the algorithm step by step.
 * Deviations from the C++ are called out in comments; there are none that change the output.
 */
export function segmentGround(
  cloud: PointCloud,
  frameIndex: number,
  params: Params = DEFAULT_PARAMS,
  stateIn?: AdaptiveState,
): FrameTrace {
  const t0 = performance.now();

  const czm = buildCzm(params);
  const state = stateIn ? cloneState(stateIn) : initialState(params);
  const stateBefore = cloneState(state);

  const { xyz, intensity, count } = cloud;
  const labels = new Uint8Array(count).fill(PointLabel.Unassigned);

  // ---------------------------------------------------------------- 1. RNR
  // Reflected Noise Removal. Points below the road that arrived via a mirror bounce:
  // a bottom-ring ray, well under the (self-estimated) ground, and dim.
  const noise: number[] = [];
  const removed = new Uint8Array(count);
  if (params.enableRNR) {
    const zFloor = -state.sensorHeight - 0.8;
    for (let i = 0; i < count; i++) {
      const o = i * 3;
      const r = Math.hypot(xyz[o], xyz[o + 1]);
      const z = xyz[o + 2];
      const verAngleDeg = (Math.atan2(z, r) * 180) / Math.PI;
      if (
        verAngleDeg < params.rnrVerAngleThr &&
        z < zFloor &&
        intensity[i] < params.rnrIntensityThr
      ) {
        noise.push(i);
        removed[i] = 1;
        labels[i] = PointLabel.Noise;
      }
    }
  }

  // ------------------------------------------------------- 2. CZM binning
  const buckets = new Map<string, number[]>();
  const outOfRange: number[] = [];
  for (let i = 0; i < count; i++) {
    if (removed[i]) continue;
    const o = i * 3;
    const x = xyz[o];
    const y = xyz[o + 1];
    const r = xy2radius(x, y);
    if (r <= params.minRange || r > params.maxRange) {
      outOfRange.push(i);
      labels[i] = PointLabel.OutOfRange;
      continue;
    }
    const theta = xy2theta(x, y);
    // Zone by radius; the boundaries are minRanges[1..3].
    let zone = 0;
    if (r >= czm.minRanges[3]) zone = 3;
    else if (r >= czm.minRanges[2]) zone = 2;
    else if (r >= czm.minRanges[1]) zone = 1;

    const ring = Math.min(
      Math.floor((r - czm.minRanges[zone]) / czm.ringSizes[zone]),
      params.numRingsEachZone[zone] - 1,
    );
    const sector = Math.min(
      Math.floor(theta / czm.sectorSizes[zone]),
      params.numSectorsEachZone[zone] - 1,
    );
    const key = binKey(zone, ring, sector);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }

  // ------------------------------- 3-6. per-bin fitting, GLE and TGR
  const bins: BinTrace[] = [];
  const binsByKey = new Map<string, BinTrace>();
  const rings: RingTrace[] = [];

  let groundCount = 0;
  let nonGroundCount = noise.length + outOfRange.length;

  for (let zone = 0; zone < params.numZones; zone++) {
    for (let ring = 0; ring < params.numRingsEachZone[zone]; ring++) {
      const concentricIdx = czm.concentricIndex(zone, ring);
      const ringTrace: RingTrace = {
        concentricIdx,
        flatnessSamples: [],
        candidates: [],
        mu: 0,
      };
      const candidates: BinTrace[] = [];

      for (let sector = 0; sector < params.numSectorsEachZone[zone]; sector++) {
        const key = binKey(zone, ring, sector);
        const raw = buckets.get(key) ?? [];

        const trace: BinTrace = {
          key,
          zone,
          ring,
          sector,
          concentricIdx,
          radii: ringRadii(czm, zone, ring),
          angles: sectorAngles(czm, zone, sector),
          indices: new Int32Array(0),
          skipped: false,
          rvpf: [],
          survivors: new Int32Array(0),
          lprHeight: 0,
          seedCutoff: 0,
          seedCount: 0,
          lprStart: 0,
          rgpf: [],
          plane: null,
          binGround: new Int32Array(0),
          binNonGround: new Int32Array(0),
          gle: null,
          tgr: null,
        };
        bins.push(trace);
        binsByKey.set(key, trace);

        if (raw.length < params.numMinPts) {
          trace.skipped = true;
          trace.indices = Int32Array.from(raw);
          trace.binNonGround = Int32Array.from(raw);
          for (const i of raw) labels[i] = PointLabel.SparseBin;
          nonGroundCount += raw.length;
          continue;
        }

        // Sort by height, ascending. The reference sorts per bin rather than globally —
        // that is the change that made Patchwork++ faster than Patchwork.
        raw.sort((a, b) => xyz[a * 3 + 2] - xyz[b * 3 + 2]);
        trace.indices = Int32Array.from(raw);

        const binNonGround: number[] = [];

        // ------------------------------------------------- R-VPF
        let survivors = raw;
        if (params.enableRVPF) {
          for (let it = 0; it < params.numIter; it++) {
            const seeds = selectSeeds(xyz, survivors, zone, params, state, params.thSeedsV);
            const plane = fitPlane(xyz, survivors, seeds.count);
            if (!plane) break;
            // Only zone 0 is peeled, and only while the fit is still tilted: once the plane
            // stands up, the vertical structure is gone and what is left is ground.
            if (zone !== 0 || plane.normal[2] >= params.uprightnessThr) {
              trace.rvpf.push({
                plane,
                seedCount: seeds.count,
                peeled: false,
                removed: new Int32Array(0),
              });
              break;
            }
            const kept: number[] = [];
            const peeled: number[] = [];
            for (const idx of survivors) {
              // Note: R-VPF uses the ABSOLUTE distance; R-GPF below uses the signed one.
              if (Math.abs(planeDistance(xyz, idx, plane.normal, plane.d)) < params.thDistV) {
                peeled.push(idx);
              } else {
                kept.push(idx);
              }
            }
            const iteration: RvpfIteration = {
              plane,
              seedCount: seeds.count,
              peeled: true,
              removed: Int32Array.from(peeled),
            };
            trace.rvpf.push(iteration);
            for (const i of peeled) labels[i] = PointLabel.VerticalPlane;
            binNonGround.push(...peeled);
            survivors = kept;
            if (survivors.length < 3) break;
          }
        }
        trace.survivors = Int32Array.from(survivors);

        if (survivors.length < 3) {
          trace.binNonGround = Int32Array.from(binNonGround.concat(survivors));
          for (const i of survivors) labels[i] = PointLabel.AbovePlane;
          nonGroundCount += trace.binNonGround.length;
          continue;
        }

        // ------------------------------------------------- R-GPF
        const seeds = selectSeeds(xyz, survivors, zone, params, state, params.thSeeds);
        trace.lprHeight = seeds.lprHeight;
        trace.seedCutoff = seeds.cutoff;
        trace.seedCount = seeds.count;
        trace.lprStart = seeds.lprStart;

        let plane = fitPlane(xyz, survivors, seeds.count);
        if (!plane) {
          trace.binNonGround = Int32Array.from(binNonGround.concat(survivors));
          for (const i of survivors) labels[i] = PointLabel.AbovePlane;
          nonGroundCount += trace.binNonGround.length;
          continue;
        }

        let binGround: number[] = [];
        for (let it = 0; it < params.numIter; it++) {
          const accepted: number[] = [];
          const rejected: number[] = [];
          for (const idx of survivors) {
            if (planeDistance(xyz, idx, plane.normal, plane.d) < params.thDist) {
              accepted.push(idx);
            } else {
              rejected.push(idx);
            }
          }
          const iteration: RgpfIteration = { plane, ground: Int32Array.from(accepted) };
          trace.rgpf.push(iteration);

          binGround = accepted;
          if (it === params.numIter - 1) {
            binNonGround.push(...rejected);
          }
          const refit = fitPlane(xyz, accepted, accepted.length);
          if (!refit) break;
          plane = refit;
        }
        trace.plane = plane;
        trace.binGround = Int32Array.from(binGround);
        trace.binNonGround = Int32Array.from(binNonGround);
        for (const i of binNonGround) {
          if (labels[i] === PointLabel.Unassigned) labels[i] = PointLabel.AbovePlane;
        }
        nonGroundCount += binNonGround.length;

        // ------------------------------------------------- GLE
        const gle = evaluateGle(plane, concentricIdx, params, state);
        trace.gle = gle;

        if (gle.isDefiniteGround) {
          state.elevationStore[concentricIdx].push(gle.elevation);
          state.flatnessStore[concentricIdx].push(gle.flatness);
          ringTrace.flatnessSamples.push(gle.flatness);
        }

        switch (gle.decision) {
          case "ground":
            paint(labels, binGround, gle.isNearZone ? PointLabel.Ground : PointLabel.GroundFar);
            groundCount += binGround.length;
            break;
          case "nonground":
            paint(
              labels,
              binGround,
              gle.isUpright ? PointLabel.RejectedHeading : PointLabel.RejectedTilted,
            );
            nonGroundCount += binGround.length;
            break;
          case "candidate":
            ringTrace.candidates.push(key);
            candidates.push(trace);
            break;
        }
      }

      // ------------------------------------------------- TGR, once per ring
      if (candidates.length > 0) {
        if (params.enableTGR) {
          const { mean, stdev } = strictMeanStdev(ringTrace.flatnessSamples);
          const mu = mean + params.tgrGain * stdev;
          ringTrace.mu = mu;
          for (const cand of candidates) {
            const verdict = evaluateTgr(cand, mu, mean, stdev, params);
            cand.tgr = verdict;
            if (verdict.reverted) {
              paint(labels, cand.binGround, PointLabel.GroundReverted);
              groundCount += cand.binGround.length;
            } else {
              paint(labels, cand.binGround, PointLabel.RejectedCandidate);
              nonGroundCount += cand.binGround.length;
            }
          }
        } else {
          for (const cand of candidates) {
            paint(labels, cand.binGround, PointLabel.RejectedCandidate);
            nonGroundCount += cand.binGround.length;
          }
        }
      }

      rings.push(ringTrace);
    }
  }

  // ------------------------------------------------- 7. A-GLE threshold update
  updateElevationThr(state, params);
  updateFlatnessThr(state, params);

  return {
    frameIndex,
    cloud,
    params,
    czm,
    labels,
    bins,
    binsByKey,
    rings,
    noiseIndices: Int32Array.from(noise),
    outOfRangeIndices: Int32Array.from(outOfRange),
    groundCount,
    nonGroundCount,
    stateBefore,
    stateAfter: cloneState(state),
    elapsedMs: performance.now() - t0,
  };
}

function paint(labels: Uint8Array, indices: ArrayLike<number>, label: PointLabel): void {
  for (let i = 0; i < indices.length; i++) labels[indices[i]] = label;
}

/**
 * GPF's Lowest Point Representative seeding.
 *
 * `sorted` must be ascending in z, which makes the seed set a prefix — the property the
 * visualisation leans on. In zone 0, points far below the ground are skipped first
 * (Patchwork's "adaptive initial seed selection"), so that a reflection cannot drag the
 * LPR down.
 */
function selectSeeds(
  xyz: Float32Array,
  sorted: number[],
  zone: number,
  params: Params,
  state: AdaptiveState,
  thSeed: number,
): { lprHeight: number; cutoff: number; count: number; lprStart: number } {
  let start = 0;
  if (zone === 0) {
    const floor = params.adaptiveSeedSelectionMargin * state.sensorHeight;
    while (start < sorted.length && xyz[sorted[start] * 3 + 2] < floor) start++;
  }

  let sum = 0;
  let n = 0;
  for (let i = start; i < sorted.length && n < params.numLPR; i++) {
    sum += xyz[sorted[i] * 3 + 2];
    n++;
  }
  const lprHeight = n !== 0 ? sum / n : 0;
  const cutoff = lprHeight + thSeed;

  // Seeds are every point below the cutoff, counted from the very start of the sorted list
  // (the reference does not exclude the points skipped above).
  let count = 0;
  while (count < sorted.length && xyz[sorted[count] * 3 + 2] < cutoff) count++;
  return { lprHeight, cutoff, count, lprStart: start };
}

function evaluateGle(
  plane: PlaneFit,
  concentricIdx: number,
  params: Params,
  state: AdaptiveState,
): GleVerdict {
  const uprightness = plane.normal[2];
  const elevation = plane.mean[2];
  const flatness = plane.eigenvalues[2];
  const lineVariable =
    plane.eigenvalues[1] !== 0 ? plane.eigenvalues[0] / plane.eigenvalues[1] : Number.MAX_VALUE;
  const heading =
    plane.mean[0] * plane.normal[0] +
    plane.mean[1] * plane.normal[1] +
    plane.mean[2] * plane.normal[2];

  const isUpright = uprightness > params.uprightnessThr;
  const isNearZone = concentricIdx < params.numRingsOfInterest;
  const isHeadingOutside = heading < 0;

  const elevationThr = isNearZone ? state.elevationThr[concentricIdx] : Number.NaN;
  const flatnessThr = isNearZone ? state.flatnessThr[concentricIdx] : Number.NaN;
  const isNotElevated = isNearZone && elevation < elevationThr;
  const isFlat = isNearZone && flatness < flatnessThr;

  let decision: GleVerdict["decision"];
  let reason: string;
  if (!isUpright) {
    decision = "nonground";
    reason = "normal is tilted more than 45°";
  } else if (!isNearZone) {
    decision = "ground";
    reason = "beyond the rings of interest — uprightness is enough";
  } else if (!isHeadingOutside) {
    decision = "nonground";
    reason = "plane sits above the sensor origin";
  } else if (isNotElevated) {
    decision = "ground";
    reason = "low enough";
  } else if (isFlat) {
    decision = "ground";
    reason = "elevated, but flat enough";
  } else {
    decision = "candidate";
    reason = "elevated and not flat — handed to TGR";
  }

  return {
    uprightness,
    elevation,
    flatness,
    lineVariable,
    heading,
    elevationThr,
    flatnessThr,
    isUpright,
    isNearZone,
    isHeadingOutside,
    isNotElevated,
    isFlat,
    decision,
    reason,
    isDefiniteGround: isUpright && isNotElevated && isNearZone,
  };
}

function evaluateTgr(
  bin: BinTrace,
  mu: number,
  ringMean: number,
  ringStdev: number,
  params: Params,
): TgrVerdict {
  const gle = bin.gle!;
  // Mirrors the reference: with mu == 0 (a ring with one sample or none) the C++ divides by
  // zero and the comparison fails, so the candidate is rejected.
  let probFlatness =
    mu > 0 ? 1 / (1 + Math.exp((gle.flatness - mu) / (mu / 10))) : 0;

  // A big, thin patch is a surface whatever the statistics say.
  const forcedFlat =
    bin.binGround.length > 1500 && gle.flatness < params.thDist * params.thDist;
  if (forcedFlat) probFlatness = 1;

  const probLine = gle.lineVariable > params.tgrLineVariableThr ? 0 : 1;

  return {
    ringMean,
    ringStdev,
    mu,
    probFlatness,
    probLine,
    forcedFlat,
    reverted: probLine * probFlatness > 0.5,
  };
}

/** `calc_mean_stdev` in the reference returns (0, 0) for fewer than two samples. */
function strictMeanStdev(values: number[]): { mean: number; stdev: number } {
  if (values.length <= 1) return { mean: 0, stdev: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  return { mean, stdev: Math.sqrt(acc / (values.length - 1)) };
}

function updateElevationThr(state: AdaptiveState, params: Params): void {
  for (let i = 0; i < params.numRingsOfInterest; i++) {
    const store = state.elevationStore[i];
    if (store.length === 0) continue;
    const { mean, stdev } = strictMeanStdev(store);
    state.elevationThr[i] = mean + params.elevationGain[i] * stdev;
    // The innermost ring also re-estimates the sensor height, which RNR uses next frame.
    if (i === 0) state.sensorHeight = -mean;
    trim(store, params.maxElevationStorage);
  }
}

function updateFlatnessThr(state: AdaptiveState, params: Params): void {
  for (let i = 0; i < params.numRingsOfInterest; i++) {
    const store = state.flatnessStore[i];
    // `break`, not `continue` — faithful to the reference.
    if (store.length <= 1) break;
    const { mean, stdev } = strictMeanStdev(store);
    state.flatnessThr[i] = mean + params.flatnessGain[i] * stdev;
    trim(store, params.maxFlatnessStorage);
  }
}

function trim(store: number[], max: number): void {
  const excess = store.length - max;
  if (excess > 0) store.splice(0, excess);
}
