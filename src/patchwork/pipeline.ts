import { binKey, buildCzm, ringRadii, sectorAngles } from "./czm.ts";
import { paintLabels, PointLabel } from "./labels.ts";
import { DEFAULT_PARAMS, type Params } from "./params.ts";
import type { PointCloud } from "./pointcloud.ts";
import { cloneState, initialState, type AdaptiveState } from "./state.ts";
import {
  binIntoCells,
  emptyTimings,
  evaluateGle,
  fitGroundPlane,
  judgeCandidate,
  peelVerticalPlanes,
  recordDefiniteGround,
  removeReflectedNoise,
  ringFlatness,
  sortByHeight,
  updateThresholds,
} from "./steps/index.ts";
import type { CellTrace, FrameTrace, RingTrace } from "./trace.ts";

/**
 * Patchwork++ (Lee, Lim & Myung, IROS 2022) — the pipeline.
 *
 * A faithful port of `PatchWorkpp::estimateGround` from url-kaist/patchwork-plusplus,
 * composed from the step modules in `./steps/`, in the order `PIPELINE_STEPS` lists.
 * The only thing this file adds is the bookkeeping: labels, counts, and the trace the
 * tutorial replays.
 *
 * Per frame:
 *   1. RNR        drop reflected noise                        (whole cloud)
 *   2. CZM        bin into 504 polar cells                    (whole cloud)
 *   for each concentric ring, outward:
 *     for each cell in the ring:
 *       3. sort by height, pick seeds
 *       4. R-VPF  peel vertical structure
 *       5. R-GPF  fit the ground plane
 *       6. GLE    decide: ground, not ground, or undecided
 *     7. TGR      re-hear this ring's undecided cells
 *   8. A-GLE      update the thresholds for the next frame
 */
