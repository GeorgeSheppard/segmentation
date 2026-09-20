import type { PointCloud } from "../patchwork/types.ts";

/**
 * Read a KITTI Velodyne scan: raw little-endian float32, four values per point
 * (x, y, z, intensity) in the sensor frame — x forward, y left, z up.
 */
export function parseKittiBin(buffer: ArrayBuffer): PointCloud {
  const raw = new Float32Array(buffer);
  const count = Math.floor(raw.length / 4);
  const xyz = new Float32Array(count * 3);
  const intensity = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const s = i * 4;
    const d = i * 3;
    xyz[d] = raw[s];
    xyz[d + 1] = raw[s + 1];
    xyz[d + 2] = raw[s + 2];
    intensity[i] = raw[s + 3];
  }
  return { xyz, intensity, count };
}

export async function loadKittiFrame(index: number): Promise<PointCloud> {
  const name = String(index).padStart(6, "0");
  const url = `${import.meta.env.BASE_URL}data/${name}.bin`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return parseKittiBin(await res.arrayBuffer());
}

/** Axis-aligned bounds of a cloud, useful for framing the camera. */
export function cloudBounds(cloud: PointCloud): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < cloud.count; i++) {
    const o = i * 3;
    for (let a = 0; a < 3; a++) {
      const v = cloud.xyz[o + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  return { min, max };
}
