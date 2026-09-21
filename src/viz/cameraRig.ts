import { Vector3 } from "three";
import type { ClipHandlers } from "../anim/timeline.ts";
import type { CameraPose, Viewer } from "./viewer.ts";

const EPS = 1e-6;

/**
 * Scripted camera moves.
 *
 * `flyTo` returns clip handlers rather than starting a tween, so a move is just another clip
 * on the stage timeline: it obeys the speed control, and replaying the stage replays the move.
 * The starting pose is captured on entry, which means a move always continues smoothly from
 * wherever the user last dragged the camera to. A move also yields: if the viewer takes hold
 * of the scene mid-flight, the tour leaves the camera alone until the stage is replayed or
 * the view is reset.
 */
export class CameraRig {
  private from: CameraPose | null = null;
  private last: CameraPose | null = null;

  constructor(private readonly viewer: Viewer) {}

  /**
   * The last pose the tour drove the camera to. While the viewer has hold of the camera
   * this stops updating, so it is the view they left — which is the one Recentre restores.
   */
  get lastPose(): CameraPose | null {
    return this.last
      ? { position: this.last.position.clone(), target: this.last.target.clone() }
      : null;
  }

  flyTo(to: CameraPose | (() => CameraPose)): ClipHandlers {
    let target: CameraPose;
    let wasManual = false;
    let resumeT: number | null = null;
    return {
      onEnter: () => {
        this.from = this.viewer.currentPose;
        target = typeof to === "function" ? to() : to;
        wasManual = false;
        resumeT = null;
      },
      onUpdate: (t) => {
        // Once the viewer has dragged the scene themselves, the tour stops steering: the
        // orbit controls stay live the whole time so a gesture is never swallowed.
        const manual = this.viewer.manualControl;
        if (wasManual && !manual) {
          // Regaining control mid-move: the interpolation below is a pure function of `t`
          // and the pose captured at onEnter, so on the very next tick it would otherwise
          // snap straight to wherever that stale maths says the camera should be by now —
          // discarding wherever the reader actually left it. Re-anchor from the camera's
          // real current pose and re-ease only the time that is left, so the move resumes
          // smoothly instead of jumping.
          this.from = this.viewer.currentPose;
          resumeT = t;
        }
        wasManual = manual;
        if (!this.from || manual) return;

        const localT =
          resumeT === null ? t : Math.min(1, (t - resumeT) / Math.max(EPS, 1 - resumeT));
        // Slerp-ish: interpolate the orbit offset in spherical space so the camera arcs
        // around the target instead of cutting through the scene.
        const tgt = new Vector3().lerpVectors(this.from.target, target.target, localT);
        const a = this.from.position.clone().sub(this.from.target);
        const b = target.position.clone().sub(target.target);
        const ra = a.length();
        const rb = b.length();
        const radius = ra + (rb - ra) * localT;

        const dir = slerp(a.normalize(), b.normalize(), localT);
        this.viewer.camera.position.copy(tgt).addScaledVector(dir, radius);
        this.viewer.controls.target.copy(tgt);
        this.viewer.camera.lookAt(tgt);
        this.last = { position: this.viewer.camera.position.clone(), target: tgt.clone() };
      },
      onExit: () => {
        this.from = null;
      },
    };
  }

  /** A slow orbit around the current target, for "look at this" beats. */
  orbit(degrees: number): ClipHandlers {
    let start: CameraPose | null = null;
    let wasManual = false;
    let resumeT: number | null = null;
    return {
      onEnter: () => {
        start = this.viewer.currentPose;
        wasManual = false;
        resumeT = null;
      },
      onUpdate: (t) => {
        const manual = this.viewer.manualControl;
        // Same re-anchoring as flyTo: pick the orbit back up from wherever the reader left
        // it, not from the scripted start pose as if the gesture never happened.
        if (wasManual && !manual) {
          start = this.viewer.currentPose;
          resumeT = t;
        }
        wasManual = manual;
        if (!start || manual) return;

        const localT =
          resumeT === null ? t : Math.min(1, (t - resumeT) / Math.max(EPS, 1 - resumeT));
        const angle = ((degrees * Math.PI) / 180) * localT;
        const offset = start.position.clone().sub(start.target);
        offset.applyAxisAngle(new Vector3(0, 0, 1), angle);
        this.viewer.camera.position.copy(start.target).add(offset);
        this.viewer.controls.target.copy(start.target);
        this.viewer.camera.lookAt(start.target);
        this.last = { position: this.viewer.camera.position.clone(), target: start.target.clone() };
      },
      onExit: () => {
        start = null;
      },
    };
  }
}

function slerp(a: Vector3, b: Vector3, t: number): Vector3 {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  const omega = Math.acos(dot);
  if (omega < EPS) return a.clone().lerp(b, t).normalize();
  const sin = Math.sin(omega);
  return a
    .clone()
    .multiplyScalar(Math.sin((1 - t) * omega) / sin)
    .add(b.clone().multiplyScalar(Math.sin(t * omega) / sin))
    .normalize();
}
