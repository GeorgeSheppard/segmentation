import type { PlaneFit } from "../../core/linalg.ts";
import type { Params } from "../params.ts";
import type { AdaptiveState } from "../state.ts";

/**
 * Step 5: Ground Likelihood Estimation.
 *
 * R-GPF always returns a plane, even in a cell containing nothing but a wall. GLE is the
 * veto, and it is what lifts precision from R-GPF's ~75% to Patchwork's ~94%.
 *
 * Three tests:
 *   uprightness — does the normal point up? (rejects walls)
 *   elevation   — does the plane sit below the sensor, and low enough? (rejects car roofs)
 *   flatness    — is it thin enough to be a surface anyway? (rescues smooth steep slopes)
 *
 * Elevation and flatness only apply within `numRingsOfInterest`: past ~17 m a high patch
 * might just be a hill, so uprightness decides alone.
 */
export interface GleVerdict {
  /** n_z — 1 for a perfectly horizontal plane. */
  uprightness: number;
  /** Mean z of the fitted ground set. */
  elevation: number;
  /** λ₃ — the plane's physical thickness, in m². */
  flatness: number;
  /** λ₁/λ₂ — large means the points form a line, not a surface. Used by TGR. */
  lineVariable: number;
  /** n · p̄ — negative when the plane's supporting point is below the sensor origin. */
  heading: number;

  /** Thresholds in force for this cell's ring; NaN outside the rings of interest. */
  elevationThr: number;
  flatnessThr: number;

  isUpright: boolean;
  isNearZone: boolean;
  isHeadingOutside: boolean;
  isNotElevated: boolean;
  isFlat: boolean;

  decision: "ground" | "nonground" | "candidate";
  /** Human-readable reason, for the tutorial's narration. */
  reason: string;
  /** Contributed to Dₘ, the set A-GLE learns its thresholds from. */
  isDefiniteGround: boolean;
}

export function evaluateGle(
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
