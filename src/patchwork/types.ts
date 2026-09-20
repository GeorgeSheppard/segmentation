import type { PlaneFit } from "../core/linalg.ts";
import type { CzmGeometry } from "./czm.ts";
import type { Params } from "./params.ts";

/**
 * Why a point ended up where it did. Drives the colour of every point on screen.
 *
 * A const object rather than a TS `enum` so the module stays erasable (and so the values
 * can be iterated for the legend).
 */
export const PointLabel = {
  /** Never assigned — should not happen; painted magenta so bugs are loud. */
  Unassigned: 0,
  /** Removed by Reflected Noise Removal. */
  Noise: 1,
  /** Outside [minRange, maxRange]. */
  OutOfRange: 2,
  /** In a bin with fewer than numMinPts points. */
  SparseBin: 3,
  /** Peeled off by Region-wise Vertical Plane Fitting. */
  VerticalPlane: 4,
  /** Inside a bin but further than thDist above its ground plane. */
  AbovePlane: 5,
  /** Its bin's plane failed the uprightness test. */
  RejectedTilted: 6,
  /** Its bin's plane sits above the sensor origin (car roof / bonnet). */
  RejectedHeading: 7,
  /** A TGR candidate that TGR finally rejected. */
  RejectedCandidate: 8,
  /** Accepted as ground by the elevation or flatness test. */
  Ground: 9,
  /** Accepted as ground on uprightness alone, beyond the rings of interest. */
  GroundFar: 10,
  /** Accepted as ground by Temporal Ground Revert. */
  GroundReverted: 11,
} as const;

export type PointLabel = (typeof PointLabel)[keyof typeof PointLabel];

export function isGroundLabel(label: PointLabel): boolean {
  return (
    label === PointLabel.Ground ||
    label === PointLabel.GroundFar ||
    label === PointLabel.GroundReverted
  );
}

export interface PointCloud {
  /** Interleaved xyz, length = 3 * count. */
  xyz: Float32Array;
  intensity: Float32Array;
  count: number;
}

/** One pass of R-VPF: fit a plane to the lowest points, peel it off if it is vertical. */
export interface RvpfIteration {
  plane: PlaneFit;
  /** Seeds are the first `seedCount` entries of the surviving point list. */
  seedCount: number;
  /** True when the plane was vertical enough to be peeled. */
  peeled: boolean;
  removed: Int32Array;
}

/** One refinement pass of R-GPF. */
export interface RgpfIteration {
  /** Plane used for this pass's distance test. */
  plane: PlaneFit;
  /** Points accepted as ground by this pass. */
  ground: Int32Array;
}

/** The three-factor Ground Likelihood Estimation verdict for one bin. */
export interface GleVerdict {
  uprightness: number;
  elevation: number;
  flatness: number;
  lineVariable: number;
  heading: number;

  elevationThr: number;
  flatnessThr: number;

  isUpright: boolean;
  isNearZone: boolean;
  isHeadingOutside: boolean;
  isNotElevated: boolean;
  isFlat: boolean;

  decision: "ground" | "nonground" | "candidate";
  reason: string;
  /** Contributed to D_m, the set A-GLE learns its thresholds from. */
  isDefiniteGround: boolean;
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

export interface BinTrace {
  key: string;
  zone: number;
  ring: number;
  sector: number;
  concentricIdx: number;

  /** Radial and angular extent, for drawing the cell. */
  radii: [number, number];
  angles: [number, number];

  /** Point indices, sorted by z ascending. Empty bins are still traced. */
  indices: Int32Array;
  /** True when the bin was skipped for having fewer than numMinPts points. */
  skipped: boolean;

  /** R-VPF passes, in order. Empty when R-VPF did not run or found nothing. */
  rvpf: RvpfIteration[];
  /** Indices surviving R-VPF, still sorted by z. */
  survivors: Int32Array;

  /** Mean z of the LPR points, and the seed cutoff lprHeight + thSeeds. */
  lprHeight: number;
  seedCutoff: number;
  /** Seeds are the first `seedCount` survivors (they are a prefix, since z is sorted). */
  seedCount: number;
  /** Index into `survivors` where LPR averaging started (adaptive seed selection). */
  lprStart: number;

  rgpf: RgpfIteration[];
  /** Final plane for the bin, or null when the bin produced no fit. */
  plane: PlaneFit | null;
  /** Final ground / non-ground split within the bin. */
  binGround: Int32Array;
  binNonGround: Int32Array;

  gle: GleVerdict | null;
  tgr: TgrVerdict | null;
}

/** Per-concentric-ring bookkeeping, as used by TGR. */
export interface RingTrace {
  concentricIdx: number;
  /** Flatness of this ring's definite-ground bins, this frame. */
  flatnessSamples: number[];
  candidates: string[];
  mu: number;
}

/** The state A-GLE carries from frame to frame. */
export interface AdaptiveState {
  sensorHeight: number;
  elevationThr: number[];
  flatnessThr: number[];
  elevationStore: number[][];
  flatnessStore: number[][];
}

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

export interface FrameTrace {
  frameIndex: number;
  cloud: PointCloud;
  params: Params;
  czm: CzmGeometry;

  labels: Uint8Array;
  bins: BinTrace[];
  binsByKey: Map<string, BinTrace>;
  rings: RingTrace[];

  noiseIndices: Int32Array;
  outOfRangeIndices: Int32Array;

  groundCount: number;
  nonGroundCount: number;

  stateBefore: AdaptiveState;
  stateAfter: AdaptiveState;

  elapsedMs: number;
}
