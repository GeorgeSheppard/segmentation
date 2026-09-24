/**
 * Exploration script: how much would RLE-encoded ground/not-ground labels cost, and what
 * would it take to stream several scans for "explore" playback?
 *
 *   node --experimental-strip-types scripts/rle-estimate.ts
 *
 * Not wired into the build — this is a one-off measurement to size the frame-streaming PR
 * before committing to a wire format.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { decodeQuantizedCloud } from "../src/core/pcq.ts";
import {
  DEFAULT_PARAMS,
  initialState,
  isGroundLabel,
  segmentGround,
} from "../src/patchwork/index.ts";

/** Count-then-value RLE over a byte stream, run lengths varint-encoded (7 bits/byte, MSB continues). */
function rleBytes(values: Uint8Array, distinctValues: number): number {
  let bytes = 0;
  let i = 0;
  while (i < values.length) {
    const v = values[i];
    let run = 1;
    while (i + run < values.length && values[i + run] === v) run++;
    // One byte for the value if it fits, plus a varint run length.
    bytes += distinctValues <= 256 ? 1 : 2;
    let r = run;
    do {
      bytes += 1;
      r >>>= 7;
    } while (r > 0);
    i += run;
  }
  return bytes;
}

function gzipEstimate(buf: Uint8Array): number {
  return gzipSync(buf, { level: 9 }).byteLength;
}

const files = readdirSync("public/data")
  .filter((f) => f.endsWith(".pcq"))
  .sort();

console.log(
  "frame".padEnd(28) +
    "points".padStart(9) +
    "pcq KB".padStart(9) +
    "labels raw KB".padStart(15) +
    "labels RLE KB".padStart(15) +
    "labels RLE+gz KB".padStart(18) +
    "binary RLE KB".padStart(15) +
    "binary RLE+gz KB".padStart(18),
);

let totalPcq = 0;
let totalBinaryRle = 0;
let frameCount = 0;

for (const file of files) {
  const path = `public/data/${file}`;
  const pcqBytes = statSync(path).size;
  const buf = readFileSync(path);
  const cloud = decodeQuantizedCloud(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const trace = segmentGround(cloud, 0, DEFAULT_PARAMS, initialState(DEFAULT_PARAMS));

  const fullRle = rleBytes(trace.labels, 16);
  const fullRleGz = gzipEstimate(Uint8Array.from(trace.labels));

  const binary = new Uint8Array(cloud.count);
  for (let i = 0; i < cloud.count; i++) binary[i] = isGroundLabel(trace.labels[i] as never) ? 1 : 0;
  const binaryRle = rleBytes(binary, 2);
  const binaryRleGz = gzipEstimate(binary);

  console.log(
    file.padEnd(28) +
      cloud.count.toLocaleString().padStart(9) +
      (pcqBytes / 1024).toFixed(1).padStart(9) +
      (cloud.count / 1024).toFixed(1).padStart(15) +
      (fullRle / 1024).toFixed(1).padStart(15) +
      (fullRleGz / 1024).toFixed(1).padStart(18) +
      (binaryRle / 1024).toFixed(1).padStart(15) +
      (binaryRleGz / 1024).toFixed(1).padStart(18),
  );

  totalPcq += pcqBytes;
  totalBinaryRle += binaryRle;
  frameCount++;
}

const avgPcqKB = totalPcq / frameCount / 1024;
const avgLabelKB = totalBinaryRle / frameCount / 1024;
console.log(
  `\naverage per frame: ${avgPcqKB.toFixed(1)} KB scan + ${avgLabelKB.toFixed(1)} KB ground/not-ground labels` +
    ` = ${(avgPcqKB + avgLabelKB).toFixed(1)} KB/frame`,
);

for (const n of [5, 10, 20, 30, 60]) {
  const totalMB = (n * (avgPcqKB + avgLabelKB)) / 1024;
  console.log(
    `  ${n} frames buffered  ~${totalMB.toFixed(2)} MB  (scan-only: ~${((n * avgPcqKB) / 1024).toFixed(2)} MB)`,
  );
}
