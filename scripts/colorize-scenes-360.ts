/**
 * Turns a raw KITTI-360 frame (Velodyne scan + all four of its cameras + the vehicle's
 * calibration) into a coloured, quantized point cloud.
 *
 *   pnpm run data:colorize-360
 *
 * KITTI-360's rig carries two forward perspective cameras (pinhole, ~80° each) *and* two
 * sideways fisheye cameras (MEI omnidirectional model, ~185° each, one facing left and one
 * right). The fisheye pair overlaps in front of and behind the car, so between all four
 * cameras a lidar sweep at ground level typically gets fully covered — nothing like the
 * single forward dash-cam's ~15-20% ceiling in `colorize-scenes.ts`. Every point still gets
 * projected honestly through real calibration; `colorMask = 0` for anything no camera saw
 * (mostly points far above the rig, outside every lens) and it falls back to the usual
 * neutral ink at render time.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import { parseKittiBin } from "../src/core/kitti.ts";
import { decodeQuantizedCloud, encodeQuantizedCloud, PCQ_SCALE } from "../src/core/pcq.ts";
import type { PointCloud } from "../src/patchwork/index.ts";

const SCENES_DIR = "data/raw/scenes360";
const CALIB_DIR = `${SCENES_DIR}/calib`;

type Mat4 = Float64Array; // row-major 4x4

function mat4FromRows3x4(vals: number[]): Mat4 {
  return Float64Array.from([
    ...vals.slice(0, 4),
    ...vals.slice(4, 8),
    ...vals.slice(8, 12),
    0,
    0,
    0,
    1,
  ]);
}

function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = sum;
    }
  }
  return out;
}

/** Gauss-Jordan inverse of a 4x4 — small and clear beats a dependency for four matrices. */
function mat4Invert(m: Mat4): Mat4 {
  const a = Array.from(m);
  const inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let col = 0; col < 4; col++) {
    let pivot = col;
    for (let r = col + 1; r < 4; r++)
      if (Math.abs(a[r * 4 + col]) > Math.abs(a[pivot * 4 + col])) pivot = r;
    if (pivot !== col) {
      for (let c = 0; c < 4; c++) {
        [a[col * 4 + c], a[pivot * 4 + c]] = [a[pivot * 4 + c], a[col * 4 + c]];
        [inv[col * 4 + c], inv[pivot * 4 + c]] = [inv[pivot * 4 + c], inv[col * 4 + c]];
      }
    }
    const d = a[col * 4 + col];
    for (let c = 0; c < 4; c++) {
      a[col * 4 + c] /= d;
      inv[col * 4 + c] /= d;
    }
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = a[r * 4 + col];
      for (let c = 0; c < 4; c++) {
        a[r * 4 + c] -= f * a[col * 4 + c];
        inv[r * 4 + c] -= f * inv[col * 4 + c];
      }
    }
  }
  return Float64Array.from(inv);
}

function mat4Apply(m: Mat4, x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[1] * y + m[2] * z + m[3],
    m[4] * x + m[5] * y + m[6] * z + m[7],
    m[8] * x + m[9] * y + m[10] * z + m[11],
  ];
}

interface Calib {
  /** Velodyne -> vehicle "pose" frame (via cam0). */
  veloToPose: Mat4;
  /** vehicle "pose" frame -> each camera's own optical frame. */
  poseToCam: Record<string, Mat4>;
  perspective: Record<string, number[]>;
}

function parseKeyedFloats(text: string): Map<string, number[]> {
  const rows = new Map<string, number[]>();
  for (const line of text.split("\n")) {
    const [key, ...rest] = line.trim().split(/\s+/);
    if (!key || rest.length === 0) continue;
    const nums = rest.map(Number);
    if (nums.some(Number.isNaN)) continue;
    rows.set(key.replace(/:$/, ""), nums);
  }
  return rows;
}

