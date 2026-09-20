import { stageAgle, stageResult } from "./adaptive.ts";
import { stageGle, stageSweep, stageTgr } from "./classify.ts";
import type { Stage } from "./context.ts";
import { stageRgpf, stageRvpf, stageSeeds } from "./fitting.ts";
import { stageProblem, stageScan } from "./intro.ts";
import { stageCzm, stageRnr } from "./preprocess.ts";

/** The tutorial, in order. */
export const STAGES: Stage[] = [
  stageScan,
  stageProblem,
  stageRnr,
  stageCzm,
  stageSeeds,
  stageRgpf,
  stageRvpf,
  stageGle,
  stageSweep,
  stageTgr,
  stageAgle,
  stageResult,
];

export type { Stage };
