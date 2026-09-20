import type { Params } from "./params.ts";

/** Geometry of the Concentric Zone Model: zone boundaries, ring and sector sizes. */
export interface CzmGeometry {
  /** Inner radius of each zone. */
  minRanges: number[];
  /** Outer radius of each zone (last one is maxRange). */
  maxRanges: number[];
  /** Radial width of one ring, per zone. */
  ringSizes: number[];
  /** Angular width of one sector, per zone. */
  sectorSizes: number[];
  /** Total number of bins. */
  numBins: number;
  /** Global concentric ring index of (zone, ring). */
  concentricIndex: (zone: number, ring: number) => number;
}

export function buildCzm(p: Params): CzmGeometry {
  const lo = p.minRange;
  const hi = p.maxRange;
  // Zone boundaries are fixed fractions of the range (Patchwork, eq. 3).
  const minRanges = [lo, (7 * lo + hi) / 8, (3 * lo + hi) / 4, (lo + hi) / 2];
  const maxRanges = [minRanges[1], minRanges[2], minRanges[3], hi];

  const ringSizes = minRanges.map(
    (min, z) => (maxRanges[z] - min) / p.numRingsEachZone[z],
  );
  const sectorSizes = p.numSectorsEachZone.map((n) => (2 * Math.PI) / n);

  const ringOffsets: number[] = [];
  let acc = 0;
  for (let z = 0; z < p.numZones; z++) {
    ringOffsets.push(acc);
    acc += p.numRingsEachZone[z];
  }

  let numBins = 0;
  for (let z = 0; z < p.numZones; z++) {
    numBins += p.numRingsEachZone[z] * p.numSectorsEachZone[z];
  }

  return {
    minRanges,
    maxRanges,
    ringSizes,
    sectorSizes,
    numBins,
    concentricIndex: (zone, ring) => ringOffsets[zone] + ring,
  };
}

/** Inverse of `concentricIndex`: which (zone, ring) is this global ring? */
export function ringFromConcentric(
  p: Params,
  concentricIdx: number,
): { zone: number; ring: number } {
  let acc = 0;
  for (let zone = 0; zone < p.numZones; zone++) {
    const n = p.numRingsEachZone[zone];
    if (concentricIdx < acc + n) return { zone, ring: concentricIdx - acc };
    acc += n;
  }
  return { zone: p.numZones - 1, ring: p.numRingsEachZone[p.numZones - 1] - 1 };
}

/** Radial extent [inner, outer] of a given ring. */
export function ringRadii(
  czm: CzmGeometry,
  zone: number,
  ring: number,
): [number, number] {
  const inner = czm.minRanges[zone] + ring * czm.ringSizes[zone];
  return [inner, inner + czm.ringSizes[zone]];
}

/** Angular extent [start, end] of a given sector, in radians on [0, 2pi). */
export function sectorAngles(
  czm: CzmGeometry,
  zone: number,
  sector: number,
): [number, number] {
  const start = sector * czm.sectorSizes[zone];
  return [start, start + czm.sectorSizes[zone]];
}

/** Polar angle on [0, 2pi) — NOT atan2's [-pi, pi]. */
export function xy2theta(x: number, y: number): number {
  const a = Math.atan2(y, x);
  return a >= 0 ? a : a + 2 * Math.PI;
}

export function xy2radius(x: number, y: number): number {
  return Math.hypot(x, y);
}

/** Stable key for a bin, used to address traces. */
export function binKey(zone: number, ring: number, sector: number): string {
  return `${zone}/${ring}/${sector}`;
}
