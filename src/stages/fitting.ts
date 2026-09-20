import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { COLORS } from "../viz/palette.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fmt } from "./helpers.ts";

/** The cell the seed / R-GPF stages work in: a big, clean, half-road half-car patch. */
const FIT_CELL = "0/0/12";
/** A cell where the ground sits on top of a vertical structure. */
const VERTICAL_CELL = "0/1/14";

/** Step 5 — sorting a cell by height and picking the seed points. */
export const stageSeeds: Stage = {
  id: "seeds",
  title: "Seeds — the lowest points win",
  subtitle:
    "Inside a cell, sort by height, average the 20 lowest, and take everything within 12.5 cm of that as the seed set.",

  build(ctx: StageContext) {
    const { cloud, frame, params } = ctx;
    const bin = ctx.bin(FIT_CELL);
    const idx = bin.indices;

    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2);
    cloud.setAlphaAll(0.05);
    cloud.setAlpha(idx, 1);
    cloud.setSize(idx, 1.5);
    cloud.captureBase();

    ctx.legend([
      { color: COLORS.lpr, label: "LPR", note: `${params.numLPR} lowest points` },
      { color: COLORS.seed, label: "seeds", note: "z < LPR + 0.125 m" },
      { color: "#64748b", label: "the rest of the cell" },
    ]);

    const prism = ctx.outline(bin, -2.1, 1.0, COLORS.accent);
    prism.opacity = 0;

    const sweepPlane = ctx.wedge(bin, COLORS.accent, 0);
    const lprPlane = ctx.wedge(bin, COLORS.lpr, 0);
    lprPlane.layFlat(bin.lprHeight);
    const cutPlane = ctx.wedge(bin, COLORS.seed, 0);
    cutPlane.layFlat(bin.seedCutoff);

    const centre = ctx.centreOf(bin, 0);
    const lprLabel = ctx.label(
      `LPR   z = ${fmt(bin.lprHeight)} m`,
      new Vector3(centre.x, centre.y, bin.lprHeight - 0.45),
      "bad",
    );
    const cutLabel = ctx.label(
      `LPR + 0.125 = ${fmt(bin.seedCutoff)} m`,
      new Vector3(centre.x, centre.y, bin.seedCutoff + 0.55),
      "warn",
    );
    lprLabel.opacity = 0;
    cutLabel.opacity = 0;

    const lpr = idx.subarray(bin.lprStart, bin.lprStart + params.numLPR);
    const seeds = idx.subarray(0, bin.seedCount);

    const t = ctx.track();

    t.say(
      `One cell, <em>${idx.length.toLocaleString()} points</em>. Part road, part parked car. Patchwork++ has to find the road part without being told which is which.`,
      3.4,
    )
      .with(2.6, ctx.rig.flyTo(ctx.binPose(bin, { distance: 8.5, height: 4.2 })), Ease.cinematic)
      .with(1.2, { onUpdate: (v) => (prism.opacity = v * 0.8) });

    t.say(
      "The only assumption it makes: <em>the lowest points in a cell are probably ground</em>. Everything else follows from that.",
      3.8,
    );

    // Sweep a plane up through the cell — this *is* the sort by z.
    const zLo = ctx.xyz[idx[0] * 3 + 2] - 0.05;
    const zHi = ctx.xyz[idx[idx.length - 1] * 3 + 2] + 0.05;
    t.add(3.0, {
      onUpdate: (v) => {
        const z = zLo + (zHi - zLo) * v;
        sweepPlane.layFlat(z);
        sweepPlane.opacity = 0.2 * Math.sin(Math.PI * Math.min(1, v * 1.2));
        // Points are stored sorted by z, so "below the sweep" is a prefix.
        const k = Math.max(1, Math.round(idx.length * v));
        cloud.restore();
        cloud.paint(idx.subarray(0, k), COLORS.accent, 0.85);
      },
      onExit: () => {
        sweepPlane.opacity = 0;
        cloud.restore();
      },
    });
    t.at(t.time - 3.0).say(
      "So: sort the cell by height. <em>O(M log M)</em> inside one cell, not over the whole cloud — that single change is why Patchwork++ is faster than Patchwork.",
      3.0,
    );

    t.add(1.2, {
      onUpdate: (v) => {
        cloud.paint(lpr, COLORS.lpr, v);
        cloud.sizeTo(lpr, 4.5, v);
        lprPlane.opacity = v * 0.3;
        lprLabel.opacity = v;
      },
    });
    t.say(
      `Take the <em>${params.numLPR} lowest</em> and average their height. That is the <em>Lowest Point Representative</em>: ${fmt(
        bin.lprHeight,
      )} m — a robust stand-in for "where the road is here".`,
      4.6,
    );

    t.add(1.2, {
      onUpdate: (v) => {
        cutPlane.opacity = v * 0.24;
        cutLabel.opacity = v;
        cloud.paint(seeds, COLORS.seed, v);
      },
    });
    t.say(
      `Everything within <code>th_seeds = 0.125 m</code> above the LPR becomes a <em>seed</em>: ${bin.seedCount.toLocaleString()} of the cell's ${idx.length.toLocaleString()} points.`,
      4.4,
    );

    t.say(
      "No random sampling, no RANSAC iterations — the seed set is <em>deterministic</em>. That is the trick that makes this fast enough to run 500 times per scan.",
      4.6,
    );

    t.add(0.9, {
      onEnter: () =>
        ctx.readout("Seed selection", [
          { label: "points", value: idx.length.toLocaleString() },
          { label: "LPR z", value: `${fmt(bin.lprHeight)} m` },
          { label: "cutoff", value: `${fmt(bin.seedCutoff)} m` },
          { label: "seeds", value: bin.seedCount.toLocaleString(), state: "pass" },
        ]),
    });
    t.say(
      "And it is the weak point too: one phantom point below the road would drag the LPR down with it. Which is exactly why RNR ran first.",
      4.4,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        prism.opacity = 0.8 * (1 - v);
        lprPlane.opacity = 0.3 * (1 - v);
        cutPlane.opacity = 0.24 * (1 - v);
        lprLabel.opacity = 1 - v;
        cutLabel.opacity = 1 - v;
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

/** Step 6 — R-GPF: three PCA refinements turn the seed set into a ground plane. */
export const stageRgpf: Stage = {
  id: "rgpf",
  title: "R-GPF — fit, re-select, repeat",
  subtitle:
    "PCA on the seeds gives a plane. Everything within 12.5 cm of it becomes the new seed set. Three times.",

  build(ctx: StageContext) {
    const { cloud, frame, params } = ctx;
    const bin = ctx.bin(FIT_CELL);
    const idx = bin.indices;

    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2);
    cloud.setAlphaAll(0.05);
    cloud.setAlpha(idx, 1);
    cloud.setSize(idx, 1.5);
    cloud.paint(idx, "#64748b", 0.75);
    cloud.captureBase();

    ctx.legend([
      { color: COLORS.plane, label: "fitted plane" },
      { color: COLORS.ground, label: "within 12.5 cm", note: "kept as ground" },
      { color: COLORS.nonGround, label: "above the plane", note: "not ground" },
      { color: COLORS.normal, label: "surface normal", note: "smallest-eigenvalue direction" },
    ]);

    const prism = ctx.outline(bin, -2.1, 1.0, COLORS.accent);
    prism.opacity = 0.55;

    const planeSurf = ctx.wedge(bin, COLORS.plane, 0);
    const slabSurf = ctx.wedge(bin, COLORS.ground, 0);
    const normalLine = ctx.segment(COLORS.normal, 0);
    const normalLabel = ctx.label("", new Vector3(), "accent");
    normalLabel.opacity = 0;

    const showPlane = (it: number) => {
      const p = bin.rgpf[it].plane;
      planeSurf.layOnPlane(p.normal, p.d);
      slabSurf.layOnPlane(p.normal, p.d - params.thDist);
      const base = new Vector3(p.mean[0], p.mean[1], p.mean[2]);
      const tip = base.clone().add(new Vector3(p.normal[0], p.normal[1], p.normal[2]).multiplyScalar(1.8));
      normalLine.set(base, tip);
      normalLabel.setPosition(tip.clone().add(new Vector3(0, 0, 0.35)));
      normalLabel.text = `n<sub>z</sub> = ${p.normal[2].toFixed(4)}`;
    };
    showPlane(0);

    const seeds = idx.subarray(0, bin.seedCount);

    const t = ctx.track();

    t.say(
      "Start from the seeds. Take their covariance, and eigen-decompose it — a <em>PCA</em>, not a RANSAC.",
      3.2,
    )
      .with(2.4, ctx.rig.flyTo(ctx.binPose(bin, { distance: 8, height: 4 })), Ease.cinematic)
      .with(1.0, { onUpdate: (v) => cloud.paint(seeds, COLORS.seed, v) });

    t.add(1.2, {
      onUpdate: (v) => {
        planeSurf.opacity = v * 0.32;
        normalLine.opacity = v;
        normalLabel.opacity = v;
      },
      onEnter: () =>
        ctx.readout("Iteration 1", [
          { label: "seeds", value: bin.seedCount.toLocaleString() },
          { label: "normal z", value: bin.rgpf[0].plane.normal[2].toFixed(4) },
          { label: "λ₃ (thickness)", value: bin.rgpf[0].plane.eigenvalues[2].toExponential(2) },
        ]),
    });
    t.say(
      "The eigenvector of the <em>smallest</em> eigenvalue points across the thinnest direction of the point set — which, for a patch of road, is straight up. That is the surface normal.",
      5.2,
    );

    // Three refinement passes.
    for (let it = 0; it < params.numIter; it++) {
      const pass = bin.rgpf[it];
      const accepted = pass.ground;
      const plane = pass.plane;

      t.add(0.9, {
        onEnter: () => showPlane(it),
        onUpdate: (v) => {
          planeSurf.opacity = 0.32;
          slabSurf.opacity = v * 0.14;
        },
      });

      t.add(1.1, {
        onEnter: () =>
          ctx.readout(`Iteration ${it + 1}`, [
            { label: "normal z", value: plane.normal[2].toFixed(4) },
            { label: "mean z", value: `${fmt(plane.mean[2])} m` },
            { label: "λ₃", value: plane.eigenvalues[2].toExponential(2) },
            { label: "kept", value: accepted.length.toLocaleString(), state: "pass" },
          ]),
        onUpdate: (v) => {
          cloud.restore();
          cloud.paint(accepted, COLORS.ground, v);
        },
      });

      if (it === 0) {
        t.at(t.time - 2.0).say(
          "Now measure every point in the cell against that plane. Within <code>th_dist = 0.125 m</code> — <em>or below it</em> — and it counts as ground.",
          2.0,
        );
        t.say(
          "The test is one-sided on purpose: dips and road texture below the plane are still road. Only points sticking <em>up</em> are rejected.",
          2.6,
        );
      } else {
        t.say(
          `Refit on the ${accepted.length.toLocaleString()} points that passed, and measure again. The plane settles onto the road.`,
          2.4,
        );
      }
      t.wait(0.3);
    }

    const finalGround = bin.binGround;
    const finalNon = bin.binNonGround;
    t.add(1.2, {
      onEnter: () =>
        ctx.readout("Cell result", [
          { label: "ground", value: finalGround.length.toLocaleString(), state: "pass" },
          { label: "not ground", value: finalNon.length.toLocaleString(), state: "fail" },
          { label: "normal z", value: bin.plane!.normal[2].toFixed(4) },
          { label: "λ₃", value: bin.plane!.eigenvalues[2].toExponential(2) },
        ]),
      onUpdate: (v) => {
        cloud.restore();
        cloud.paint(finalGround, COLORS.ground, 1);
        cloud.paint(finalNon, COLORS.nonGround, v);
        slabSurf.opacity = 0.14 * (1 - v);
      },
    });
    t.say(
      `After three passes the cell is split: <em>${finalGround.length.toLocaleString()} ground</em>, <em>${finalNon.length.toLocaleString()} not</em>. The car is cleanly separated from the tarmac it is parked on.`,
      4.6,
    );

    t.say(
      "This runs for every one of the 504 cells. But there is a catch — R-GPF <em>always</em> returns a plane, even in a cell that contains nothing but a wall.",
      4.8,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        planeSurf.opacity = 0.32 * (1 - v);
        normalLine.opacity = 1 - v;
        normalLabel.opacity = 1 - v;
        prism.opacity = 0.55 * (1 - v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

/** Step 7 — R-VPF: peel the wall away before fitting the ground on top of it. */
export const stageRvpf: Stage = {
  id: "rvpf",
  title: "R-VPF — peeling off vertical structure",
  subtitle:
    "When ground sits on a kerb, a fence or a retaining wall, the wall's points are lower — so they win the seeding and tip the plane.",

  build(ctx: StageContext) {
    const { cloud, frame, params } = ctx;
    const bin = ctx.bin(VERTICAL_CELL);
    const idx = bin.indices;

    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2);
    cloud.setAlphaAll(0.05);
    cloud.setAlpha(idx, 1);
    cloud.setSize(idx, 2.0);
    cloud.paint(idx, "#64748b", 0.7);
    cloud.captureBase();

    ctx.legend([
      { color: COLORS.vertical, label: "vertical points", note: "peeled off by R-VPF" },
      { color: COLORS.plane, label: "the fit", note: "before peeling: tilted" },
      { color: COLORS.ground, label: "ground recovered" },
    ]);

    const prism = ctx.outline(bin, -2.0, 1.1, COLORS.accent);
    prism.opacity = 0.55;

    const planeSurf = ctx.wedge(bin, COLORS.plane, 0);
    const normalLine = ctx.segment(COLORS.normal, 0);
    const normalLabel = ctx.label("", new Vector3(), "warn");
    normalLabel.opacity = 0;

    const showPlane = (normal: readonly number[], d: number, mean: readonly number[]) => {
      planeSurf.layOnPlane(normal as [number, number, number], d, [-2.0, 1.1]);
      const base = new Vector3(mean[0], mean[1], mean[2]);
      const tip = base
        .clone()
        .add(new Vector3(normal[0], normal[1], normal[2]).multiplyScalar(1.6));
      normalLine.set(base, tip);
      normalLabel.setPosition(tip.clone().add(new Vector3(0, 0, 0.3)));
      normalLabel.text = `n<sub>z</sub> = ${normal[2].toFixed(3)}`;
    };

    const t = ctx.track();

    t.say(
      `A different cell, ${bin.radii[0].toFixed(1)}–${bin.radii[1].toFixed(
        1,
      )} m out. There is a low structure in it, and there is ground <em>on top of</em> that structure.`,
      3.4,
    ).with(
      2.6,
      ctx.rig.flyTo(ctx.binPose(bin, { distance: 8, height: 3.8, swing: 0.7 })),
      Ease.cinematic,
    );

    t.say(
      "The ground up there is still ground — a person can stand on it. But its points are <em>higher</em> than the wall's, so the seeding picks the wall instead.",
      4.6,
    );

    // Show the damage first: the plane you get without peeling.
    const first = bin.rvpf[0].plane;
    t.add(1.2, {
      onEnter: () => {
        showPlane(first.normal, first.d, first.mean);
        ctx.readout("Fit including the wall", [
          { label: "normal z", value: first.normal[2].toFixed(3), state: "fail" },
          { label: "upright?", value: `needs > ${params.uprightnessThr}`, state: "fail" },
        ]);
      },
      onUpdate: (v) => {
        planeSurf.opacity = v * 0.3;
        normalLine.opacity = v;
        normalLabel.opacity = v;
      },
    });
    t.say(
      `Fit it as-is and you get this: a plane standing almost on edge, <em>n<sub>z</sub> = ${first.normal[2].toFixed(
        3,
      )}</em>. PCA has no defence against that — it just fits what it is given.`,
      4.8,
    );

    t.say(
      "So R-VPF does the opposite of what you would expect. Before fitting the ground, it deliberately fits the <em>wall</em> — and throws it away.",
      4.6,
    );

    // Peel, iteration by iteration.
    let removedSoFar: number[] = [];
    bin.rvpf.forEach((pass, i) => {
      t.add(1.0, {
        onEnter: () => {
          showPlane(pass.plane.normal, pass.plane.d, pass.plane.mean);
          ctx.readout(`R-VPF pass ${i + 1}`, [
            { label: "normal z", value: pass.plane.normal[2].toFixed(3), state: pass.peeled ? "fail" : "pass" },
            {
              label: pass.peeled ? "peeled" : "verdict",
              value: pass.peeled ? pass.removed.length.toLocaleString() : "upright — stop",
              state: pass.peeled ? undefined : "pass",
            },
          ]);
        },
        onUpdate: () => {
          planeSurf.opacity = 0.3;
          normalLine.opacity = 1;
        },
      });

      if (pass.peeled) {
        const snapshot = [...removedSoFar];
        const batch = pass.removed;
        t.add(1.2, {
          onUpdate: (v) => {
            cloud.restore();
            cloud.paint(Int32Array.from(snapshot), COLORS.vertical, 1);
            cloud.fadeTo(Int32Array.from(snapshot), 0.12, 1);
            cloud.paint(batch, COLORS.vertical, v);
            cloud.sizeTo(batch, 3.2, v);
          },
          onExit: () => {
            cloud.fadeTo(batch, 0.12, 1);
          },
        });
        removedSoFar = removedSoFar.concat(Array.from(batch));
        t.say(
          `Pass ${i + 1}: the plane is vertical, so every point lying in it — <em>${batch.length.toLocaleString()} of them</em> — is tagged as structure and removed.`,
          2.8,
        );
      } else {
        t.say(
          `Pass ${i + 1}: the plane has <em>stood up</em> (n<sub>z</sub> = ${pass.plane.normal[2].toFixed(
            3,
          )}). The wall is gone. R-VPF stops here — what is left is ground.`,
          4.0,
        );
      }
    });

    // The recovered ground.
    t.add(1.4, {
      onEnter: () =>
        ctx.readout("After R-VPF", [
          { label: "peeled", value: String(idx.length - bin.survivors.length) },
          { label: "ground", value: bin.binGround.length.toLocaleString(), state: "pass" },
          { label: "normal z", value: bin.plane!.normal[2].toFixed(3), state: "pass" },
        ]),
      onUpdate: (v) => {
        const plane = bin.plane!;
        showPlane(plane.normal, plane.d, plane.mean);
        cloud.paint(bin.binGround, COLORS.ground, v);
        cloud.fadeTo(bin.binGround, 1, v);
        cloud.sizeTo(bin.binGround, 2.6, v);
      },
    });
    t.say(
      `Now R-GPF runs on what survived, and the ground on top of the structure is recovered: <em>${bin.binGround.length} points</em> that Patchwork would have thrown away.`,
      4.8,
    );

    t.say(
      "There is a second prize. With the wall gone, what is left really is planar — so the cell's <em>thickness</em> collapses, and a thin cell is one the flatness test can accept.",
      5.0,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        planeSurf.opacity = 0.3 * (1 - v);
        normalLine.opacity = 1 - v;
        normalLabel.opacity = 1 - v;
        prism.opacity = 0.55 * (1 - v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};
