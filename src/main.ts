import { Vector3 } from "three";
import "./style.css";
import type { Timeline } from "./anim/timeline.ts";
import { loadKittiFrame } from "./core/loadFrame.ts";
import { DEFAULT_PARAMS, initialState, segmentGround, type FrameTrace } from "./patchwork/index.ts";
import { StageContext } from "./tutorial/context.ts";
import { STAGES } from "./tutorial/index.ts";
import { Hud, type TransportState } from "./ui/hud.ts";
import { CameraRig } from "./viz/cameraRig.ts";
import { CloudView } from "./viz/cloud.ts";
import { applyThemeToCss, THEME } from "./viz/themes.ts";
import { Viewer, type CameraPose } from "./viz/viewer.ts";

/**
 * The scan the tutorial runs on: KITTI-360 sequence 02, frame 10880 — a residential street
 * with a steep grade, real camera colour over the whole sweep (see `data/raw/scenes360/`).
 * It exercises every module from a cold start — it has reflected noise, a cell where the
 * ground sits on a structure, and cells that only TGR can resolve.
 */
const HERO_FRAME = "scene360-02-010880";

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
  private playing = false;
  private transportState: TransportState | null = null;
  private ignoreHashChange = false;

  constructor() {
    const canvas = document.getElementById("view") as HTMLCanvasElement;

    applyThemeToCss(THEME);

    this.viewer = new Viewer(canvas);
    this.viewer.setBackground(THEME.surface);
    this.rig = new CameraRig(this.viewer);
    this.hud = new Hud({
      onPlayPause: () => this.onPlayPause(),
      onSeek: (fraction) => this.onSeek(fraction),
      onPrev: () => this.goTo(this.index - 1),
      onReplay: () => this.rebuildTimeline(),
      onJump: (i) => this.goTo(i),
      onRecentre: () => this.recentre(),
      onRestart: () => this.exitExplore(),
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

    // Segmenting ~120,000 points takes about a tenth of a second, so it needs no state of
    // its own — it runs in the gap between the last byte arriving and the first stage.
    this.frame = segmentGround(cloud, 0, DEFAULT_PARAMS, initialState(DEFAULT_PARAMS));

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
    this.hud.setCheckpoints([]);
  }

  private tick(dt: number): void {
    // The render loop runs from first paint, before the scan has landed.
    if (!this.cloud) return;
    this.cloud.syncProjection(this.viewer.renderer, this.viewer.camera);
    if (this.timeline) {
      if (this.playing) {
        this.timeline.advance(dt);
        if (this.timeline.finished) this.playing = false;
      }
      this.hud.setProgress(this.timeline.progress);
      this.updateTransport();
    }
    this.cloud.commit();
  }

  /** Refresh the transport button for whatever the current state actually is. */
  private updateTransport(): void {
    if (!this.timeline) return;
    const state: TransportState = this.timeline.finished
      ? this.index === STAGES.length - 1
        ? "explore"
        : "next"
      : this.playing
        ? "pause"
        : "play";
    if (state === this.transportState) return;
    this.transportState = state;
    this.hud.setTransport(state);
  }

  private buildStage(index: number): void {
    this.index = Math.max(0, Math.min(STAGES.length - 1, index));
    this.rebuildTimeline();
    this.hud.setStage(
      this.index,
      STAGES.length,
      STAGES[this.index].title,
      STAGES[this.index].subtitle,
    );
    this.hud.setRailSteps(STAGES[this.index].steps);
    this.syncHash(STAGES[this.index].id);
  }

  /**
   * Rebuild the current stage's scene and clock from scratch, at time zero. Used both for a
   * fresh stage and for Replay, and as the first half of seeking backward — clips capture
   * their state on entry, so rewinding in place isn't safe; starting over and fast-forwarding
   * to the target time is.
   */
  private rebuildTimeline(): void {
    const stage = STAGES[this.index];

    // A new run takes the camera back, whatever the viewer was looking at.
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
      THEME,
    );
    this.timeline = stage.build(this.ctx);
    // Every stage opens already playing, and plays straight through to the end on its own —
    // Play/Pause only starts mattering once the reader actually wants to stop it.
    this.playing = true;
    this.transportState = null;
    this.hud.setProgress(0);
    // Non-uniform, like YouTube chapter marks: each `say()` in the stage leaves a tick where
    // a new line lands, so the scrubber has somewhere sensible to snap to.
    this.hud.setCheckpoints(this.timeline.checkpointFractions);
    this.updateTransport();
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
    // While a stage is still mid-flight, "where the tour had it" can be one of the close
    // beats — a single cell, the sensor head a few metres away — and handing that straight
    // back strands the reader exactly where they were trying to escape from. Once the stage
    // has finished, `lastPose` is already the overview (every stage's last clip flies
    // there), so this only changes behaviour for a still-running one.
    const target =
      this.timeline && !this.timeline.finished
        ? { position: OVERVIEW.position.clone(), target: OVERVIEW.target.clone() }
        : (this.rig.lastPose ?? {
            position: OVERVIEW.position.clone(),
            target: OVERVIEW.target.clone(),
          });
    this.viewer.applyPose(target);
  }

  /**
   * A standard play/pause toggle. Every stage plays straight through on its own — this is
   * only for a reader who wants to stop it or start it again, never something the tour
   * forces them to press just to keep going. Once the stage is finished the same button
   * moves the tour on, since there is nothing left here to play.
   */
  private onPlayPause(): void {
    if (!this.frame || !this.timeline) return;
    this.hud.flashPlay();
    if (this.timeline.finished) {
      if (this.index === STAGES.length - 1) this.enterExplore();
      else this.goTo(this.index + 1);
      return;
    }
    this.playing = !this.playing;
    this.updateTransport();
  }

  /**
   * Jump straight to `fraction` of the current stage — a click or drag on the progress bar.
   * Forward is a plain seek; going backward means rebuilding the stage from scratch first,
   * since clips capture their state on entry and are never rewound in place.
   */
  private onSeek(fraction: number): void {
    if (!this.frame || !this.timeline) return;
    // Seeking preserves whatever the reader was doing — still playing, or paused right where
    // they left it — rather than always resuming, the way `rebuildTimeline` otherwise would.
    const wasPlaying = this.playing;
    const target = fraction * this.timeline.duration;
    if (target < this.timeline.time) this.rebuildTimeline();
    const timeline = this.timeline;
    if (!timeline) return;
    timeline.seek(target);
    this.playing = wasPlaying && !timeline.finished;
    this.hud.setProgress(timeline.progress);
    this.updateTransport();
  }

  /**
   * The tour is over. Rather than looping back to the start, hand the finished scene over:
   * every band fades out and dragging it is the only thing left to do, until Restart is
   * pressed.
   */
  private enterExplore(): void {
    this.viewer.releaseManualControl();
    this.hud.setExploring(true);
  }

  private exitExplore(): void {
    this.hud.setExploring(false);
    this.goTo(0);
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
}

new App().start().catch((err) => {
  console.error(err);
  const el = document.getElementById("loading-text");
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