function loadCalib(): Calib {
  const camToPoseRows = parseKeyedFloats(
    readFileSync(`${CALIB_DIR}/calib_cam_to_pose.txt`, "utf8"),
  );
  const camToVelo3x4 = readFileSync(`${CALIB_DIR}/calib_cam_to_velo.txt`, "utf8")
    .trim()
    .split(/\s+/)
    .map(Number);
  const cam0ToVelo = mat4FromRows3x4(camToVelo3x4);
  const veloToCam0 = mat4Invert(cam0ToVelo);
  const cam0ToPose = mat4FromRows3x4(camToPoseRows.get("image_00")!);
  const veloToPose = mat4Multiply(cam0ToPose, veloToCam0);

  const poseToCam: Record<string, Mat4> = {};
  for (const cam of ["image_00", "image_01", "image_02", "image_03"]) {
    const camToPose = mat4FromRows3x4(camToPoseRows.get(cam)!);
    poseToCam[cam] = mat4Invert(camToPose);
  }

  const perspective = Object.fromEntries(
    parseKeyedFloats(readFileSync(`${CALIB_DIR}/perspective.txt`, "utf8")),
  );
  return { veloToPose, poseToCam, perspective };
}

function loadFisheyeYaml(path: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.includes(":") || trimmed.startsWith("%")) continue;
    const [key, value] = trimmed.split(":");
    const n = Number(value.trim());
    if (!Number.isNaN(n)) out[key.trim()] = n;
  }
  return out;
}

/** Pinhole projection through a rectified perspective camera (image_00 / image_01). */
function projectPerspective(
  veloToCam: Mat4,
  rRect: Mat4,
  pRect: number[],
  x: number,
  y: number,
  z: number,
): { depth: number; u: number; v: number } {
  const [cx, cy, cz] = mat4Apply(veloToCam, x, y, z);
  const [rx, ry, rz] = mat4Apply(rRect, cx, cy, cz);
  const ix = pRect[0] * rx + pRect[1] * ry + pRect[2] * rz + pRect[3];
  const iy = pRect[4] * rx + pRect[5] * ry + pRect[6] * rz + pRect[7];
  const iz = pRect[8] * rx + pRect[9] * ry + pRect[10] * rz + pRect[11];
  return { depth: rz, u: ix / iz, v: iy / iz };
}

/** MEI omnidirectional-camera model for the two sideways fisheye lenses. */
function projectFisheye(
  veloToCam: Mat4,
  params: Record<string, number>,
  x: number,
  y: number,
  z: number,
): { valid: boolean; u: number; v: number } {
  const [cx, cy, cz] = mat4Apply(veloToCam, x, y, z);
  const norm = Math.hypot(cx, cy, cz);
  if (norm < 1e-6) return { valid: false, u: 0, v: 0 };
  const xn = cx / norm;
  const yn = cy / norm;
  const zn = cz / norm;
  const denom = zn + params.xi;
  if (denom <= 1e-6) return { valid: false, u: 0, v: 0 };
  const x2 = xn / denom;
  const y2 = yn / denom;
  const r2 = x2 * x2 + y2 * y2;
  const radial = 1 + params.k1 * r2 + params.k2 * r2 * r2;
  const xd = x2 * radial + 2 * params.p1 * x2 * y2 + params.p2 * (r2 + 2 * x2 * x2);
  const yd = y2 * radial + params.p1 * (r2 + 2 * y2 * y2) + 2 * params.p2 * x2 * y2;
  return { valid: true, u: params.gamma1 * xd + params.u0, v: params.gamma2 * yd + params.v0 };
}

