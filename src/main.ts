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
      onRecentre: () => this.recentre(),
    });

    this.viewer.onManualChange((manual) => this.hud.setManualCamera(manual));
  }

  async start(): Promise<void> {
    // Start pulling the scan straight away, then draw the rest of the page around the
    // download rather than behind a curtain.
    this.hud.setLoading("Fetching the scan…");
    const scan = loadKittiFrame(HERO_FRAME, ({ received, total }) => {
      const mb = (received / 1e6).toFixed(1);
      this.hud.setLoading(
        total
          ? `Fetching the scan… ${mb} / ${(total / 1e6).toFixed(1)} MB`
          : `Fetching the scan… ${mb} MB`,
        total ? received / total : undefined,
      );
    });

    this.hud.setBusy(true);
    this.hud.setChapters(STAGES.map((s) => s.title));
    this.hud.setTheme(this.theme.id);
    this.showStageChrome(this.stageFromHash());
    this.viewer.applyPose({
      position: OVERVIEW.position.clone().multiplyScalar(2.2),
      target: OVERVIEW.target.clone(),
    });
    this.viewer.onFrame((dt) => this.tick(dt));
    this.viewer.start();

    window.addEventListener("hashchange", () => {
      if (this.ignoreHashChange) return;
      this.goTo(this.stageFromHash());
    });

    const cloud = await scan;

    // Segmenting 124,000 points takes about a tenth of a second, so it needs no state of
    // its own — it runs in the gap between the last byte arriving and the first stage.
    this.frame = segmentGround(cloud, HERO_FRAME, DEFAULT_PARAMS, initialState(DEFAULT_PARAMS));

    this.cloud = new CloudView(cloud);
    this.viewer.add(this.cloud.points);

    this.hud.setBusy(false);
    this.buildStage(this.stageFromHash());
    this.hud.hideLoading();
    this.hud.armGestureHint();
  }

  /**
   * The titles, rail and chapter list for a stage, without its animation. Used while the
   * scan is still downloading so the page reads as a page, not as a spinner.
   */
  private showStageChrome(index: number): void {
    const stage = STAGES[Math.max(0, Math.min(STAGES.length - 1, index))];
    this.hud.setStage(index, STAGES.length, stage.title, stage.subtitle);
    this.hud.setRailSteps(stage.steps);
    this.hud.setProgress(0);
  }

  private tick(dt: number): void {
    // The render loop runs from first paint, before the scan has landed.
    if (!this.cloud) return;
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

    // A new stage takes the camera back, whatever the viewer was looking at.
    this.viewer.releaseManualControl();

    this.ctx?.dispose();
    this.hud.setCaption("");
    this.hud.setLegend(null);
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

  /** Put the camera back where the tour had it, and let the tour steer again. */
  private recentre(): void {
    this.viewer.releaseManualControl();
    const target = this.rig.lastPose ?? {
      position: OVERVIEW.position.clone(),
      target: OVERVIEW.target.clone(),
    };
    this.viewer.applyPose(target);
  }

  /** Continue skips to the end of a stage that is still playing, else advances. */
  private onContinue(): void {
    if (!this.frame) return;
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
    if (!this.frame) {
      // Still downloading: remember where they asked to go, show its titles, and let
      // `start` build it for real once the points are here.
      this.showStageChrome(index);
      this.syncHash(STAGES[index].id);
      return;
    }
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
    if (this.frame) this.buildStage(this.index);
  }
}

new App().start().catch((err) => {
  console.error(err);
  const el = document.getElementById("loading-text");
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
