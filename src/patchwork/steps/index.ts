/**
 * The pipeline, as data.
 *
 * Patchwork++ is strictly sequential, so each step lives in its own module and this file is
 * the running order. `pipeline.ts` composes exactly these, in exactly this order, and
 * reports a timing per step against these ids.
 */

export type StepId = "rnr" | "czm" | "seeds" | "rvpf" | "rgpf" | "gle" | "tgr" | "agle";

export interface StepInfo {
  id: StepId;
  /** Short name, as the paper writes it. */
  name: string;
  /** One line on what it does. */
  summary: string;
  /** Whether it runs once per frame, once per cell, or once per concentric ring. */
  scope: "frame" | "cell" | "ring";
  /** False for steps folded into another step's timing. */
  timed: boolean;
}

export const PIPELINE_STEPS: readonly StepInfo[] = [
  {
    id: "rnr",
    name: "RNR",
    summary: "Drop mirror-reflection points that would poison the seeding.",
    scope: "frame",
    timed: true,
  },
  {
    id: "czm",
    name: "CZM",
    summary: "Bin the cloud into 504 polar cells sized to the density falloff.",
    scope: "frame",
    timed: true,
  },
  {
    id: "seeds",
    name: "Seeds",
    summary: "Lowest Point Representative: the deterministic seed set for a plane fit.",
    scope: "cell",
    timed: false, // measured inside R-VPF and R-GPF, which are its only callers
  },
  {
    id: "rvpf",
    name: "R-VPF",
    summary: "Peel vertical structure off so ground resting on it survives.",
    scope: "cell",
    timed: true,
  },
  {
    id: "rgpf",
    name: "R-GPF",
    summary: "Three PCA refinements turning the seed set into a ground plane.",
    scope: "cell",
    timed: true,
  },
  {
    id: "gle",
    name: "GLE",
    summary: "Veto planes that are not ground: uprightness, elevation, flatness.",
    scope: "cell",
    timed: true,
  },
  {
    id: "tgr",
    name: "TGR",
    summary: "Re-hear borderline cells against their own ring, this frame.",
    scope: "ring",
    timed: true,
  },
  {
    id: "agle",
    name: "A-GLE",
    summary: "Measure next frame's thresholds, and the sensor height, from definite ground.",
    scope: "frame",
    timed: true,
  },
] as const;

/** Milliseconds spent in each timed step of one frame. */
export type StepTimings = Record<StepId, number>;

export function emptyTimings(): StepTimings {
  return {
    rnr: 0,
    czm: 0,
    seeds: 0,
    rvpf: 0,
    rgpf: 0,
    gle: 0,
    tgr: 0,
    agle: 0,
  };
}

export { removeReflectedNoise, type RnrResult } from "./rnr.ts";
export { binIntoCells, sortByHeight, type BinnedCloud } from "./binning.ts";
export { selectSeeds, type SeedSelection } from "./seeds.ts";
export { peelVerticalPlanes, type RvpfPass, type RvpfResult } from "./rvpf.ts";
export { fitGroundPlane, type RgpfIteration, type RgpfResult } from "./rgpf.ts";
export { evaluateGle, type GleVerdict } from "./gle.ts";
export {
  judgeCandidate,
  ringFlatness,
  type RingFlatness,
  type TgrCandidate,
  type TgrVerdict,
} from "./tgr.ts";
export { recordDefiniteGround, updateThresholds } from "./agle.ts";
