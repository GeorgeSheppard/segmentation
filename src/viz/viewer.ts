import { Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer, type Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";

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

    this.camera = new PerspectiveCamera(52, 1, 0.1, 1200);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(-38, -30, 26);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 400;
    this.controls.minDistance = 0.5;
    this.controls.target.set(0, 0, -1.7);

    this.resize();
    window.addEventListener("resize", this.onResize);
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
