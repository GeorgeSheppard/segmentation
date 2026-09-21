import { Vector3 } from "three";
import "./style.css";
import type { Timeline } from "./anim/timeline.ts";
import { loadKittiFrame } from "./core/loadFrame.ts";
import { DEFAULT_PARAMS, initialState, segmentGround, type FrameTrace } from "./patchwork/index.ts";
import { StageContext } from "./tutorial/context.ts";
import { STAGES } from "./tutorial/index.ts";
import { Hud } from "./ui/hud.ts";
import { CameraRig } from "./viz/cameraRig.ts";
import { CloudView } from "./viz/cloud.ts";
import {
  applyThemeToCss,
  loadThemeId,
  saveThemeId,
  THEMES,
  type Theme,
  type ThemeId,
} from "./viz/themes.ts";
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

  private theme: Theme;
  private ctx: StageContext | null = null;
  private timeline: Timeline | null = null;
  private index = 0;
  private speed = 1;
  private wasFinished = false;
  private ignoreHashChange = false;

  constructor() {
    const canvas = document.getElementById("view") as HTMLCanvasElement;
    const labels = document.getElementById("labels") as HTMLElement;

    this.theme = THEMES[loadThemeId()];
    applyThemeToCss(this.theme);

    this.viewer = new Viewer(canvas, labels);
    this.viewer.setBackground(this.theme.surface);
    this.rig = new CameraRig(this.viewer);
    this.hud = new Hud({
      onContinue: () => this.onContinue(),
      onPrev: () => this.goTo(this.index - 1),
      onReplay: () => this.buildStage(this.index),
      onSpeed: (s) => (this.speed = s),
      onJump: (i) => this.goTo(i),
      onTheme: (id) => this.setTheme(id),
    });
  }

  async start(): Promise<void> {
    // The scan is ~2 MB of raw float32; on a slow connection it is the whole wait.
    this.hud.setLoading("Fetching the scan…");
    const cloud = await loadKittiFrame(HERO_FRAME, ({ received, total }) => {
      const mb = (received / 1e6).toFixed(1);
      this.hud.setLoading(
        total
          ? `Fetching the scan… ${mb} / ${(total / 1e6).toFixed(1)} MB`
          : `Fetching the scan… ${mb} MB`,
        total ? received / total : undefined,
      );
    });

    this.hud.setLoading(`Segmenting ${cloud.count.toLocaleString()} points…`, 1);
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
    this.hud.setTheme(this.theme.id);
    this.viewer.onFrame((dt) => this.tick(dt));
    this.viewer.start();

    window.addEventListener("hashchange", () => {
      if (this.ignoreHashChange) return;
      this.goTo(this.stageFromHash());
    });

    this.buildStage(this.stageFromHash());
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
    this.hud.showVerdict(null);
    this.cloud.sizeBoost = 1;

    this.ctx = new StageContext(
      this.viewer,
      this.rig,
      this.cloud,
      this.hud,
      this.frame,
      { position: OVERVIEW.position.clone(), target: OVERVIEW.target.clone() },
      this.theme,
    );
    this.timeline = stage.build(this.ctx);
    this.wasFinished = false;
    this.hud.setFinished(false);
    this.hud.setStage(this.index, STAGES.length, stage.title, stage.subtitle);
    this.hud.setRailSteps(stage.steps);
    this.hud.setProgress(0);
    this.syncHash(stage.id);
  }

  /** Every stage is linkable: /#gle jumps straight to Ground Likelihood Estimation. */
  private syncHash(id: string): void {
    if (location.hash === `#${id}`) return;
    this.ignoreHashChange = true;
    history.replaceState(null, "", `#${id}`);
    this.ignoreHashChange = false;
  }

  private stageFromHash(): number {
    const id = location.hash.replace(/^#/, "");
    const i = STAGES.findIndex((s) => s.id === id);
    return i >= 0 ? i : 0;
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

  /** Swapping the theme rebuilds the current stage, since colours are baked at build time. */
  private setTheme(id: ThemeId): void {
    if (id === this.theme.id) return;
    this.theme = THEMES[id];
    applyThemeToCss(this.theme);
    this.viewer.setBackground(this.theme.surface);
    this.hud.setTheme(id);
    saveThemeId(id);
    this.buildStage(this.index);
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
