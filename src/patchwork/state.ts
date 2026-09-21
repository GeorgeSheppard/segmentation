import type { Params } from "./params.ts";

/**
 * The state A-GLE carries from frame to frame.
 *
 * This is the whole of Patchwork++'s memory: two thresholds per ring of interest, the rolling
 * samples they are computed from, and the sensor height it re-derives from the road.
 */
export interface AdaptiveState {
  sensorHeight: number;
  elevationThr: number[];
  flatnessThr: number[];
  /** Elevations of past definite-ground cells, per ring, capped at maxElevationStorage. */
  elevationStore: number[][];
  /** Flatnesses of past definite-ground cells, per ring, capped at maxFlatnessStorage. */
  flatnessStore: number[][];
}

/** Cold start: thresholds at zero, sensor height as configured. */
export function initialState(params: Params): AdaptiveState {
  const rings = params.numRingsOfInterest;
  return {
    sensorHeight: params.sensorHeight,
    elevationThr: new Array(rings).fill(0),
    flatnessThr: new Array(rings).fill(0),
    elevationStore: Array.from({ length: rings }, () => [] as number[]),
    flatnessStore: Array.from({ length: rings }, () => [] as number[]),
  };
}

export function cloneState(s: AdaptiveState): AdaptiveState {
  return {
    sensorHeight: s.sensorHeight,
    elevationThr: [...s.elevationThr],
    flatnessThr: [...s.flatnessThr],
    elevationStore: s.elevationStore.map((a) => [...a]),
    flatnessStore: s.flatnessStore.map((a) => [...a]),
  };
}

/**
 * Mean and sample standard deviation, matching `calc_mean_stdev` in the reference C++ —
 * which returns (0, 0) for fewer than two samples rather than the single value.
 * TGR and A-GLE both depend on that edge case.
 */
export function meanStdev(values: readonly number[]): {
  mean: number;
  stdev: number;
} {
  if (values.length <= 1) return { mean: 0, stdev: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  return { mean, stdev: Math.sqrt(acc / (values.length - 1)) };
}
