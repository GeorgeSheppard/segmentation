/**
 * Headlessly runs the pipeline on an arbitrary .pcq and prints the cells matching each of
 * the tutorial's four hand-picked teaching moments (`FIT_CELL`/`GOOD_CELL`, `VERTICAL_CELL`,
 * `ROOF_CELL`, `WALL_CELL` in `src/tutorial/fitting.ts` and `src/tutorial/classify.ts`), so
 * swapping the default scan doesn't mean re-picking them by trial and error in the browser.
 *
 *   node --experimental-strip-types scripts/dump-cells.ts public/data/scene360-02-011000.pcq
 */
import { readFileSync } from "node:fs";
import { decodeQuantizedCloud } from "../src/core/pcq.ts";
import { DEFAULT_PARAMS, initialState, segmentGround } from "../src/patchwork/index.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: dump-cells.ts <path.pcq>");
  process.exit(1);
}

const buf = readFileSync(path);
const cloud = decodeQuantizedCloud(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
);
const trace = segmentGround(cloud, 0, DEFAULT_PARAMS, initialState(DEFAULT_PARAMS));
console.log(`${cloud.count.toLocaleString()} points, ${trace.cells.length} cells`);

const zSpread = (idx: Int32Array) => {
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of idx) {
    const z = cloud.xyz[i * 3 + 2];
    if (z < lo) lo = z;
    if (z > hi) hi = z;
  }
  return hi - lo;
};

console.log("\n=== GOOD/FIT candidates (ground, 'elevated but flat enough') ===");
for (const c of trace.cells) {
  if (c.gle?.decision === "ground" && c.gle.reason === "elevated, but flat enough") {
    console.log(
      `${c.key}  n=${c.indices.length}  zSpread=${zSpread(c.indices).toFixed(2)}m  ` +
        `flatness=${c.gle.flatness.toExponential(2)}  elevation=${c.gle.elevation.toFixed(2)}  ` +
        `radii=[${c.radii.map((r) => r.toFixed(1))}]`,
    );
  }
}

console.log("\n=== broader ground candidates, zone 0, sorted by point count (big mixed cell) ===");
const groundBroad = trace.cells
  .filter((c) => c.gle?.decision === "ground" && c.zone === 0 && zSpread(c.indices) > 0.7)
  .sort((a, b) => b.indices.length - a.indices.length)
  .slice(0, 10);
for (const c of groundBroad) {
  console.log(
    `${c.key}  n=${c.indices.length}  zSpread=${zSpread(c.indices).toFixed(2)}m  reason="${c.gle!.reason}"  ` +
      `flatness=${c.gle!.flatness.toExponential(2)}  radii=[${c.radii.map((r) => r.toFixed(1))}]  ` +
      `angles=[${c.angles.map((a) => ((a * 180) / Math.PI).toFixed(0))}]deg`,
  );
}

console.log("\n=== ROOF candidates (nonground, 'plane sits above the sensor origin') ===");
for (const c of trace.cells) {
  if (c.gle?.decision === "nonground" && c.gle.reason === "plane sits above the sensor origin") {
    console.log(
      `${c.key}  n=${c.indices.length}  heading=${c.gle.heading.toFixed(2)}m  ` +
        `uprightness=${c.gle.uprightness.toFixed(3)}  radii=[${c.radii.map((r) => r.toFixed(1))}]  ` +
        `angles=[${c.angles.map((a) => ((a * 180) / Math.PI).toFixed(0))}]deg`,
    );
  }
}

console.log("\n=== WALL candidates (nonground, 'not upright') ===");
for (const c of trace.cells) {
  if (c.gle && !c.gle.isUpright && c.indices.length > 20) {
    console.log(
      `${c.key}  n=${c.indices.length}  uprightness=${c.gle.uprightness.toFixed(3)}  ` +
        `radii=[${c.radii.map((r) => r.toFixed(1))}]  angles=[${c.angles.map((a) => ((a * 180) / Math.PI).toFixed(0))}]deg`,
    );
  }
}

console.log("\n=== VERTICAL/R-VPF candidates (zone 0, at least one peeled pass) ===");
let zone0Count = 0;
let rvpfNonEmpty = 0;
for (const c of trace.cells) {
  if (c.zone !== 0) continue;
  zone0Count++;
  if (c.rvpf.length > 0) rvpfNonEmpty++;
  const peeledPasses = c.rvpf.filter((p) => p.peeled);
  if (peeledPasses.length === 0) continue;
  console.log(
    `${c.key}  n=${c.indices.length}  passes=${c.rvpf.length}  peeled=${peeledPasses.length}  ` +
      `firstUprightness=${c.rvpf[0].plane.normal[2].toFixed(3)}  ` +
      `finalDecision=${c.gle?.decision ?? "no-fit"}  radii=[${c.radii.map((r) => r.toFixed(1))}]  ` +
      `angles=[${c.angles.map((a) => ((a * 180) / Math.PI).toFixed(0))}]deg`,
  );
}
console.log(`(zone 0 has ${zone0Count} cells, ${rvpfNonEmpty} ran R-VPF at all)`);