function colorize(cloud: PointCloud, calib: Calib, images: Record<string, PNG>): PointCloud {
  const { xyz, count } = cloud;
  const color = new Float32Array(count * 3);
  const colorMask = new Uint8Array(count);
  let hit = 0;

  const veloToCam: Record<string, Mat4> = {};
  for (const cam of ["image_00", "image_01", "image_02", "image_03"]) {
    veloToCam[cam] = mat4Multiply(calib.poseToCam[cam], calib.veloToPose);
  }
  const rRect00 = mat4FromRows3x4(
    (() => {
      const r = calib.perspective.R_rect_00;
      return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0];
    })(),
  );
  const rRect01 = mat4FromRows3x4(
    (() => {
      const r = calib.perspective.R_rect_01;
      return [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0];
    })(),
  );
  const pRect00 = calib.perspective.P_rect_00;
  const pRect01 = calib.perspective.P_rect_01;
  const [w00, h00] = calib.perspective.S_rect_00;
  const [w01, h01] = calib.perspective.S_rect_01;
  const fish02 = loadFisheyeYaml(`${CALIB_DIR}/image_02.yaml`);
  const fish03 = loadFisheyeYaml(`${CALIB_DIR}/image_03.yaml`);

  const sample = (png: PNG, px: number, py: number): [number, number, number] => {
    const o = (py * png.width + px) * 4;
    return [png.data[o] / 255, png.data[o + 1] / 255, png.data[o + 2] / 255];
  };

  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    let rgb: [number, number, number] | null = null;

    // Forward perspective cameras first — sharpest images, prefer them where they see the point.
    const persp00 = projectPerspective(veloToCam.image_00, rRect00, pRect00, x, y, z);
    if (persp00.depth > 0.1) {
      const px = Math.round(persp00.u);
      const py = Math.round(persp00.v);
      if (px >= 0 && px < w00 && py >= 0 && py < h00) rgb = sample(images.image_00, px, py);
    }
    if (!rgb) {
      const persp01 = projectPerspective(veloToCam.image_01, rRect01, pRect01, x, y, z);
      if (persp01.depth > 0.1) {
        const px = Math.round(persp01.u);
        const py = Math.round(persp01.v);
        if (px >= 0 && px < w01 && py >= 0 && py < h01) rgb = sample(images.image_01, px, py);
      }
    }
    // Sideways fisheye lenses cover everything else.
    if (!rgb) {
      const fe02 = projectFisheye(veloToCam.image_02, fish02, x, y, z);
      if (fe02.valid) {
        const px = Math.round(fe02.u);
        const py = Math.round(fe02.v);
        if (px >= 0 && px < images.image_02.width && py >= 0 && py < images.image_02.height) {
          rgb = sample(images.image_02, px, py);
        }
      }
    }
    if (!rgb) {
      const fe03 = projectFisheye(veloToCam.image_03, fish03, x, y, z);
      if (fe03.valid) {
        const px = Math.round(fe03.u);
        const py = Math.round(fe03.v);
        if (px >= 0 && px < images.image_03.width && py >= 0 && py < images.image_03.height) {
          rgb = sample(images.image_03, px, py);
        }
      }
    }

    if (rgb) {
      color[i * 3] = rgb[0];
      color[i * 3 + 1] = rgb[1];
      color[i * 3 + 2] = rgb[2];
      colorMask[i] = 1;
      hit++;
    }
  }

  return { ...cloud, color, colorMask, hitFraction: hit / count } as PointCloud & {
    hitFraction: number;
  };
}

const calib = loadCalib();

for (const id of readdirSync(SCENES_DIR).sort()) {
  const dir = `${SCENES_DIR}/${id}`;
  let raw: Buffer;
  try {
    raw = readFileSync(`${dir}/velodyne.bin`);
  } catch {
    continue; // not a scene folder (e.g. calib/)
  }

  const cloud = parseKittiBin(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
  );
  const images: Record<string, PNG> = {};
  for (const cam of ["image_00", "image_01", "image_02", "image_03"]) {
    images[cam] = PNG.sync.read(readFileSync(`${dir}/${cam}.png`));
  }

  const colored = colorize(cloud, calib, images) as PointCloud & { hitFraction: number };
  const encoded = encodeQuantizedCloud(colored, PCQ_SCALE);
  writeFileSync(`public/data/scene360-${id}.pcq`, Buffer.from(encoded));

  const back = decodeQuantizedCloud(encoded);
  let worst = 0;
  for (let i = 0; i < cloud.count * 3; i++)
    worst = Math.max(worst, Math.abs(cloud.xyz[i] - back.xyz[i]));

  console.log(
    `${id}: ${cloud.count.toLocaleString()} points, ${(colored.hitFraction * 100).toFixed(1)}% coloured, ` +
      `${(encoded.byteLength / 1e6).toFixed(2)} MB, worst position error ${(worst * 1000).toFixed(2)} mm`,
  );
}
