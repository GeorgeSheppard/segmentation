import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
  type Camera,
  type WebGLRenderer,
} from "three";
import { type PointCloud } from "../patchwork/index.ts";
import { labelColor, type Palette } from "./palette.ts";

const VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aSize;
  uniform float uScale;      // pixels per world unit at one unit of depth
  uniform float uSizeBoost;
  uniform float uWorldSize;  // nominal point radius, in metres
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // Size in world units, projected to pixels, then clamped so distant points stay
    // visible and close-ups do not turn into saucers.
    float px = aSize * uSizeBoost * uWorldSize * uScale / max(0.05, -mv.z);
    gl_PointSize = clamp(px, 1.0, 16.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.015) discard;
    vec2 d = gl_PointCoord - vec2(0.5);
    float r2 = dot(d, d);
    if (r2 > 0.25) discard;
    float edge = smoothstep(0.25, 0.10, r2);
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`;

const scratch = new Color();

/**
 * The scan on screen. Colour, opacity and size are per-point attributes so that any subset
 * of points can be highlighted, dimmed or hidden without rebuilding geometry.
 *
 * Every stage works the same way: set a *base* appearance, then paint deltas on top of it.
 * `restore()` returns to the base, which is what replaying a stage relies on.
 */
export class CloudView {
  readonly points: Points;
  readonly count: number;

  private readonly geometry: BufferGeometry;
  private readonly material: ShaderMaterial;

  private readonly color: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;

  /** Return strength per point, kept for the raw-scan shading. */
  private readonly intensity: Float32Array;

  private readonly baseColor: Float32Array;
  private readonly baseAlpha: Float32Array;
  private readonly baseSize: Float32Array;

  private colorDirty = true;
  private alphaDirty = true;
  private sizeDirty = true;

  constructor(cloud: PointCloud) {
    this.count = cloud.count;
    this.intensity = cloud.intensity;
    this.color = new Float32Array(cloud.count * 3);
    this.alpha = new Float32Array(cloud.count).fill(1);
    this.size = new Float32Array(cloud.count).fill(1);
    this.baseColor = new Float32Array(cloud.count * 3);
    this.baseAlpha = new Float32Array(cloud.count).fill(1);
    this.baseSize = new Float32Array(cloud.count).fill(1);

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(cloud.xyz, 3));
    this.geometry.setAttribute("aColor", new BufferAttribute(this.color, 3));
    this.geometry.setAttribute("aAlpha", new BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute("aSize", new BufferAttribute(this.size, 1));
    this.geometry.computeBoundingSphere();

    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uScale: { value: 400 },
        uSizeBoost: { value: 1 },
        uWorldSize: { value: 0.055 },
      },
      transparent: true,
      depthWrite: false,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }

  /** gl_PointSize is in device pixels, so the scale depends on the drawing buffer. */
  syncProjection(renderer: WebGLRenderer, camera: Camera & { fov?: number }): void {
    const h = renderer.getContext().drawingBufferHeight;
    const fov = ((camera.fov ?? 50) * Math.PI) / 180;
    this.material.uniforms.uScale.value = h / (2 * Math.tan(fov / 2));
  }

  set sizeBoost(v: number) {
    this.material.uniforms.uSizeBoost.value = v;
  }

  /** Nominal point radius in metres. */
  set worldSize(v: number) {
    this.material.uniforms.uWorldSize.value = v;
  }

  // ---------------------------------------------------------------- base appearance

  /**
   * The unclassified scan: one neutral ink, shaded only by return strength.
   *
   * Nothing here may look like an answer. A height ramp did — its bands line up with road,
   * cars and walls, so the scan arrived looking pre-segmented and the first two stages had
   * nothing left to reveal. Intensity is not a class, just the strength of the echo, and a
   * ±20% lightness wobble is enough to keep surfaces from flattening into a grey fog.
   */
  setBaseRaw(color: Color | string, alpha = 1): void {
    const c = color instanceof Color ? color : scratch.set(color as string);
    for (let i = 0; i < this.count; i++) {
      const k = 0.8 + 0.4 * Math.min(1, this.intensity[i]);
      this.baseColor[i * 3] = Math.min(1, c.r * k);
      this.baseColor[i * 3 + 1] = Math.min(1, c.g * k);
      this.baseColor[i * 3 + 2] = Math.min(1, c.b * k);
    }
    this.baseAlpha.fill(alpha);
    this.baseSize.fill(1);
    this.restore();
  }

  /** Colour by the algorithm's verdict — ground or not. */
  setBaseLabels(labels: Uint8Array, palette: Palette): void {
    for (let i = 0; i < this.count; i++) {
      const c = labelColor(labels[i] as never, palette);
      this.baseColor[i * 3] = c.r;
      this.baseColor[i * 3 + 1] = c.g;
      this.baseColor[i * 3 + 2] = c.b;
    }
    this.baseAlpha.fill(1);
    this.baseSize.fill(1);
    this.restore();
  }

  /** Uniform colour for every point. */
  setBaseUniform(color: Color | string, alpha = 1): void {
    const c = color instanceof Color ? color : new Color(color);
    for (let i = 0; i < this.count; i++) {
      this.baseColor[i * 3] = c.r;
      this.baseColor[i * 3 + 1] = c.g;
      this.baseColor[i * 3 + 2] = c.b;
    }
    this.baseAlpha.fill(alpha);
    this.baseSize.fill(1);
    this.restore();
  }

  /** Freeze the current appearance as the new base. */
  captureBase(): void {
    this.baseColor.set(this.color);
    this.baseAlpha.set(this.alpha);
    this.baseSize.set(this.size);
  }

  /** Reset the working appearance to the base. */
  restore(): void {
    this.color.set(this.baseColor);
    this.alpha.set(this.baseAlpha);
    this.size.set(this.baseSize);
    this.colorDirty = true;
    this.alphaDirty = true;
    this.sizeDirty = true;
  }

  // ---------------------------------------------------------------- deltas

  /** Blend a subset toward `color` by `amount` (0 = base colour, 1 = fully `color`). */
  paint(indices: ArrayLike<number>, color: Color | string, amount = 1): void {
    const c = color instanceof Color ? color : new Color(color);
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k] * 3;
      this.color[i] = this.baseColor[i] + (c.r - this.baseColor[i]) * amount;
      this.color[i + 1] = this.baseColor[i + 1] + (c.g - this.baseColor[i + 1]) * amount;
      this.color[i + 2] = this.baseColor[i + 2] + (c.b - this.baseColor[i + 2]) * amount;
    }
    this.colorDirty = true;
  }

  /** Blend every point toward `color`. */
  paintAll(color: Color | string, amount = 1): void {
    const c = color instanceof Color ? color : new Color(color);
    for (let i = 0; i < this.count * 3; i += 3) {
      this.color[i] = this.baseColor[i] + (c.r - this.baseColor[i]) * amount;
      this.color[i + 1] = this.baseColor[i + 1] + (c.g - this.baseColor[i + 1]) * amount;
      this.color[i + 2] = this.baseColor[i + 2] + (c.b - this.baseColor[i + 2]) * amount;
    }
    this.colorDirty = true;
  }

  setAlpha(indices: ArrayLike<number>, alpha: number): void {
    for (let k = 0; k < indices.length; k++) this.alpha[indices[k]] = alpha;
    this.alphaDirty = true;
  }

  /** Interpolate a subset's opacity from its base value toward `alpha`. */
  fadeTo(indices: ArrayLike<number>, alpha: number, amount: number): void {
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      this.alpha[i] = this.baseAlpha[i] + (alpha - this.baseAlpha[i]) * amount;
    }
    this.alphaDirty = true;
  }

  setAlphaAll(alpha: number): void {
    this.alpha.fill(alpha);
    this.alphaDirty = true;
  }

  fadeAllTo(alpha: number, amount: number): void {
    for (let i = 0; i < this.count; i++) {
      this.alpha[i] = this.baseAlpha[i] + (alpha - this.baseAlpha[i]) * amount;
    }
    this.alphaDirty = true;
  }

  setSize(indices: ArrayLike<number>, size: number): void {
    for (let k = 0; k < indices.length; k++) this.size[indices[k]] = size;
    this.sizeDirty = true;
  }

  sizeTo(indices: ArrayLike<number>, size: number, amount: number): void {
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      this.size[i] = this.baseSize[i] + (size - this.baseSize[i]) * amount;
    }
    this.sizeDirty = true;
  }

  /**
   * Dim everything, then bring `focus` back to full opacity and size.
   *
   * The contrast is deliberately extreme: on a visualisation-first page the subject has to
   * be unmistakable, and a barely-dimmed background reads as clutter rather than context.
   */
  focusOn(focus: ArrayLike<number>, dimAlpha: number, amount: number, focusSize = 2.2): void {
    this.fadeAllTo(dimAlpha, amount);
    this.fadeTo(focus, 1, amount);
    this.sizeTo(focus, focusSize, amount);
  }

  commit(): void {
    if (this.colorDirty) {
      (this.geometry.getAttribute("aColor") as BufferAttribute).needsUpdate = true;
      this.colorDirty = false;
    }
    if (this.alphaDirty) {
      (this.geometry.getAttribute("aAlpha") as BufferAttribute).needsUpdate = true;
      this.alphaDirty = false;
    }
    if (this.sizeDirty) {
      (this.geometry.getAttribute("aSize") as BufferAttribute).needsUpdate = true;
      this.sizeDirty = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
