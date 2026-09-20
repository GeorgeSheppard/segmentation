import type { Params } from "../params.ts";
import { meanStdev } from "../state.ts";

/**
 * Step 6: Temporal Ground Revert.
 *
 * A-GLE's thresholds are a low-pass filter over hundreds of past frames — which is the
 * point, but it means a patch of gravel or grass that is rough *today* always loses the
 * argument. TGR gives the borderline cells one more hearing, judged not against history but
 * against the other cells in their own ring, in this scan.
 *
 * Runs once per concentric ring, after that ring's sectors have all been classified.
 */
export interface RingFlatness {
  mean: number;
  stdev: number;
  /** The per-frame threshold, mean + tgrGain·σ. */
  mu: number;
}

export interface TgrCandidate {
  flatness: number;
  lineVariable: number;
  groundCount: number;
}

export interface TgrVerdict {
  ringMean: number;
  ringStdev: number;
  mu: number;
  probFlatness: number;
  probLine: number;
  reverted: boolean;
  /** Short-circuited by the "large and thin" rule. */
  forcedFlat: boolean;
}

/** The flatness statistics of one ring's definite-ground cells, this frame. */
export function ringFlatness(samples: readonly number[], params: Params): RingFlatness {
  const { mean, stdev } = meanStdev(samples);
  return { mean, stdev, mu: mean + params.tgrGain * stdev };
}

export function judgeCandidate(
  candidate: TgrCandidate,
  ring: RingFlatness,
  params: Params,
): TgrVerdict {
  // With mu == 0 (a ring with one sample or none) the reference divides by zero and the
  // comparison fails, so the candidate is rejected. Mirrored here.
  let probFlatness =
    ring.mu > 0 ? 1 / (1 + Math.exp((candidate.flatness - ring.mu) / (ring.mu / 10))) : 0;

  // A big, thin patch is a surface whatever the ring statistics say.
  const forcedFlat =
    candidate.groundCount > 1500 && candidate.flatness < params.thDist * params.thDist;
  if (forcedFlat) probFlatness = 1;

  // A guardrail seen edge-on is thin too — but it is a line, not a surface.
  const probLine = candidate.lineVariable > params.tgrLineVariableThr ? 0 : 1;

  return {
    ringMean: ring.mean,
    ringStdev: ring.stdev,
    mu: ring.mu,
    probFlatness,
    probLine,
    forcedFlat,
    reverted: probLine * probFlatness > 0.5,
  };
}
