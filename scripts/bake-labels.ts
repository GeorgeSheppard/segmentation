/**
 * Runs the pipeline once, offline, and writes its final per-point verdict as an RLE1
 * label stream next to the scan it was computed from.
 *
 *   node --experimental-strip-types scripts/bake-labels.ts public/data/scene360-02-010880.pcq
 *   node --experimental-strip-types scripts/bake-labels.ts   # every .pcq in public/data
 *
 * This bakes the *final* label only (see `src/core/labelsRle.ts` for why) — it does not
 * replace running the pipeline in the browser, which the tutorial still needs for the
 * per-cell trace (seeds, R-VPF passes, GLE verdicts, …) behind its own twelve stages. What
 * it is for: colouring a scan — the default one included — without paying for a fresh
 * `segmentGround` call to do it, which matters once more than one scan is on screen at
 * once (see `scripts/rle-estimate.ts`).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { encodeLabelsRle, decodeLabelsRle } from "../src/core/labelsRle.ts";
import { decodeQuantizedCloud } from "../src/core/pcq.ts";
import { DEFAULT_PARAMS, initialState, segmentGround } from "../src/patchwork/index.ts";

const arg = process.argv[2];
const paths = arg
  ? [arg]
  : readdirSync("public/data")
      .filter((f) => f.endsWith(".pcq"))
      .map((f) => `public/data/${f}`);

for (const path of paths) {
  const raw = readFileSync(path);
  const cloud = decodeQuantizedCloud(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
  );
  const trace = segmentGround(cloud, 0, DEFAULT_PARAMS, initialState(DEFAULT_PARAMS));

  const encoded = encodeLabelsRle(trace.labels);
  const outPath = path.replace(/\.pcq$/, ".labels.rle");
  writeFileSync(outPath, Buffer.from(encoded));

  // Round-trip it before trusting the file on disk.
  const back = decodeLabelsRle(encoded);
  if (back.length !== trace.labels.length || !back.every((v, i) => v === trace.labels[i])) {
    throw new Error(`${path}: RLE round-trip mismatch`);
  }

  console.log(
    `${outPath}: ${cloud.count.toLocaleString()} points, ` +
      `${(trace.labels.length / 1024).toFixed(1)} KB raw -> ${(encoded.byteLength / 1024).toFixed(1)} KB`,
  );
}
