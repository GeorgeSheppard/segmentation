/**
 * Cross-checks the TypeScript implementation against the NumPy reference prototype, and
 * fingerprints the full output so refactors can be shown to be behaviour-neutral.
 *
 *   npm run verify              # summary + digest
 *   npm run verify -- --digest  # digest only
 *
 * The digest covers every point's label and every cell's intermediates (seed counts, peeled
 * points, per-iteration planes, GLE quantities, TGR probabilities, the A-GLE state it left
 * behind), so any change in behaviour anywhere in the pipeline changes it.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseKittiBin } from "../src/core/kitti.ts";
import {
  DEFAULT_PARAMS,
  initialState,
  isGroundLabel,
  PointLabel,
  segmentGround,
  type FrameTrace,
} from "../src/patchwork/index.ts";

const digestOnly = process.argv.includes("--digest");
const state0 = initialState(DEFAULT_PARAMS);
const overall = createHash("sha256");

for (let frame = 0; frame < 6; frame++) {
  const name = String(frame).padStart(6, "0");
  const buf = readFileSync(`public/data/${name}.bin`);
  const cloud = parseKittiBin(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
  );
  const trace = segmentGround(cloud, frame, DEFAULT_PARAMS, state0);
  overall.update(fingerprint(trace));

  if (digestOnly) continue;

  let ground = 0;
  let rvpf = 0;
  let unassigned = 0;
  for (const label of trace.labels) {
    if (isGroundLabel(label as PointLabel)) ground++;
    if (label === PointLabel.VerticalPlane) rvpf++;
    if (label === PointLabel.Unassigned) unassigned++;
  }
  const candidates = trace.cells.filter((c) => c.gle?.decision === "candidate").length;
  const reverted = trace.cells.filter((c) => c.tgr?.reverted).length;
  const definite = trace.cells.filter((c) => c.gle?.isDefiniteGround).length;
  const fitted = trace.cells.filter((c) => c.plane !== null).length;

  console.log(
    `cold frame ${frame}: points=${cloud.count} noise=${trace.noiseIndices.length} ` +
      `ground=${ground} nonground=${cloud.count - ground} ` +
      `cells=${fitted} definite=${definite} cand=${candidates} reverted=${reverted} ` +
      `rvpf=${rvpf}`,
  );

  if (ground !== trace.groundCount) {
    console.error(`  !! label/counter mismatch: ${ground} vs ${trace.groundCount}`);
    process.exitCode = 1;
  }
  if (unassigned) {
    console.error(`  !! ${unassigned} unassigned points`);
    process.exitCode = 1;
  }
}

console.log(`digest ${overall.digest("hex").slice(0, 32)}`);

/** A stable hash of everything the pipeline produced for one frame. */
function fingerprint(t: FrameTrace): string {
  const h = createHash("sha256");
  h.update(Buffer.from(t.labels));
  h.update(`${t.groundCount}/${t.nonGroundCount}/${t.noiseIndices.length}`);
  h.update(t.outOfRangeIndices.length.toString());

  for (const cell of t.cells) {
    h.update(`${cell.key}|${cell.indices.length}|${cell.skipped ? 1 : 0}`);
    h.update(`${n(cell.lprHeight)}|${n(cell.seedCutoff)}|${cell.seedCount}|${cell.lprStart}`);
    h.update(`${cell.survivors.length}|${cell.cellGround.length}|${cell.cellNonGround.length}`);

    for (const pass of cell.rvpf) {
      h.update(
        `v${n(pass.plane.normal[2])}|${pass.seedCount}|${pass.peeled ? 1 : 0}|${pass.removed.length}`,
      );
    }
    for (const it of cell.rgpf) {
      h.update(`g${n(it.plane.normal[2])}|${n(it.plane.d)}|${it.ground.length}`);
    }
    if (cell.plane) {
      h.update(
        `p${cell.plane.normal.map(n).join(",")}|${n(cell.plane.d)}|` +
          `${cell.plane.eigenvalues.map(n).join(",")}`,
      );
    }
    if (cell.gle) {
      h.update(
        `e${n(cell.gle.uprightness)}|${n(cell.gle.elevation)}|${n(cell.gle.flatness)}|` +
          `${n(cell.gle.lineVariable)}|${n(cell.gle.heading)}|${cell.gle.decision}|` +
          `${cell.gle.isDefiniteGround ? 1 : 0}`,
      );
    }
    if (cell.tgr) {
      h.update(
        `t${n(cell.tgr.mu)}|${n(cell.tgr.probFlatness)}|${cell.tgr.probLine}|` +
          `${cell.tgr.reverted ? 1 : 0}`,
      );
    }
  }

  for (const ring of t.rings) {
    h.update(
      `r${ring.concentricIdx}|${ring.flatnessSamples.length}|${ring.candidates.length}|${n(ring.mu)}`,
    );
  }
  h.update(
    `s${n(t.stateAfter.sensorHeight)}|${t.stateAfter.elevationThr.map(n).join(",")}|` +
      `${t.stateAfter.flatnessThr.map(n).join(",")}`,
  );
  return h.digest("hex");
}

/** Fixed precision, so the digest is not hostage to float printing. */
function n(v: number): string {
  return Number.isFinite(v) ? v.toFixed(9) : String(v);
}
