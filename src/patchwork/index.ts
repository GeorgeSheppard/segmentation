/**
 * Patchwork++ — fast, robust, self-adaptive LiDAR ground segmentation.
 *
 * `segmentGround` is the whole public surface; everything else here is the vocabulary its
 * trace is expressed in. The algorithm itself is one module per step under `./steps/`,
 * composed by `./pipeline.ts`.
 */
export { segmentGround } from "./pipeline.ts";

export { DEFAULT_PARAMS, cloneParams, type Params } from "./params.ts";
export {
  buildCzm,
  binKey,
  ringFromConcentric,
  ringRadii,
  sectorAngles,
  xy2radius,
  xy2theta,
  type CzmGeometry,
} from "./czm.ts";
export { PointLabel, isGroundLabel, paintLabels } from "./labels.ts";
export type { PointCloud } from "./pointcloud.ts";
export { cloneState, initialState, meanStdev, type AdaptiveState } from "./state.ts";
export { PIPELINE_STEPS, type StepId, type StepInfo, type StepTimings } from "./steps/index.ts";
export type { CellTrace, FrameTrace, RingTrace } from "./trace.ts";
export type { GleVerdict } from "./steps/gle.ts";
export type { RgpfIteration } from "./steps/rgpf.ts";
export type { RvpfPass } from "./steps/rvpf.ts";
export type { TgrVerdict } from "./steps/tgr.ts";
export type { SeedSelection } from "./steps/seeds.ts";
