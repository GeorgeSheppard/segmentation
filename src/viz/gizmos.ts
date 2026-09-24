import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
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
  /** The flat (z = 0) footprint `layOnPlane` drapes, kept untouched so repeated calls —
   * every frame, as a fit settles — always project from the same footprint rather than
   * compounding onto whatever the previous call left behind. */
  private readonly flatXY: Float32Array;

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
    this.flatXY = positions.slice();

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
        this.flatXY[o] = this.xy[o];
        this.flatXY[o + 1] = this.xy[o + 1];
      }
    }
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  layFlat(z: number): void {
    for (let i = 2; i < this.xy.length; i += 3) this.xy[i] = z;
    this.geometry.getAttribute("position").needsUpdate = true;
  }

  /**
   * Drape the surface onto the plane n.p + d = 0, by projecting the flat footprint onto
   * it along the normal.
   *
   * A heightfield (solving z = f(x, y)) is the wrong shape for this: a plane is a function
   * of (x, y) only when it is not vertical, so a near-vertical fit — exactly the case R-VPF
   * exists to catch — drove z toward infinity and had to be clamped, which folded the
   * surface into two flat shelves rather than showing a tilted sheet. Orthogonal projection
   * has no such singularity: every point moves a bounded distance along the normal,
   * whatever the plane's orientation. `clamp` bounds that distance, for a fit so far off
   * that even the projection would dwarf the cell.
   */
  layOnPlane(normal: Vec3, d: number, clamp?: [number, number]): void {
    const [nx, ny, nz] = normal;
    for (let i = 0; i < this.xy.length; i += 3) {
      const x0 = this.flatXY[i];
      const y0 = this.flatXY[i + 1];
      // Signed distance from (x0, y0, 0) to the plane; the projection walks back along
      // the normal by exactly this much.
      let t = nx * x0 + ny * y0 + d;
      if (clamp) t = Math.max(clamp[0], Math.min(clamp[1], t));
      this.xy[i] = x0 - nx * t;
      this.xy[i + 1] = y0 - ny * t;
      this.xy[i + 2] = -nz * t;
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
    color: Color | string,
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

  /** Per zone: the ring polylines and the single LineSegments holding its spokes. */
  private readonly rings: Line[][] = [];
  private readonly spokes: LineSegments[] = [];
  private readonly sectorCounts: number[] = [];

  constructor(czm: CzmGeometry, params: Params, z: number, zoneTints: Color[]) {
    for (let zone = 0; zone < params.numZones; zone++) {
      const material = new LineBasicMaterial({
        color: zoneTints[zone % zoneTints.length],
        transparent: true,
        opacity: 0,
      });
      this.materials.push(material);
      const g = new Group();
      const zoneRings: Line[] = [];

      // Ring boundaries: one circle per ring edge, wound from theta = 0 so that a partial
      // draw range reads as an arc swept anticlockwise from straight ahead.
      for (let ring = 0; ring <= params.numRingsEachZone[zone]; ring++) {
        const r = czm.minRanges[zone] + ring * czm.ringSizes[zone];
        const segs = Math.max(96, Math.round(r * 4));
        const verts: number[] = [];
        for (let i = 0; i <= segs; i++) {
          const a = (2 * Math.PI * i) / segs;
          verts.push(Math.cos(a) * r, Math.sin(a) * r, z);
        }
        const geom = new BufferGeometry();
        geom.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
        const line = new Line(geom, material);
        zoneRings.push(line);
        g.add(line);
      }

      // Sector boundaries: radial spokes spanning the zone, in ascending angle so the
      // draw range reveals them in sweep order.
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
      const seg = new LineSegments(geom, material);

      this.rings.push(zoneRings);
      this.spokes.push(seg);
      this.sectorCounts.push(params.numSectorsEachZone[zone]);
      g.add(seg);

      this.zones.push(g);
      this.group.add(g);
    }
    this.setSweep(1);
  }

  /**
   * How much of a zone has been drawn, as a fraction of one revolution.
   *
   * The grid is polar because the sensor is, so it is built the way the sensor builds a
   * scan: a hand sweeps round from straight ahead, the ring arcs trail behind it, and each
   * spoke appears as the sweep crosses it. At 1 the zone is whole.
   */
  setZoneSweep(zone: number, t: number): void {
    const sweep = Math.max(0, Math.min(1, t));
    for (const line of this.rings[zone] ?? []) {
      const total = line.geometry.getAttribute("position").count;
      line.geometry.setDrawRange(0, Math.round(total * sweep));
    }
    const seg = this.spokes[zone];
    if (seg) {
      const n = this.sectorCounts[zone];
      // A spoke at angle s * (2pi / n) is drawn once the sweep has passed it.
      const revealed = Math.min(n, Math.floor(sweep * n + 1e-6) + (sweep > 0 ? 1 : 0));
      seg.geometry.setDrawRange(0, revealed * 2);
    }
  }

  setSweep(t: number): void {
    for (let i = 0; i < this.zones.length; i++) this.setZoneSweep(i, t);
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

/**
 * The sensor itself: a squat cylinder at the origin, capped by two rims and a notch.
 *
 * The notch is the whole point. A smooth cylinder spinning about its own axis looks
 * perfectly still, and the one thing this gizmo has to say is *which way it is facing
 * right now* — so a single radial tick rides the rim and the body becomes a clock hand.
 */
export class SensorHead {
  readonly group = new Group();

  private readonly bodyMaterial: MeshBasicMaterial;
  private readonly lineMaterial: LineBasicMaterial;
  private readonly geometries: BufferGeometry[] = [];
  private alpha = 1;

  constructor(color: Color | string, radius = 0.18, height = 0.32) {
    const c = new Color(color);

    // three's cylinders run along +y; the sensor's spin axis is +z.
    const shell = new CylinderGeometry(radius, radius, height, 28, 1, true);
    shell.rotateX(Math.PI / 2);
    this.bodyMaterial = new MeshBasicMaterial({
      color: c,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    this.geometries.push(shell);
    this.group.add(new Mesh(shell, this.bodyMaterial));

    this.lineMaterial = new LineBasicMaterial({ color: c, transparent: true });
    for (const z of [-height / 2, height / 2]) this.group.add(this.rim(radius, z));

    // The notch, drawn at theta = 0 so the sweep and the head agree on "straight ahead".
    const notch = new BufferGeometry();
    notch.setAttribute(
      "position",
      new BufferAttribute(
        new Float32Array([radius, 0, 0, radius * 2.4, 0, 0, radius, 0, height / 2, radius, 0, 0]),
        3,
      ),
    );
    this.geometries.push(notch);
    this.group.add(new LineSegments(notch, this.lineMaterial));

    this.group.renderOrder = 5;
    this.opacity = 0;
  }

  private rim(radius: number, z: number): Line {
    const segs = 48;
    const verts: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (2 * Math.PI * i) / segs;
      verts.push(Math.cos(a) * radius, Math.sin(a) * radius, z);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(verts), 3));
    this.geometries.push(g);
    return new Line(g, this.lineMaterial);
  }

  /** Where the head is pointing, in radians anticlockwise from straight ahead. */
  set spin(angle: number) {
    this.group.rotation.z = angle;
  }

  set opacity(v: number) {
    this.alpha = v;
    this.bodyMaterial.opacity = v * 0.3;
    this.lineMaterial.opacity = v;
    this.group.visible = v > 0.002;
  }

  get opacity(): number {
    return this.alpha;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.bodyMaterial.dispose();
    this.lineMaterial.dispose();
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
