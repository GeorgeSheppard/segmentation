import { stageAgle, stageResult } from "./adaptive.ts";
import { stageGle, stageSweep, stageTgr } from "./classify.ts";
import type { Stage } from "./context.ts";
import { stageRgpf, stageRvpf, stageSeeds } from "./fitting.ts";
import { stageScan } from "./intro.ts";
import { stageCzm, stageRnr } from "./preprocess.ts";
import { stageSensor } from "./sensor.ts";

/** The tutorial, in order. */
export const STAGES: Stage[] = [
  stageSensor,
  stageScan,
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
