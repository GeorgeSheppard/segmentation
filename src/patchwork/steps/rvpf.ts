import { fitPlane, planeDistance, type PlaneFit } from "../../core/linalg.ts";
import type { Params } from "../params.ts";
import { selectSeeds } from "./seeds.ts";

/**
 * Step 3: Region-wise Vertical Plane Fitting.
 *
 * Ground can sit *on top of* a vertical structure — a kerb, a low fence, a retaining wall.
 * That ground is still ground (a person can stand on it), but the wall's points are lower,
 * so they win the seeding and the fitted "ground plane" ends up smeared across the wall.
 *
 * R-VPF does the opposite of what you would expect: before fitting the ground it
 * deliberately fits the *wall* and throws it away, up to `numIter` times. As soon as a pass
 * produces an upright plane, the structure is gone and what remains is ground.
 *
 * Only the central zone is peeled — that is where the geometry actually occurs, and it is
 * what the reference implementation does.
 */
export interface RvpfPass {
  plane: PlaneFit;
  /** Seeds used for this pass — a prefix of the points still surviving. */
  seedCount: number;
  /** False on the pass that found an upright plane and stopped. */
  peeled: boolean;
  removed: Int32Array;
}

export interface RvpfResult {
  passes: RvpfPass[];
  /** Points that survived every pass, still sorted ascending by z. */
  survivors: number[];
  /** Everything peeled off, in peel order. */
  peeled: number[];
}

export function peelVerticalPlanes(
  xyz: Float32Array,
  sorted: readonly number[],
  zone: number,
  params: Params,
  sensorHeight: number,
): RvpfResult {
  const passes: RvpfPass[] = [];
  const peeled: number[] = [];
  let survivors = [...sorted];

  if (!params.enableRVPF) return { passes, survivors, peeled };

  for (let pass = 0; pass < params.numIter; pass++) {
    const seeds = selectSeeds(xyz, survivors, zone, params.thSeedsV, params, sensorHeight);
    const plane = fitPlane(xyz, survivors, seeds.count);
    if (!plane) break;

    // Stop as soon as the fit stands up: the wall is gone.
    if (zone !== 0 || plane.normal[2] >= params.uprightnessThr) {
      passes.push({
        plane,
        seedCount: seeds.count,
        peeled: false,
        removed: new Int32Array(0),
      });
      break;
    }

    const kept: number[] = [];
    const batch: number[] = [];
    for (const idx of survivors) {
      // ABSOLUTE distance here — a point on either side of a vertical plane belongs to it.
      // (R-GPF's ground test is one-sided; see rgpf.ts.)
      if (Math.abs(planeDistance(xyz, idx, plane.normal, plane.d)) < params.thDistV) {
        batch.push(idx);
      } else {
        kept.push(idx);
      }
    }

    passes.push({
      plane,
      seedCount: seeds.count,
      peeled: true,
      removed: Int32Array.from(batch),
    });
    peeled.push(...batch);
    survivors = kept;
    if (survivors.length < 3) break;
  }

  return { passes, survivors, peeled };
}
