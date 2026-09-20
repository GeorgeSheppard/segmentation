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
 * wherever the user last dragged the camera to.
 */
export class CameraRig {
  private from: CameraPose | null = null;

  constructor(private readonly viewer: Viewer) {}

  flyTo(to: CameraPose | (() => CameraPose)): ClipHandlers {
    let target: CameraPose;
    return {
      onEnter: () => {
        this.from = this.viewer.currentPose;
        target = typeof to === "function" ? to() : to;
        this.viewer.controls.enabled = false;
      },
      onUpdate: (t) => {
        if (!this.from) return;
        // Slerp-ish: interpolate the orbit offset in spherical space so the camera arcs
        // around the target instead of cutting through the scene.
        const tgt = new Vector3().lerpVectors(this.from.target, target.target, t);
        const a = this.from.position.clone().sub(this.from.target);
        const b = target.position.clone().sub(target.target);
        const ra = a.length();
        const rb = b.length();
        const radius = ra + (rb - ra) * t;

        const dir = slerp(a.normalize(), b.normalize(), t);
        this.viewer.camera.position.copy(tgt).addScaledVector(dir, radius);
        this.viewer.controls.target.copy(tgt);
        this.viewer.camera.lookAt(tgt);
      },
      onExit: () => {
        this.viewer.controls.enabled = true;
        this.from = null;
      },
    };
  }

  /** A slow orbit around the current target, for "look at this" beats. */
  orbit(degrees: number): ClipHandlers {
    let start: CameraPose | null = null;
    return {
      onEnter: () => {
        start = this.viewer.currentPose;
        this.viewer.controls.enabled = false;
      },
      onUpdate: (t) => {
        if (!start) return;
        const angle = ((degrees * Math.PI) / 180) * t;
        const offset = start.position.clone().sub(start.target);
        offset.applyAxisAngle(new Vector3(0, 0, 1), angle);
        this.viewer.camera.position.copy(start.target).add(offset);
        this.viewer.controls.target.copy(start.target);
        this.viewer.camera.lookAt(start.target);
      },
      onExit: () => {
        this.viewer.controls.enabled = true;
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
