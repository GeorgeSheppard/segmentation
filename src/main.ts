import { Vector3 } from "three";
import "./style.css";
import type { Timeline } from "./anim/timeline.ts";
import { loadKittiFrame } from "./core/loadFrame.ts";
import { type FrameTrace, initialState, segmentGround } from "./patchwork/index.ts";
import { DEFAULT_PARAMS } from "./patchwork/params.ts";
import { STAGES } from "./tutorial/index.ts";
import { StageContext } from "./tutorial/context.ts";
import { Hud } from "./ui/hud.ts";
import { CameraRig } from "./viz/cameraRig.ts";
import { CloudView } from "./viz/cloud.ts";
import { Viewer, type CameraPose } from "./viz/viewer.ts";

/**
 * The scan the tutorial runs on. Frame 5 of the KITTI sample sequence is the one that
 * exercises every module from a cold start — it has reflected noise, a cell where the
 * ground sits on a structure, and a cell that only TGR can resolve.
 */
const HERO_FRAME = 5;

const OVERVIEW: CameraPose = {
  position: new Vector3(-62, -58, 58),
  target: new Vector3(8, -2, -1.7),
};

class App {
  private readonly viewer: Viewer;
  private readonly rig: CameraRig;
  private readonly hud: Hud;
  private cloud!: CloudView;
  private frame!: FrameTrace;

  private ctx: StageContext | null = null;
  private timeline: Timeline | null = null;
  private index = 0;
  private speed = 1;
  private wasFinished = false;

  constructor() {
    const canvas = document.getElementById("view") as HTMLCanvasElement;
    const labels = document.getElementById("labels") as HTMLElement;
    this.viewer = new Viewer(canvas, labels);
    this.rig = new CameraRig(this.viewer);
    this.hud = new Hud({
      onContinue: () => this.onContinue(),
      onPrev: () => this.goTo(this.index - 1),
      onReplay: () => this.buildStage(this.index),
      onSpeed: (s) => (this.speed = s),
      onJump: (i) => this.goTo(i),
    });
  }

  async start(): Promise<void> {
    this.hud.setLoading("Loading LiDAR scan…");
    const cloud = await loadKittiFrame(HERO_FRAME);

    this.hud.setLoading("Running Patchwork++…");
    // Yield so the loading text paints before the (synchronous) segmentation runs.
    await nextFrame();
    this.frame = segmentGround(cloud, HERO_FRAME, DEFAULT_PARAMS, initialState(DEFAULT_PARAMS));

    this.cloud = new CloudView(cloud);
    this.viewer.add(this.cloud.points);
    this.viewer.applyPose({
      position: OVERVIEW.position.clone().multiplyScalar(2.2),
      target: OVERVIEW.target.clone(),
    });

    this.hud.setChapters(STAGES.map((s) => s.title));
    this.viewer.onFrame((dt) => this.tick(dt));
    this.viewer.start();

    this.buildStage(0);
    this.hud.hideLoading();
  }

  private tick(dt: number): void {
    this.cloud.syncProjection(this.viewer.renderer, this.viewer.camera);
    if (this.timeline) {
      this.timeline.advance(dt * this.speed);
      this.hud.setProgress(this.timeline.progress);
      if (this.timeline.finished !== this.wasFinished) {
        this.wasFinished = this.timeline.finished;
        this.hud.setFinished(this.wasFinished);
      }
    }
    this.cloud.commit();
  }

  private buildStage(index: number): void {
    this.index = Math.max(0, Math.min(STAGES.length - 1, index));
    const stage = STAGES[this.index];

    this.ctx?.dispose();
    this.hud.setCaption("");
    this.hud.setLegend(null);
    this.hud.setReadout(null);
    this.cloud.sizeBoost = 1;

    this.ctx = new StageContext(this.viewer, this.rig, this.cloud, this.hud, this.frame, {
      position: OVERVIEW.position.clone(),
      target: OVERVIEW.target.clone(),
    });
    this.timeline = stage.build(this.ctx);
    this.wasFinished = false;
    this.hud.setFinished(false);
    this.hud.setStage(this.index, STAGES.length, stage.title, stage.subtitle);
    this.hud.setProgress(0);
  }

  /** Continue skips to the end of a stage that is still playing, else advances. */
  private onContinue(): void {
    if (this.timeline && !this.timeline.finished) {
      this.timeline.finish();
      return;
    }
    if (this.index === STAGES.length - 1) {
      this.goTo(0);
      return;
    }
    this.goTo(this.index + 1);
  }

  private goTo(index: number): void {
    if (index < 0 || index >= STAGES.length) return;
    this.buildStage(index);
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

new App().start().catch((err) => {
  console.error(err);
  const el = document.getElementById("loading-text");
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