export function segmentGround(
  cloud: PointCloud,
  frameIndex: number,
  params: Params = DEFAULT_PARAMS,
  stateIn?: AdaptiveState,
): FrameTrace {
  const startedAt = performance.now();

  const czm = buildCzm(params);
  const state = stateIn ? cloneState(stateIn) : initialState(params);
  const stateBefore = cloneState(state);
  // Fixed for the whole frame: A-GLE only moves it at the end (step 8).
  const sensorHeight = state.sensorHeight;

  const { xyz, count } = cloud;
  const labels = new Uint8Array(count).fill(PointLabel.Unassigned);
  const timings = emptyTimings();

  // ---------------------------------------------------------------- 1. RNR
  let mark = performance.now();
  const rnr = removeReflectedNoise(cloud, params, sensorHeight);
  paintLabels(labels, rnr.noise, PointLabel.Noise);
  timings.rnr = performance.now() - mark;

  // ---------------------------------------------------------------- 2. CZM
  mark = performance.now();
  const binned = binIntoCells(cloud, rnr.removed, czm, params);
  paintLabels(labels, binned.outOfRange, PointLabel.OutOfRange);
  timings.czm = performance.now() - mark;

  const cells: CellTrace[] = [];
  const cellsByKey = new Map<string, CellTrace>();
  const rings: RingTrace[] = [];

  let groundCount = 0;
  let nonGroundCount = rnr.noise.length + binned.outOfRange.length;

  for (let zone = 0; zone < params.numZones; zone++) {
    for (let ring = 0; ring < params.numRingsEachZone[zone]; ring++) {
      const concentricIdx = czm.concentricIndex(zone, ring);
      const ringTrace: RingTrace = {
        concentricIdx,
        flatnessSamples: [],
        candidates: [],
        mu: 0,
      };
      const candidates: CellTrace[] = [];

      for (let sector = 0; sector < params.numSectorsEachZone[zone]; sector++) {
        const key = binKey(zone, ring, sector);
        const cell = emptyCell(key, zone, ring, sector, concentricIdx, czm);
        cells.push(cell);
        cellsByKey.set(key, cell);

        const raw = binned.cells.get(key) ?? [];

        // Too sparse to fit anything: the whole cell is non-ground.
        if (raw.length < params.numMinPts) {
          cell.skipped = true;
          cell.indices = Int32Array.from(raw);
          cell.cellNonGround = Int32Array.from(raw);
          paintLabels(labels, raw, PointLabel.SparseCell);
          nonGroundCount += raw.length;
          continue;
        }

        // ------------------------------------------------- 3. sort by height
        sortByHeight(xyz, raw);
        cell.indices = Int32Array.from(raw);

        // ------------------------------------------------- 4. R-VPF
        mark = performance.now();
        const rvpf = peelVerticalPlanes(xyz, raw, zone, params, sensorHeight);
        timings.rvpf += performance.now() - mark;

        cell.rvpf = rvpf.passes;
        cell.survivors = Int32Array.from(rvpf.survivors);
        paintLabels(labels, rvpf.peeled, PointLabel.VerticalPlane);

        const cellNonGround: number[] = [...rvpf.peeled];

        if (rvpf.survivors.length < 3) {
          nonGroundCount += abandonCell(cell, labels, cellNonGround, rvpf.survivors);
          continue;
        }

        // ------------------------------------------------- 5. R-GPF
        mark = performance.now();
        const rgpf = fitGroundPlane(xyz, rvpf.survivors, zone, params, sensorHeight);
        timings.rgpf += performance.now() - mark;

        cell.lprHeight = rgpf.seeds.lprHeight;
        cell.seedCutoff = rgpf.seeds.cutoff;
        cell.seedCount = rgpf.seeds.count;
        cell.lprStart = rgpf.seeds.lprStart;

        if (!rgpf.plane) {
          nonGroundCount += abandonCell(cell, labels, cellNonGround, rvpf.survivors);
          continue;
        }

        cell.rgpf = rgpf.iterations;
        cell.plane = rgpf.plane;
        cellNonGround.push(...rgpf.nonGround);
        cell.cellGround = Int32Array.from(rgpf.ground);
        cell.cellNonGround = Int32Array.from(cellNonGround);
        // Peeled points already carry VerticalPlane; only the rest become AbovePlane.
        for (const i of cellNonGround) {
          if (labels[i] === PointLabel.Unassigned) labels[i] = PointLabel.AbovePlane;
        }
        nonGroundCount += cellNonGround.length;

        // ------------------------------------------------- 6. GLE
        mark = performance.now();
        const gle = evaluateGle(rgpf.plane, concentricIdx, params, state);
        timings.gle += performance.now() - mark;
        cell.gle = gle;

        if (gle.isDefiniteGround) {
          recordDefiniteGround(state, concentricIdx, gle.elevation, gle.flatness);
          ringTrace.flatnessSamples.push(gle.flatness);
        }

        switch (gle.decision) {
          case "ground":
            paintLabels(
              labels,
              cell.cellGround,
              gle.isNearZone ? PointLabel.Ground : PointLabel.GroundFar,
            );
            groundCount += cell.cellGround.length;
            break;
          case "nonground":
            paintLabels(
              labels,
              cell.cellGround,
              gle.isUpright ? PointLabel.RejectedHeading : PointLabel.RejectedTilted,
            );
            nonGroundCount += cell.cellGround.length;
            break;
          case "candidate":
            ringTrace.candidates.push(key);
            candidates.push(cell);
            break;
        }
      }

      // ------------------------------------------------- 7. TGR, once per ring
      if (candidates.length > 0) {
        mark = performance.now();
        if (params.enableTGR) {
          const stats = ringFlatness(ringTrace.flatnessSamples, params);
          ringTrace.mu = stats.mu;
          for (const cand of candidates) {
            const verdict = judgeCandidate(
              {
                flatness: cand.gle!.flatness,
                lineVariable: cand.gle!.lineVariable,
                groundCount: cand.cellGround.length,
              },
              stats,
              params,
            );
            cand.tgr = verdict;

            if (verdict.reverted) {
              paintLabels(labels, cand.cellGround, PointLabel.GroundReverted);
              groundCount += cand.cellGround.length;
            } else {
              paintLabels(labels, cand.cellGround, PointLabel.RejectedCandidate);
              nonGroundCount += cand.cellGround.length;
            }
          }
        } else {
          for (const cand of candidates) {
            paintLabels(labels, cand.cellGround, PointLabel.RejectedCandidate);
            nonGroundCount += cand.cellGround.length;
          }
        }
        timings.tgr += performance.now() - mark;
      }

      rings.push(ringTrace);
    }
  }

  // ---------------------------------------------------------------- 8. A-GLE
  mark = performance.now();
  updateThresholds(state, params);
  timings.agle = performance.now() - mark;

  return {
    frameIndex,
    cloud,
    params,
    czm,
    labels,
    cells,
    cellsByKey,
    rings,
    noiseIndices: rnr.noise,
    outOfRangeIndices: binned.outOfRange,
    groundCount,
    nonGroundCount,
    stateBefore,
    stateAfter: cloneState(state),
    elapsedMs: performance.now() - startedAt,
    timings,
  };
}

function emptyCell(
  key: string,
  zone: number,
  ring: number,
  sector: number,
  concentricIdx: number,
  czm: ReturnType<typeof buildCzm>,
): CellTrace {
  return {
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
    cellGround: new Int32Array(0),
    cellNonGround: new Int32Array(0),
    gle: null,
    tgr: null,
  };
}

/**
 * A cell that could not be fitted — too few survivors, or a degenerate seed set.
 * Everything left in it is non-ground. Returns how many points that was.
 */
function abandonCell(
  cell: CellTrace,
  labels: Uint8Array,
  cellNonGround: number[],
  survivors: readonly number[],
): number {
  cell.cellNonGround = Int32Array.from([...cellNonGround, ...survivors]);
  paintLabels(labels, survivors, PointLabel.AbovePlane);
  return cell.cellNonGround.length;
}
