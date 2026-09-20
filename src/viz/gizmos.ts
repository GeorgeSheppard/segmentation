import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import type { Vec3 } from "../core/linalg.ts";
import { type CzmGeometry, type Params, ringRadii, sectorAngles } from "../patchwork/index.ts";
import { COLORS, ZONE_COLORS } from "./palette.ts";

/** Points along an annular-sector outline, counter-clockwise and closed. */
function wedgeOutline(
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  z: number,
  segments = 16,
): Float32Array {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    pts.push(Math.cos(a) * r1, Math.sin(a) * r1, z);
  }
  for (let i = segments; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / segments;
    pts.push(Math.cos(a) * r0, Math.sin(a) * r0, z);
  }
  pts.push(Math.cos(a0) * r1, Math.sin(a0) * r1, z);
  return new Float32Array(pts);
}

/**
 * A filled annular sector — the shape of one CZM cell.
 *
 * The z of every vertex can be rewritten afterwards, which is how a cell becomes the
 * ground plane fitted to it (`layOnPlane`) or a flat lid at some height (`layFlat`).
 */
export class WedgeSurface {
  readonly mesh: Mesh;
  private readonly geometry: BufferGeometry;
  private readonly material: MeshBasicMaterial;
  private readonly xy: Float32Array;

  private readonly a0: number;
  private readonly a1: number;
  private readonly angularSegments: number;
  private readonly radialSegments: number;

  constructor(
    r0: number,
    r1: number,
    a0: number,
    a1: number,
    color: Color | string,
    opacity = 0.25,
    angularSegments = 14,
    radialSegments = 4,
  ) {
    this.a0 = a0;
    this.a1 = a1;
    this.angularSegments = angularSegments;
    this.radialSegments = radialSegments;

    const cols = angularSegments + 1;
    const rows = radialSegments + 1;
    const positions = new Float32Array(cols * rows * 3);
    const indices: number[] = [];

    for (let ri = 0; ri < rows; ri++) {
      const r = r0 + ((r1 - r0) * ri) / radialSegments;
      for (let ai = 0; ai < cols; ai++) {
        const a = a0 + ((a1 - a0) * ai) / angularSegments;
        const o = (ri * cols + ai) * 3;
        positions[o] = Math.cos(a) * r;
        positions[o + 1] = Math.sin(a) * r;
        positions[o + 2] = 0;
      }
    }
    for (let ri = 0; ri < radialSegments; ri++) {
      for (let ai = 0; ai < angularSegments; ai++) {
        const p = ri * cols + ai;
        indices.push(p, p + 1, p + cols, p + 1, p + cols + 1, p + cols);
      }
    }

    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.geometry.setIndex(indices);
    this.xy = positions;

    this.material = new MeshBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity,
      side: DoubleSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.renderOrder = 2;
  }

