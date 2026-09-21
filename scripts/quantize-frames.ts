/**
 * Turns the raw KITTI scans in `data/raw` into the quantized clouds the site serves.
 *
 *   pnpm run data:quantize
 *
 * The raw scans stay out of `public/` so they are never shipped: at 2 MB each they were
 * most of the wait on a phone, and 16 bytes a point is four times what the tutorial needs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseKittiBin } from "../src/core/kitti.ts";
import { decodeQuantizedCloud, encodeQuantizedCloud, PCQ_SCALE } from "../src/core/pcq.ts";

const FRAMES = 6;

for (let frame = 0; frame < FRAMES; frame++) {
  const name = String(frame).padStart(6, "0");
  const raw = readFileSync(`data/raw/${name}.bin`);
  const cloud = parseKittiBin(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
  );

  const encoded = encodeQuantizedCloud(cloud, PCQ_SCALE);
  writeFileSync(`public/data/${name}.pcq`, Buffer.from(encoded));

  // Report the worst error this cost, so the trade is a measured one and not a hope.
  const back = decodeQuantizedCloud(encoded);
  let worst = 0;
  for (let i = 0; i < cloud.count * 3; i++) {
    worst = Math.max(worst, Math.abs(cloud.xyz[i] - back.xyz[i]));
  }
  console.log(
    `${name}: ${cloud.count.toLocaleString()} points  ` +
      `${(raw.byteLength / 1e6).toFixed(2)} MB -> ${(encoded.byteLength / 1e6).toFixed(2)} MB  ` +
      `worst position error ${(worst * 1000).toFixed(2)} mm`,
  );
}
