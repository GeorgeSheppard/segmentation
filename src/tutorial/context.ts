import { Color, Group, Vector3 } from "three";
import { Track } from "../anim/timeline.ts";
import type { Vec3 } from "../core/linalg.ts";
import {
  type CellTrace,
  type CzmGeometry,
  type FrameTrace,
  type Params,
} from "../patchwork/index.ts";
import type { StepId } from "../patchwork/index.ts";
import type { Hud, LegendItem } from "../ui/hud.ts";
import { CameraRig } from "../viz/cameraRig.ts";
import type { CloudView } from "../viz/cloud.ts";
import {
  CellOutline,
  CzmGrid,
  Segment,
  SensorHead,
  WedgeSurface,
  cellCentre,
  cellFromBin,
} from "../viz/gizmos.ts";
import { SceneLabel } from "../viz/labels.ts";
import { paletteFor, zoneColors, type Palette } from "../viz/palette.ts";
import type { Theme } from "../viz/themes.ts";
import type { CameraPose, Viewer } from "../viz/viewer.ts";

interface Disposable {
  dispose(): void;
}

/**
 * Everything a stage needs, plus ownership of everything it creates.
 *
 * Objects made through these helpers are parented to a scratch group and disposed when the
 * stage is torn down, so replaying a stage is just "throw it away and build it again".
 */
export class StageContext {
  readonly scratch = new Group();
  private readonly owned: Disposable[] = [];
  private readonly labels: SceneLabel[] = [];

  /** The three meaning-carrying colours plus scaffolding, for the active theme. */
  readonly color: Palette;

  constructor(
    readonly viewer: Viewer,
    readonly rig: CameraRig,
    readonly cloud: CloudView,
    readonly hud: Hud,
    readonly frame: FrameTrace,
    readonly overview: CameraPose,
    readonly theme: Theme,
  ) {
    this.color = paletteFor(theme);
    this.viewer.add(this.scratch);
  }

  get params(): Params {
    return this.frame.params;
  }

  get czm(): CzmGeometry {
    return this.frame.czm;
  }

  /** Nominal road height in the sensor frame — where the CZM grid is drawn. */
  get groundZ(): number {
    return -this.frame.stateBefore.sensorHeight;
  }

  /** Opacity for out-of-focus points in the active theme. */
  get dim(): number {
    return this.theme.contextAlpha;
  }

  get xyz(): Float32Array {
    return this.frame.cloud.xyz;
  }

  /** A new timeline track wired to the caption bar. */
  track(): Track {
    return new Track((text) => this.hud.setCaption(text));
  }

  bin(key: string): CellTrace {
    const b = this.frame.cellsByKey.get(key);
    if (!b) throw new Error(`No such bin: ${key}`);
    return b;
  }

  own<T extends Disposable>(o: T): T {
    this.owned.push(o);
    return o;
  }

  // ---------------------------------------------------------------- factories

  label(
    text: string,
    position: Vector3 | [number, number, number],
    variant: "" | "accent" | "warn" | "good" | "bad" = "",
  ): SceneLabel {
    const l = new SceneLabel(text, variant).setPosition(position);
    this.labels.push(l);
    this.scratch.add(l.object);
    return l;
  }

  /** A free-form annular-sector surface, not tied to a bin. */
  surface(
    r0: number,
    r1: number,
    a0: number,
    a1: number,
    color: Color | string,
    opacity = 0.22,
    angularSegments = 48,
    radialSegments = 12,
  ): WedgeSurface {
    const w = this.own(
      new WedgeSurface(r0, r1, a0, a1, color, opacity, angularSegments, radialSegments),
    );
    w.layFlat(this.groundZ);
    this.scratch.add(w.mesh);
    return w;
  }

  wedge(bin: CellTrace, color: Color | string, opacity = 0.22): WedgeSurface {
    const { r0, r1, a0, a1 } = cellFromBin(this.czm, bin.zone, bin.ring, bin.sector);
    const w = this.own(new WedgeSurface(r0, r1, a0, a1, color, opacity));
    w.layFlat(this.groundZ);
    this.scratch.add(w.mesh);
    return w;
  }

  outline(
    bin: CellTrace,
    zBottom: number,
    zTop: number | null = null,
    color: Color | string = this.color.plane,
  ): CellOutline {
    const { r0, r1, a0, a1 } = cellFromBin(this.czm, bin.zone, bin.ring, bin.sector);
    const o = this.own(new CellOutline(r0, r1, a0, a1, zBottom, zTop, color));
    this.scratch.add(o.group);
    return o;
  }

