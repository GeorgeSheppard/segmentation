import { binKey, xy2radius, xy2theta, type CzmGeometry } from "../czm.ts";
import type { Params } from "../params.ts";
import type { PointCloud } from "../pointcloud.ts";

/**
 * Step 2: bin the cloud into the Concentric Zone Model.
 *
 * Point density falls off roughly as 1/r², so a uniform polar grid fails twice: cells far
 * out hold too few points to fit anything, and cells up close are smaller than the road's
 * own texture. CZM sizes the cells to match — four zones, each with its own resolution —
 * giving 504 well-conditioned cells instead of the ~3,240 a uniform grid would need.
 *
 * Points outside [minRange, maxRange] are non-ground by definition: the blind spot under
 * the vehicle, and everything past 80 m.
 */
export interface BinnedCloud {
  /** Point indices per cell, keyed by `binKey(zone, ring, sector)`. Unsorted. */
  cells: Map<string, number[]>;
  /** Points that fell outside the annulus. */
  outOfRange: Int32Array;
}

export function binIntoCells(
  cloud: PointCloud,
  removed: Uint8Array,
  czm: CzmGeometry,
  params: Params,
): BinnedCloud {
  const { xyz, count } = cloud;
  const cells = new Map<string, number[]>();
  const outOfRange: number[] = [];

  for (let i = 0; i < count; i++) {
    if (removed[i]) continue;

    const o = i * 3;
    const x = xyz[o];
    const y = xyz[o + 1];
    const r = xy2radius(x, y);

    if (r <= params.minRange || r > params.maxRange) {
      outOfRange.push(i);
      continue;
    }

    const theta = xy2theta(x, y);
    const zone = zoneFor(r, czm);
    const ring = Math.min(
      Math.floor((r - czm.minRanges[zone]) / czm.ringSizes[zone]),
      params.numRingsEachZone[zone] - 1,
    );
    const sector = Math.min(
      Math.floor(theta / czm.sectorSizes[zone]),
      params.numSectorsEachZone[zone] - 1,
    );

    const key = binKey(zone, ring, sector);
    const bucket = cells.get(key);
    if (bucket) bucket.push(i);
    else cells.set(key, [i]);
  }

  return { cells, outOfRange: Int32Array.from(outOfRange) };
}

/** Zone boundaries are minRanges[1..3]; anything at or beyond the last is the outer zone. */
function zoneFor(r: number, czm: CzmGeometry): number {
  if (r >= czm.minRanges[3]) return 3;
  if (r >= czm.minRanges[2]) return 2;
  if (r >= czm.minRanges[1]) return 1;
  return 0;
}

/** Sort a cell's point indices ascending by height, in place. */
export function sortByHeight(xyz: Float32Array, indices: number[]): number[] {
  // Per-cell rather than over the whole cloud: O(L·M log M) instead of O(N log N), which is
  // the change that made Patchwork++ faster than Patchwork.
  indices.sort((a, b) => xyz[a * 3 + 2] - xyz[b * 3 + 2]);
  return indices;
}
