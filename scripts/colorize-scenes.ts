/**
 * Turns a raw KITTI odometry frame (Velodyne scan + the matching left colour camera image +
 * that sequence's calibration) into a coloured, quantized point cloud.
 *
 *   pnpm run data:colorize
 *
 * Real camera colour only exists where a camera actually looked: projecting every point
 * through `P2 @ Tr` and keeping the ones that land in front of the lens and inside the
 * frame typically colours 15–20% of a 360° sweep — the cone the left colour camera covers.
 * Everything outside that cone ships with `colorMask = 0` and gets the usual neutral ink at
 * render time (`CloudView.setBaseCaptured`), exactly like an uncoloured scan.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { parseKittiBin } from "../src/core/kitti.ts";
import { decodeQuantizedCloud, encodeQuantizedCloud, PCQ_SCALE } from "../src/core/pcq.ts";
import type { PointCloud } from "../src/patchwork/index.ts";

const SCENES_DIR = "data/raw/scenes";

/** The handful of lines odometry calibration actually needs: P2 and the Velodyne→cam0 pose. */
function parseCalib(text: string): { p2: Float64Array; tr: Float64Array } {
  const rows = new Map<string, number[]>();
  for (const line of text.split("\n")) {
    const [key, rest] = line.split(":");
    if (!key || !rest) continue;
    rows.set(key.trim(), rest.trim().split(/\s+/).map(Number));
  }
  const p2 = rows.get("P2");
  const tr = rows.get("Tr");
  if (!p2 || !tr) throw new Error("calib.txt missing P2 or Tr");
  // Pad Tr's 3x4 into a 4x4 by appending [0 0 0 1], matching every public odometry loader
  // (pykitti included) — the odometry benchmark's Tr already lands in the *rectified* cam0
  // frame, so projection is just P2 . Tr, no separate R_rect.
  return { p2: Float64Array.from(p2), tr: Float64Array.from([...tr, 0, 0, 0, 1]) };
}

/** y = P2 . Tr . x, one point at a time — small enough scenes that clarity wins over SIMD. */
function project(p2: Float64Array, tr: Float64Array, x: number, y: number, z: number) {
  const cx = tr[0] * x + tr[1] * y + tr[2] * z + tr[3];
  const cy = tr[4] * x + tr[5] * y + tr[6] * z + tr[7];
  const cz = tr[8] * x + tr[9] * y + tr[10] * z + tr[11];
  const ix = p2[0] * cx + p2[1] * cy + p2[2] * cz + p2[3];
  const iy = p2[4] * cx + p2[5] * cy + p2[6] * cz + p2[7];
  const iz = p2[8] * cx + p2[9] * cy + p2[10] * cz + p2[11];
  return { depth: cz, u: ix / iz, v: iy / iz };
}

function colorize(cloud: PointCloud, calibText: string, png: PNG): PointCloud {
  const { p2, tr } = parseCalib(calibText);
  const { xyz, count } = cloud;
  const color = new Float32Array(count * 3);
  const colorMask = new Uint8Array(count);
  let hit = 0;

  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    const { depth, u, v } = project(p2, tr, x, y, z);
    if (depth <= 0.1) continue;
    const px = Math.round(u);
    const py = Math.round(v);
    if (px < 0 || px >= png.width || py < 0 || py >= png.height) continue;
    const o = (py * png.width + px) * 4;
    color[i * 3] = png.data[o] / 255;
    color[i * 3 + 1] = png.data[o + 1] / 255;
    color[i * 3 + 2] = png.data[o + 2] / 255;
    colorMask[i] = 1;
    hit++;
  }

  return { ...cloud, color, colorMask, hitFraction: hit / count } as PointCloud & {
    hitFraction: number;
  };
}

for (const id of readdirSync(SCENES_DIR).sort()) {
  const dir = `${SCENES_DIR}/${id}`;
  let raw: Buffer;
  try {
    raw = readFileSync(`${dir}/velodyne.bin`);
  } catch {
    continue; // not a scene folder (e.g. README.md)
  }

  const cloud = parseKittiBin(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
  );
  const calibText = readFileSync(`${dir}/calib.txt`, "utf8");
  const png = PNG.sync.read(readFileSync(`${dir}/image_2.png`));

  const colored = colorize(cloud, calibText, png) as PointCloud & { hitFraction: number };
  const encoded = encodeQuantizedCloud(colored, PCQ_SCALE);
  writeFileSync(`public/data/scene-${id}.pcq`, Buffer.from(encoded));

  const back = decodeQuantizedCloud(encoded);
  let worst = 0;
  for (let i = 0; i < cloud.count * 3; i++)
    worst = Math.max(worst, Math.abs(cloud.xyz[i] - back.xyz[i]));

  console.log(
    `${id}: ${cloud.count.toLocaleString()} points, ${(colored.hitFraction * 100).toFixed(1)}% coloured, ` +
      `${(encoded.byteLength / 1e6).toFixed(2)} MB, worst position error ${(worst * 1000).toFixed(2)} mm`,
  );
}
