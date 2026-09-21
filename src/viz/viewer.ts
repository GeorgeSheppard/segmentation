import {
  Color,
  MOUSE,
  PerspectiveCamera,
  Scene,
  TOUCH,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/** Vertical FOV the stage framing was authored against, at the aspect below. */
const BASE_FOV = 52;
const BASE_ASPECT = 1.6;
const MAX_FOV = 88;

/**
 * On a portrait phone the caption and transport sit over the lower third of the canvas, so
 * a subject centred in the canvas reads as "down in the corner". Shifting the rendered
 * frame up by this fraction of the height puts it in the part of the screen nothing covers.
 */
const PORTRAIT_LIFT = 0.12;

/**
 * Every camera pose in the tutorial was framed on a wide screen. On a portrait phone the
 * horizontal field of view would shrink to a slot and crop the subject out, so trade
 * vertical FOV to hold the horizontal extent roughly constant.
 */
function fovForAspect(aspect: number): number {
  if (aspect >= BASE_ASPECT) return BASE_FOV;
  const baseHalfV = Math.tan((BASE_FOV * Math.PI) / 360);
  const targetHalfH = baseHalfV * BASE_ASPECT;
  const fov = (2 * Math.atan(targetHalfH / aspect) * 180) / Math.PI;
  return Math.min(MAX_FOV, fov);
}

export interface CameraPose {
  position: Vector3;
  target: Vector3;
}

export function pose(
  position: [number, number, number],
  target: [number, number, number],
): CameraPose {
  return { position: new Vector3(...position), target: new Vector3(...target) };
}

/**
 * Renderer, scene, camera and orbit controls.
 *
 * The world is the KITTI sensor frame — x forward, y left, **z up** — so the camera's up
 * vector is +Z and every coordinate on screen is a number the algorithm actually used.
 */
export class Viewer {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly controls: OrbitControls;

  private readonly onResize = () => this.resize();
  private frameCallbacks: Array<(dt: number) => void> = [];
  private manualCallbacks: Array<(manual: boolean) => void> = [];
  private manual = false;
  private lastTime = 0;
  private running = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    labelContainer: HTMLElement,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.background = new Color("#070a0f");

    this.labelRenderer = new CSS2DRenderer({ element: labelContainer });

    this.camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 1200);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-38, -30, 26);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 400;
    this.controls.minDistance = 0.5;
    this.controls.target.set(0, 0, -1.7);
    // Spelled out rather than left to the defaults, because these are the gestures the
    // on-screen hint promises: one finger turns the scene, two fingers zoom and slide it.
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    this.controls.enablePan = true;
    // Pan along the screen plane. Dragging up moves the scene up, whichever way the
    // camera happens to be tilted, which is what a map-style drag feels like.
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener("start", () => this.setManual(true));

    this.resize();
    window.addEventListener("resize", this.onResize);
  }

  /**
   * True once the viewer has touched or dragged the scene themselves.
   *
   * Scripted camera moves stand down while it is set, so a gesture is never fought by the
   * tour. It clears when the stage changes, is replayed, or the view is reset.
   */
  get manualControl(): boolean {
    return this.manual;
  }

  /** Hand the camera back to the tour. */
  releaseManualControl(): void {
    this.setManual(false);
  }

  onManualChange(cb: (manual: boolean) => void): void {
    this.manualCallbacks.push(cb);
  }

  private setManual(manual: boolean): void {
    if (manual === this.manual) return;
    this.manual = manual;
    for (const cb of this.manualCallbacks) cb(manual);
  }

  /** Scene background; kept in sync with the active theme's surface. */
  setBackground(color: string): void {
    (this.scene.background as Color).set(color);
  }

  add(...objects: Object3D[]): void {
    this.scene.add(...objects);
  }

  remove(...objects: Object3D[]): void {
    this.scene.remove(...objects);
  }

  onFrame(cb: (dt: number) => void): void {
    this.frameCallbacks.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private tick(): void {
    const now = performance.now();
    // Clamp dt so that a backgrounded tab does not fast-forward a whole stage. The cap has
    // to stay above a plausible slow frame (~10 fps on software rendering) or the whole
    // tutorial plays in slow motion on weak hardware.
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    for (const cb of this.frameCallbacks) cb(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.labelRenderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = fovForAspect(this.camera.aspect);

    // Render the lower slice of a slightly taller frame, which lifts everything the camera
    // is pointed at away from the bands along the bottom. The 2D labels are projected with
    // the same matrix, so they move with what they are labelling.
    const lift = w < h ? Math.round(h * PORTRAIT_LIFT) : 0;
    if (lift > 0) this.camera.setViewOffset(w, h + lift, 0, lift, w, h);
    else this.camera.clearViewOffset();

    this.camera.updateProjectionMatrix();
  }

  get currentPose(): CameraPose {
    return {
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
  }

  applyPose(p: CameraPose): void {
    this.camera.position.copy(p.position);
    this.controls.target.copy(p.target);
    this.controls.update();
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.renderer.setAnimationLoop(null);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
