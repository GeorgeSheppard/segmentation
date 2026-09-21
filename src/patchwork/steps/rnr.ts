import type { Params } from "../params.ts";
import type { PointCloud } from "../pointcloud.ts";

/**
 * Step 1: Reflected Noise Removal.
 *
 * A beam that hits something mirror-like (a bonnet, a roof, glass) bounces, travels further
 * and returns late, so the sensor reports a *virtual* point far out along the outgoing ray —
 * metres below the road. Seeding takes the lowest points in a cell, so one such point tips
 * an entire cell's plane over.
 *
 * A point is removed only if all three hold, which is what keeps this safe on a downhill
 * where a blunt height filter would delete real road:
 *
 *   1. it came from a downward ray   (only low rings can produce a reflection)
 *   2. it is well below the road     (using the height A-GLE measured, not a constant)
 *   3. it came back dim              (the extra bounce costs energy)
 *
 * The paper phrases test 1 as "the bottom `Nnoise` rings"; the released code uses the
 * equivalent vertical-angle test, which does not need ring indices in the input.
 */
export interface RnrResult {
  /** Indices removed as reflected noise, in scan order. */
  noise: Int32Array;
  /** Per-point flag, indexed by point index — 1 where removed. */
  removed: Uint8Array;
}

export function removeReflectedNoise(
  cloud: PointCloud,
  params: Params,
  sensorHeight: number,
): RnrResult {
  const removed = new Uint8Array(cloud.count);
  if (!params.enableRNR) return { noise: new Int32Array(0), removed };

  const { xyz, intensity, count } = cloud;
  const zFloor = -sensorHeight - 0.8;
  const noise: number[] = [];

  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const r = Math.hypot(xyz[o], xyz[o + 1]);
    const z = xyz[o + 2];
    const verticalAngleDeg = (Math.atan2(z, r) * 180) / Math.PI;

    if (
      verticalAngleDeg < params.rnrVerAngleThr &&
      z < zFloor &&
      intensity[i] < params.rnrIntensityThr
    ) {
      noise.push(i);
      removed[i] = 1;
    }
  }

  return { noise: Int32Array.from(noise), removed };
}
