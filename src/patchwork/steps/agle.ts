import type { Params } from "../params.ts";
import { meanStdev, type AdaptiveState } from "../state.ts";

/**
 * Step 7: Adaptive Ground Likelihood Estimation — the feedback loop.
 *
 * In Patchwork the elevation and flatness thresholds were hand-tuned, and the right value
 * differs between a motorway, a suburb and a country lane. A-GLE measures them instead,
 * from the cells GLE was most confident about (the *definite ground*, Dₘ — about 96% true
 * ground by the paper's measurement).
 *
 * It also re-derives the sensor height from the innermost ring, which is what RNR's floor
 * rides on — so the noise filter follows the car downhill instead of eating the road.
 *
 * Runs once at the end of a frame; the result is what the *next* frame is judged against.
 */

/** Record one definite-ground cell into the rolling statistics. */
export function recordDefiniteGround(
  state: AdaptiveState,
  concentricIdx: number,
  elevation: number,
  flatness: number,
): void {
  state.elevationStore[concentricIdx].push(elevation);
  state.flatnessStore[concentricIdx].push(flatness);
}

/** Recompute both thresholds and the sensor height. Mutates `state`. */
export function updateThresholds(state: AdaptiveState, params: Params): void {
  updateElevation(state, params);
  updateFlatness(state, params);
}

function updateElevation(state: AdaptiveState, params: Params): void {
  for (let i = 0; i < params.numRingsOfInterest; i++) {
    const store = state.elevationStore[i];
    if (store.length === 0) continue;

    const { mean, stdev } = meanStdev(store);
    state.elevationThr[i] = mean + params.elevationGain[i] * stdev;
    // The innermost ring also measures the sensor height, which RNR uses next frame.
    if (i === 0) state.sensorHeight = -mean;

    trim(store, params.maxElevationStorage);
  }
}

function updateFlatness(state: AdaptiveState, params: Params): void {
  for (let i = 0; i < params.numRingsOfInterest; i++) {
    const store = state.flatnessStore[i];
    // `break`, not `continue` — faithful to the reference: a ring with too few samples
    // stops the update for every ring beyond it too.
    if (store.length <= 1) break;

    const { mean, stdev } = meanStdev(store);
    state.flatnessThr[i] = mean + params.flatnessGain[i] * stdev;

    trim(store, params.maxFlatnessStorage);
  }
}

function trim(store: number[], max: number): void {
  const excess = store.length - max;
  if (excess > 0) store.splice(0, excess);
}
