import type { PlaneFit } from "../core/linalg.ts";
import type { CzmGeometry } from "./czm.ts";
import type { Params } from "./params.ts";
import type { PointCloud } from "./pointcloud.ts";
import type { AdaptiveState } from "./state.ts";
import type { StepTimings } from "./steps/index.ts";
import type { GleVerdict } from "./steps/gle.ts";
import type { RgpfIteration } from "./steps/rgpf.ts";
import type { RvpfPass } from "./steps/rvpf.ts";
import type { TgrVerdict } from "./steps/tgr.ts";

/**
 * Everything the pipeline did, recorded.
 *
 * The tutorial reads this and never recomputes anything: the seeds it draws are the seeds
 * that were used, the plane it animates is the plane that was fitted, the numbers in the
 * captions are the numbers the classifier tested.
 */

/** One CZM cell, and every intermediate result produced inside it. */
export interface CellTrace {
  key: string;
  zone: number;
  ring: number;
  sector: number;
  /** Global ring index across all zones — what the rings-of-interest test uses. */
  concentricIdx: number;

  /** Radial and angular extent, for drawing the cell. */
  radii: [number, number];
  angles: [number, number];

  /** Point indices, sorted ascending by z. Populated even for skipped cells. */
  indices: Int32Array;
  /** True when the cell held fewer than numMinPts points and was skipped wholesale. */
  skipped: boolean;

  /** R-VPF passes, in order. Empty when R-VPF did not run or found nothing. */
  rvpf: RvpfPass[];
  /** Indices surviving R-VPF, still sorted by z. */
  survivors: Int32Array;

  /** Seed selection for the ground fit. */
  lprHeight: number;
  seedCutoff: number;
  /** Seeds are the first `seedCount` survivors — a prefix, since z is sorted. */
  seedCount: number;
  lprStart: number;

  rgpf: RgpfIteration[];
  /** The converged plane, or null when the cell produced no fit. */
  plane: PlaneFit | null;
  /** Final split within the cell, before GLE has ruled on it. */
  cellGround: Int32Array;
  cellNonGround: Int32Array;

  gle: GleVerdict | null;
  /** Set only on cells GLE handed to TGR. */
  tgr: TgrVerdict | null;
}

/** Per-concentric-ring bookkeeping, as used by TGR. */
export interface RingTrace {
  concentricIdx: number;
  /** Flatness of this ring's definite-ground cells, this frame. */
  flatnessSamples: number[];
  /** Keys of the cells handed to TGR. */
  candidates: string[];
  /** The per-frame flatness threshold TGR judged them against. */
  mu: number;
}

export interface FrameTrace {
  frameIndex: number;
  cloud: PointCloud;
  params: Params;
  czm: CzmGeometry;

  /** One PointLabel per input point. */
  labels: Uint8Array;
  cells: CellTrace[];
  cellsByKey: Map<string, CellTrace>;
  rings: RingTrace[];

  noiseIndices: Int32Array;
  outOfRangeIndices: Int32Array;

  groundCount: number;
  nonGroundCount: number;

  /** A-GLE state as this frame found it, and as it left it for the next one. */
  stateBefore: AdaptiveState;
  stateAfter: AdaptiveState;

  elapsedMs: number;
  timings: StepTimings;
}
