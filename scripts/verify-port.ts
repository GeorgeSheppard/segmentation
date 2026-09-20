/**
 * Cross-checks the TypeScript port against the NumPy reference prototype.
 * Run: node --experimental-strip-types scripts/verify-port.ts
 */
import { readFileSync } from "node:fs";
import { parseKittiBin } from "../src/core/kitti.ts";
import { segmentGround } from "../src/patchwork/algorithm.ts";
import { DEFAULT_PARAMS } from "../src/patchwork/params.ts";
import { initialState, PointLabel, isGroundLabel } from "../src/patchwork/types.ts";

const state0 = initialState(DEFAULT_PARAMS);

for (let frame = 0; frame < 6; frame++) {
  const name = String(frame).padStart(6, "0");
  const buf = readFileSync(`public/data/${name}.bin`);
  const cloud = parseKittiBin(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const t = segmentGround(cloud, frame, DEFAULT_PARAMS, state0);

  let ground = 0;
  const byLabel = new Map<number, number>();
  for (let i = 0; i < t.labels.length; i++) {
    if (isGroundLabel(t.labels[i] as PointLabel)) ground++;
    byLabel.set(t.labels[i], (byLabel.get(t.labels[i]) ?? 0) + 1);
  }
  const rvpf = byLabel.get(PointLabel.VerticalPlane) ?? 0;
  const candidates = t.bins.filter((b) => b.gle?.decision === "candidate").length;
  const reverted = t.bins.filter((b) => b.tgr?.reverted).length;
  const definite = t.bins.filter((b) => b.gle?.isDefiniteGround).length;
  const fitted = t.bins.filter((b) => b.plane !== null).length;

  console.log(
    `cold frame ${frame}: points=${cloud.count} noise=${t.noiseIndices.length} ` +
      `ground=${ground} nonground=${cloud.count - ground} ` +
      `bins=${fitted} definite=${definite} cand=${candidates} reverted=${reverted} ` +
      `rvpf=${rvpf} (${t.elapsedMs.toFixed(0)} ms)`,
  );
  if (ground !== t.groundCount) {
    console.error(`  !! label/counter mismatch: ${ground} vs ${t.groundCount}`);
  }
  const unassigned = byLabel.get(PointLabel.Unassigned) ?? 0;
  if (unassigned) console.error(`  !! ${unassigned} unassigned points`);
}