  segment(color: Color | string, opacity = 1, additive = false): Segment {
    const s = this.own(new Segment(color, opacity, additive));
    this.scratch.add(s.line);
    return s;
  }

  /** The sensor at the origin, for the stage that explains where the points come from. */
  sensorHead(color: Color | string = this.color.normal): SensorHead {
    const h = this.own(new SensorHead(color));
    this.scratch.add(h.group);
    return h;
  }

  grid(z = this.groundZ): CzmGrid {
    const g = this.own(new CzmGrid(this.czm, this.params, z, zoneColors(this.theme)));
    this.scratch.add(g.group);
    return g;
  }

  // ---------------------------------------------------------------- geometry

  centreOf(bin: CellTrace, z = this.groundZ): Vector3 {
    return cellCentre(this.czm, bin.zone, bin.ring, bin.sector, z);
  }

  /** World position of point `i`. */
  pointAt(i: number): Vector3 {
    return new Vector3(this.xyz[i * 3], this.xyz[i * 3 + 1], this.xyz[i * 3 + 2]);
  }

  /** Mean z of a set of points — used to aim the camera at what actually matters. */
  meanZ(indices: ArrayLike<number>): number {
    if (indices.length === 0) return this.groundZ;
    let s = 0;
    for (let k = 0; k < indices.length; k++) s += this.xyz[indices[k] * 3 + 2];
    return s / indices.length;
  }

  /**
   * A three-quarter view of one cell: pulled back along the cell's own radial direction,
   * lifted, and swung sideways so the cell reads as a solid shape rather than a sliver.
   */
  binPose(
    bin: CellTrace,
    opts: { distance?: number; height?: number; swing?: number } = {},
  ): CameraPose {
    const { r0, r1, a0, a1 } = cellFromBin(this.czm, bin.zone, bin.ring, bin.sector);
    const span = Math.max(r1 - r0, ((a1 - a0) * (r0 + r1)) / 2);
    const distance = opts.distance ?? span * 2.0;
    const height = opts.height ?? span * 0.85;
    const swing = opts.swing ?? 0.55;

    const target = this.centreOf(bin, this.meanZ(bin.indices));
    const mid = (a0 + a1) / 2;
    const radial = new Vector3(Math.cos(mid), Math.sin(mid), 0);
    const tangent = new Vector3(-Math.sin(mid), Math.cos(mid), 0);

    const position = target
      .clone()
      .addScaledVector(radial, distance)
      .addScaledVector(tangent, distance * swing)
      .add(new Vector3(0, 0, height));

    return { position, target };
  }

  /** Straight-down view centred on a cell, for showing the CZM footprint. */
  topPose(bin: CellTrace, distance: number): CameraPose {
    const target = this.centreOf(bin, this.groundZ);
    return {
      position: target
        .clone()
        .add(new Vector3(0, 0, distance))
        .add(new Vector3(-0.01, -0.01, 0)),
      target,
    };
  }

  // ---------------------------------------------------------------- HUD sugar

  legend(items: LegendItem[] | null): void {
    this.hud.setLegend(items);
  }

  /**
   * The loud call-out for the moment a step decides something. Used sparingly — one per
   * real verdict — so it keeps its weight.
   */
  verdict(text: string, tone: "good" | "bad" | "focus" = "focus"): void {
    this.hud.showVerdict(text, tone);
  }

  // ---------------------------------------------------------------- teardown

  dispose(): void {
    for (const l of this.labels) l.dispose();
    for (const o of this.owned) o.dispose();
    this.viewer.remove(this.scratch);
    this.scratch.clear();
  }
}

/** Height on a plane above (x, y). */
export function planeZ(normal: Vec3, d: number, x: number, y: number): number {
  const nz = Math.abs(normal[2]) < 1e-4 ? 1e-4 : normal[2];
  return -(normal[0] * x + normal[1] * y + d) / nz;
}

export interface Stage {
  id: string;
  title: string;
  /** One line under the title. May contain inline HTML. */
  subtitle: string;
  /**
   * Which pipeline steps this stage covers — drives the step rail, so the reader can always
   * see where in the algorithm they are. Most stages name one; the full-sweep stage names
   * the per-cell steps it runs end to end. Stages that frame the problem rather than
   * explain a step (how a scan is made, the raw scan, the result) leave it empty.
   */
  steps?: StepId[];
  build(ctx: StageContext): import("../anim/timeline.ts").Timeline;
}

export type { CameraRig };