  /** Move the surface to a different radial band, keeping its angular span. */
  setRadii(r0: number, r1: number): void {
    const cols = this.angularSegments + 1;
    for (let ri = 0; ri <= this.radialSegments; ri++) {
      const r = r0 + ((r1 - r0) * ri) / this.radialSegments;
      for (let ai = 0; ai < cols; ai++) {
        const a = this.a0 + ((this.a1 - this.a0) * ai) / this.angularSegments;
        const o = (ri * cols + ai) * 3;
        this.xy[o] = Math.cos(a) * r;
        this.xy[o + 1] = Math.sin(a) * r;
      }
    }
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  layFlat(z: number): void {
    for (let i = 2; i < this.xy.length; i += 3) this.xy[i] = z;
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  /**
   * Drape the surface onto the plane n.p + d = 0.
   *
   * `clamp` bounds the resulting heights, which matters for a near-vertical fit: without it
   * the draped wedge becomes a sheet hundreds of metres tall.
   */
  layOnPlane(normal: Vec3, d: number, clamp?: [number, number]): void {
    const nz = Math.abs(normal[2]) < 1e-4 ? 1e-4 : normal[2];
    for (let i = 0; i < this.xy.length; i += 3) {
      let z = -(normal[0] * this.xy[i] + normal[1] * this.xy[i + 1] + d) / nz;
      if (clamp) z = Math.max(clamp[0], Math.min(clamp[1], z));
      this.xy[i + 2] = z;
    }
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  set opacity(v: number) {
    this.material.opacity = v;
    this.mesh.visible = v > 0.002;
  }

  set color(c: Color | string) {
    this.material.color.set(c as Color);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** The outline of one CZM cell, optionally extruded into a prism. */
export class CellOutline {
  readonly group = new Group();
  private readonly material: LineBasicMaterial;
  private readonly lines: Line[] = [];

  constructor(
    r0: number,
    r1: number,
    a0: number,
    a1: number,
    zBottom: number,
    zTop: number | null,
    color: Color | string = COLORS.accent,
  ) {
    this.material = new LineBasicMaterial({ color: new Color(color), transparent: true });

    this.addLoop(wedgeOutline(r0, r1, a0, a1, zBottom));
    if (zTop !== null) {
      this.addLoop(wedgeOutline(r0, r1, a0, a1, zTop));
      const corners: Array<[number, number]> = [
        [r0, a0],
        [r1, a0],
        [r0, a1],
        [r1, a1],
      ];
      const verts: number[] = [];
      for (const [r, a] of corners) {
        verts.push(Math.cos(a) * r, Math.sin(a) * r, zBottom);
        verts.push(Math.cos(a) * r, Math.sin(a) * r, zTop);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
      const seg = new LineSegments(g, this.material);
      this.group.add(seg);
    }
    this.group.renderOrder = 3;
  }

  private addLoop(points: Float32Array): void {
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(points, 3));
    const line = new Line(g, this.material);
    this.lines.push(line);
    this.group.add(line);
  }

  set opacity(v: number) {
    this.material.opacity = v;
    this.group.visible = v > 0.002;
  }

  set color(c: Color | string) {
    this.material.color.set(c as Color);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Line || o instanceof LineSegments) o.geometry.dispose();
    });
    this.material.dispose();
  }
}

/**
 * The whole Concentric Zone Model as line work: one group per zone, so the tutorial can
 * build it up zone by zone.
 */
export class CzmGrid {
  readonly group = new Group();
  readonly zones: Group[] = [];
  private readonly materials: LineBasicMaterial[] = [];

  constructor(czm: CzmGeometry, params: Params, z: number) {
    for (let zone = 0; zone < params.numZones; zone++) {
      const material = new LineBasicMaterial({
        color: ZONE_COLORS[zone % ZONE_COLORS.length],
        transparent: true,
        opacity: 0,
      });
      this.materials.push(material);
      const g = new Group();

      // Ring boundaries: one circle per ring edge.
      for (let ring = 0; ring <= params.numRingsEachZone[zone]; ring++) {
        const r = czm.minRanges[zone] + ring * czm.ringSizes[zone];
        const segs = Math.max(48, Math.round(r * 3));
        const verts: number[] = [];
        for (let i = 0; i <= segs; i++) {
          const a = (2 * Math.PI * i) / segs;
          verts.push(Math.cos(a) * r, Math.sin(a) * r, z);
        }
        const geom = new BufferGeometry();
        geom.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
        g.add(new Line(geom, material));
      }

      // Sector boundaries: radial spokes spanning the zone.
      const verts: number[] = [];
      const inner = czm.minRanges[zone];
      const outer = czm.maxRanges[zone];
      for (let s = 0; s < params.numSectorsEachZone[zone]; s++) {
        const a = s * czm.sectorSizes[zone];
        verts.push(Math.cos(a) * inner, Math.sin(a) * inner, z);
        verts.push(Math.cos(a) * outer, Math.sin(a) * outer, z);
      }
      const geom = new BufferGeometry();
      geom.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
      g.add(new LineSegments(geom, material));

      this.zones.push(g);
      this.group.add(g);
    }
  }

  setZoneOpacity(zone: number, v: number): void {
    const m = this.materials[zone];
    if (!m) return;
    m.opacity = v;
    this.zones[zone].visible = v > 0.002;
  }

  setOpacity(v: number): void {
    for (let i = 0; i < this.materials.length; i++) this.setZoneOpacity(i, v);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof Line || o instanceof LineSegments) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

/** A straight line between two points — LiDAR rays, normals, drop lines. */
export class Segment {
  readonly line: Line;
  private readonly geometry: BufferGeometry;
  private readonly material: LineBasicMaterial;
  private readonly verts = new Float32Array(6);

  constructor(color: Color | string, opacity = 1, additive = false) {
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute("position", new BufferAttribute(this.verts, 3));
    this.material = new LineBasicMaterial({
      color: new Color(color),
      transparent: true,
      opacity,
      blending: additive ? AdditiveBlending : undefined,
      depthWrite: false,
    });
    this.line = new Line(this.geometry, this.material);
    this.line.renderOrder = 4;
  }

  set(a: Vector3 | Vec3, b: Vector3 | Vec3): void {
    const av = a instanceof Vector3 ? [a.x, a.y, a.z] : a;
    const bv = b instanceof Vector3 ? [b.x, b.y, b.z] : b;
    this.verts.set([...av, ...bv]);
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  set opacity(v: number) {
    this.material.opacity = v;
    this.line.visible = v > 0.002;
  }

  set color(c: Color | string) {
    this.material.color.set(c as Color);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Build a cell outline / surface straight from a bin's polar extent. */
export function cellFromBin(
  czm: CzmGeometry,
  zone: number,
  ring: number,
  sector: number,
): { r0: number; r1: number; a0: number; a1: number } {
  const [r0, r1] = ringRadii(czm, zone, ring);
  const [a0, a1] = sectorAngles(czm, zone, sector);
  return { r0, r1, a0, a1 };
}

/** Centre of a cell in world space, at height z. */
export function cellCentre(
  czm: CzmGeometry,
  zone: number,
  ring: number,
  sector: number,
  z: number,
): Vector3 {
  const { r0, r1, a0, a1 } = cellFromBin(czm, zone, ring, sector);
  const r = (r0 + r1) / 2;
  const a = (a0 + a1) / 2;
  return new Vector3(Math.cos(a) * r, Math.sin(a) * r, z);
}
