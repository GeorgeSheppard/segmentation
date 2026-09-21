import { fitPlane, planeDistance, type PlaneFit } from "../../core/linalg.ts";
import type { Params } from "../params.ts";
import { selectSeeds, type SeedSelection } from "./seeds.ts";

/**
 * Step 4: Region-wise Ground Plane Fitting (GPF, per cell).
 *
 * PCA on the seeds gives a plane; everything within `thDist` of it becomes the new seed
 * set; refit. Three times. PCA rather than RANSAC because it is ~2x faster and, on a small
 * cell where most points really are ground, accurate enough — its sensitivity to outliers
 * is what RNR, adaptive seeding and R-VPF exist to neutralise.
 */
export interface RgpfIteration {
  /** The plane this pass measured against. */
  plane: PlaneFit;
  /** Points it accepted as ground. */
  ground: Int32Array;
}

export interface RgpfResult {
  seeds: SeedSelection;
  iterations: RgpfIteration[];
  /** The converged plane, or null when there were too few points to fit. */
  plane: PlaneFit | null;
  ground: number[];
  /** Points rejected for standing above the plane. Empty when the fit failed. */
  nonGround: number[];
}

export function fitGroundPlane(
  xyz: Float32Array,
  survivors: readonly number[],
  zone: number,
  params: Params,
  sensorHeight: number,
): RgpfResult {
  const seeds = selectSeeds(xyz, survivors, zone, params.thSeeds, params, sensorHeight);
  const iterations: RgpfIteration[] = [];

  let plane = fitPlane(xyz, survivors, seeds.count);
  if (!plane) return { seeds, iterations, plane: null, ground: [], nonGround: [] };

  let ground: number[] = [];
  let nonGround: number[] = [];

  for (let it = 0; it < params.numIter; it++) {
    const accepted: number[] = [];
    const rejected: number[] = [];
    for (const idx of survivors) {
      // ONE-SIDED on purpose: dips and road texture below the plane are still road, only
      // points sticking up are rejected.
      if (planeDistance(xyz, idx, plane.normal, plane.d) < params.thDist) {
        accepted.push(idx);
      } else {
        rejected.push(idx);
      }
    }

    iterations.push({ plane, ground: Int32Array.from(accepted) });
    ground = accepted;
    if (it === params.numIter - 1) nonGround = rejected;

    const refit = fitPlane(xyz, accepted, accepted.length);
    if (!refit) break; // collapsed to fewer than three points; keep the last good plane
    plane = refit;
  }

  return { seeds, iterations, plane, ground, nonGround };
}
