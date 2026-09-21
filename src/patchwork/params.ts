/**
 * Patchwork++ parameters.
 *
 * Values and names follow `patchwork::Params` in the reference implementation
 * (url-kaist/patchwork-plusplus, cpp/patchworkpp/include/patchwork/patchworkpp.h).
 * See docs/patchwork-plusplus-guide.md §10 for what each one does.
 */
export interface Params {
  enableRNR: boolean;
  enableRVPF: boolean;
  enableTGR: boolean;

  numIter: number;
  numLPR: number;
  numMinPts: number;
  numZones: number;
  numRingsOfInterest: number;

  rnrVerAngleThr: number;
  rnrIntensityThr: number;

  sensorHeight: number;
  thSeeds: number;
  thDist: number;
  thSeedsV: number;
  thDistV: number;
  maxRange: number;
  minRange: number;
  uprightnessThr: number;
  adaptiveSeedSelectionMargin: number;

  numSectorsEachZone: number[];
  numRingsEachZone: number[];

  maxElevationStorage: number;
  maxFlatnessStorage: number;

  /** Per-ring sigma gain for the adaptive elevation threshold. */
  elevationGain: number[];
  /** Per-ring sigma gain for the adaptive flatness threshold. */
  flatnessGain: number[];
  /** Sigma gain for the per-frame flatness threshold used by TGR. */
  tgrGain: number;
  /** TGR rejects a patch whose points form a line: lambda1 / lambda2 above this. */
  tgrLineVariableThr: number;
}

export const DEFAULT_PARAMS: Params = {
  enableRNR: true,
  enableRVPF: true,
  enableTGR: true,

  numIter: 3,
  numLPR: 20,
  numMinPts: 10,
  numZones: 4,
  numRingsOfInterest: 4,

  rnrVerAngleThr: -15.0,
  rnrIntensityThr: 0.2,

  sensorHeight: 1.723,
  thSeeds: 0.125,
  thDist: 0.125,
  thSeedsV: 0.25,
  thDistV: 0.1,
  maxRange: 80.0,
  minRange: 2.7,
  uprightnessThr: 0.707,
  adaptiveSeedSelectionMargin: -1.2,

  numSectorsEachZone: [16, 32, 54, 32],
  numRingsEachZone: [2, 4, 4, 4],

  maxElevationStorage: 1000,
  maxFlatnessStorage: 1000,

  // The paper specifies a_m = 3 for the innermost ring and 2 elsewhere, b_m = 3 / 2.
  // The released code uses mean + 1*stdev for flatness on every ring; we follow the code.
  elevationGain: [3, 2, 2, 2],
  flatnessGain: [1, 1, 1, 1],
  tgrGain: 1.5,
  tgrLineVariableThr: 8.0,
};

export function cloneParams(p: Params): Params {
  return {
    ...p,
    numSectorsEachZone: [...p.numSectorsEachZone],
    numRingsEachZone: [...p.numRingsEachZone],
    elevationGain: [...p.elevationGain],
    flatnessGain: [...p.flatnessGain],
  };
}
