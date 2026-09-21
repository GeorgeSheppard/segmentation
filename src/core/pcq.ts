import { type PointCloud } from "../patchwork/index.ts";

/**
 * A quantized point cloud: the format the tutorial actually ships.
 *
 * KITTI stores four float32 per point — 16 bytes for a position the sensor knows to about
 * two centimetres. Positions here are 16-bit fixed point at 2.5 mm, an eighth of the
 * sensor's own accuracy, and intensity is one byte, which the only test that reads it
 * (RNR's, at 0.2) cannot tell from the original. That is 7 bytes a point instead of 16.
 *
 *   magic   4 bytes  "PCQ1"
 *   count   uint32   points
 *   scale   float32  metres per unit
 *   xyz     int16 × 3 × count
 *   inten   uint8  × count
 *
 * Little-endian throughout, which every platform this runs on is.
 */
export const PCQ_MAGIC = 0x31514350; // "PCQ1" read as a little-endian uint32
export const PCQ_HEADER_BYTES = 12;

/** 2.5 mm per unit, which keeps the ±80 m KITTI range inside a signed 16-bit value. */
export const PCQ_SCALE = 1 / 400;

export function encodeQuantizedCloud(cloud: PointCloud, scale = PCQ_SCALE): ArrayBuffer {
  const { xyz, intensity, count } = cloud;
  const buffer = new ArrayBuffer(PCQ_HEADER_BYTES + count * 6 + count);
  const view = new DataView(buffer);
  view.setUint32(0, PCQ_MAGIC, true);
  view.setUint32(4, count, true);
  view.setFloat32(8, scale, true);

  const pos = new Int16Array(buffer, PCQ_HEADER_BYTES, count * 3);
  const inten = new Uint8Array(buffer, PCQ_HEADER_BYTES + count * 6, count);
  const limit = 32767 * scale;
  for (let i = 0; i < count * 3; i++) {
    const clamped = Math.min(limit, Math.max(-limit, xyz[i]));
    pos[i] = Math.round(clamped / scale);
  }
  for (let i = 0; i < count; i++) {
    inten[i] = Math.round(Math.min(1, Math.max(0, intensity[i])) * 255);
  }
  return buffer;
}

export function decodeQuantizedCloud(buffer: ArrayBuffer): PointCloud {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== PCQ_MAGIC) throw new Error("Not a PCQ1 point cloud");
  const count = view.getUint32(4, true);
  const scale = view.getFloat32(8, true);

  // The header is 12 bytes, so the Int16Array view is aligned; the byte offset of the
  // intensity block is whatever follows it.
  const pos = new Int16Array(buffer, PCQ_HEADER_BYTES, count * 3);
  const inten = new Uint8Array(buffer, PCQ_HEADER_BYTES + count * 6, count);

  const xyz = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) xyz[i] = pos[i] * scale;
  const intensity = new Float32Array(count);
  for (let i = 0; i < count; i++) intensity[i] = inten[i] / 255;

  return { xyz, intensity, count };
}
