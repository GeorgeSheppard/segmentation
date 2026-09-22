import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { lerpPlane, type Vec3 } from "../core/linalg.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fmt, thickness } from "./helpers.ts";

/** The cell the seed / R-GPF stages work in: a big, clean, half-road half-car patch. */
const FIT_CELL = "0/0/13";
/** A cell where the ground sits on top of a vertical structure. */
const VERTICAL_CELL = "0/1/12";

/** Step 5 — sorting a cell by height and picking the seed points. */
export const stageSeeds: Stage = {
  id: "seeds",
  steps: ["seeds"],
  title: "Seeds — the lowest points win",
  subtitle:
    "Sort the cell by height, average the 20 lowest, and seed from everything within 12.5 cm.",

  build(ctx: StageContext) {
    const { cloud, params } = ctx;
    const bin = ctx.bin(FIT_CELL);
    const idx = bin.indices;

    cloud.setBaseRaw(ctx.color.raw);
    cloud.setAlphaAll(ctx.dim);
    cloud.setAlpha(idx, 1);
    cloud.setSize(idx, 2.1);
    cloud.captureBase();

    ctx.legend([
      {
        color: ctx.color.focus,
        label: "floor",
        note: `average of the ${params.numLPR} lowest points`,
      },
      { color: ctx.color.seed, label: "seeds", note: "within 12.5 cm of the floor" },
      { color: "#64748b", label: "the rest of the cell" },
    ]);

    const prism = ctx.outline(bin, -2.1, 1.0, ctx.color.plane);
    prism.opacity = 0;

    const sweepPlane = ctx.wedge(bin, ctx.color.plane, 0);
    const lprPlane = ctx.wedge(bin, ctx.color.focus, 0);
    lprPlane.layFlat(bin.lprHeight);
    const cutPlane = ctx.wedge(bin, ctx.color.seed, 0);
    cutPlane.layFlat(bin.seedCutoff);

    const lpr = idx.subarray(bin.lprStart, bin.lprStart + params.numLPR);
    const seeds = idx.subarray(0, bin.seedCount);

    const t = ctx.track();

    t.say(
      `One cell, <em>${idx.length.toLocaleString()} points</em>. Mostly road, but something is standing on part of it — and height alone can't say where one ends and the other begins.`,
      3,
    )
      .with(2.1, ctx.rig.flyTo(ctx.binPose(bin, { distance: 8.5, height: 4.2 })), Ease.cinematic)
      .with(1.2, { onUpdate: (v) => (prism.opacity = v * 0.8) });

    t.say("One assumption: <em>the lowest points in a cell are probably ground</em>.", 2.6);

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
        cloud.paint(idx.subarray(0, k), ctx.color.plane, 0.85);
      },
      onExit: () => {
        sweepPlane.opacity = 0;
        cloud.restore();
      },
    });
    t.at(t.time - 3.0).say(
      "Sort the cell by height. Sorting inside each cell, rather than the whole cloud at once, is most of why Patchwork++ is quick.",
      3.8,
    );

    t.add(1.2, {
      onUpdate: (v) => {
        cloud.paint(lpr, ctx.color.focus, v);
        cloud.sizeTo(lpr, 4.5, v);
        lprPlane.opacity = v * 0.3;
      },
    });
    t.say(
      `Average the <em>${params.numLPR} lowest</em> heights. Call that the cell's floor: ${fmt(bin.lprHeight)} m.`,
      3.2,
    );

    t.add(1.2, {
      onUpdate: (v) => {
        cutPlane.opacity = v * 0.24;
        cloud.paint(seeds, ctx.color.seed, v);
      },
    });
    t.say(
      `Points within <em>12.5 cm</em> of the floor are <em>seeds</em>: ${bin.seedCount.toLocaleString()} of ${idx.length.toLocaleString()}.`,
      3,
    );

    t.say(
      "No randomness involved — the same cell always produces the same seeds, which is what makes 500 fits per scan affordable.",
      3.6,
    );

    t.wait(0.9);
    t.say(
      "It is also the weak point: one phantom point drags the average down, which is why RNR ran first.",
      3.4,
    );

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        prism.opacity = 0.8 * (1 - v);
        lprPlane.opacity = 0.3 * (1 - v);
        cutPlane.opacity = 0.24 * (1 - v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

/** Step 6 — R-GPF: three refinements turn the seed set into a ground plane. */
export const stageRgpf: Stage = {
  id: "rgpf",
  steps: ["rgpf"],
  title: "R-GPF — fit, re-select, repeat",
  subtitle:
    "Fit a flat surface through the seeds. Points within 12.5 cm of it become the next seed set. Three times.",

  build(ctx: StageContext) {
    const { cloud, params } = ctx;
    const bin = ctx.bin(FIT_CELL);
    const idx = bin.indices;

    cloud.setBaseRaw(ctx.color.raw);
    cloud.setAlphaAll(ctx.dim);
    cloud.setAlpha(idx, 1);
    cloud.setSize(idx, 2.1);
    cloud.paint(idx, "#64748b", 0.75);
    cloud.captureBase();

    ctx.legend([
      { color: ctx.color.plane, label: "fitted plane" },
      { color: ctx.color.ground, label: "within 12.5 cm", note: "kept as ground" },
      { color: ctx.color.nonGround, label: "above the plane", note: "not ground" },
      { color: ctx.color.normal, label: "facing direction", note: "the way the patch tilts" },
    ]);

    const prism = ctx.outline(bin, -2.1, 1.0, ctx.color.plane);
    prism.opacity = 0.55;

    const planeSurf = ctx.wedge(bin, ctx.color.plane, 0);
    const slabSurf = ctx.wedge(bin, ctx.color.ground, 0);
    const normalLine = ctx.segment(ctx.color.normal, 0);

    const showPlane = (p: { normal: Vec3; d: number; mean: Vec3 }) => {
      planeSurf.layOnPlane(p.normal, p.d);
      slabSurf.layOnPlane(p.normal, p.d - params.thDist);
      const base = new Vector3(p.mean[0], p.mean[1], p.mean[2]);
      const tip = base
        .clone()
        .add(new Vector3(p.normal[0], p.normal[1], p.normal[2]).multiplyScalar(1.8));
      normalLine.set(base, tip);
    };
    /** Each pass tweens from the fit before it, so the plane is seen to settle. */
    const planeAt = (it: number) => (it < 0 ? bin.rgpf[0].plane : bin.rgpf[it].plane);
    showPlane(planeAt(0));

    const seeds = idx.subarray(0, bin.seedCount);

    const t = ctx.track();

    t.say(
      "Now lay a plane through the seeds, angled so the seeds sit as close to it as possible.",
      3.2,
    )
      .with(2.0, ctx.rig.flyTo(ctx.binPose(bin, { distance: 8, height: 4 })), Ease.cinematic)
      .with(1.0, { onUpdate: (v) => cloud.paint(seeds, ctx.color.seed, v) });

    t.add(1.2, {
      onUpdate: (v) => {
        planeSurf.opacity = v * 0.32;
        normalLine.opacity = v;
      },
    });
    t.say(
      `That gives two things: which way the surface faces, and how thick the patch is — ` +
        `<em>${thickness(bin.rgpf[0].plane.eigenvalues[2])}</em> on this first pass.`,
      3.2,
    );

    // Three refinement passes.
    for (let it = 0; it < params.numIter; it++) {
      const pass = bin.rgpf[it];
      const accepted = pass.ground;
      const plane = pass.plane;

      const from = planeAt(it - 1);
      t.add(
        0.9,
        {
          onUpdate: (v) => {
            showPlane(lerpPlane(from, plane, v));
            planeSurf.opacity = 0.32;
            slabSurf.opacity = v * 0.14;
          },
        },
        Ease.inOut,
      );

      t.add(1.1, {
        onUpdate: (v) => {
          cloud.restore();
          cloud.paint(accepted, ctx.color.ground, v);
        },
      });

      if (it === 0) {
        t.at(t.time - 2.0).say(
          "Now measure every point against that plane. Within <em>12.5 cm</em> of it, or below it, counts as ground.",
          3.4,
        );
        t.say(
          "One-sided on purpose. Dips below the plane are still road; only points sticking <em>up</em> are rejected.",
          3,
        );
      } else {
        t.say(
          `Refit on the ${accepted.length.toLocaleString()} that passed, then measure again. The plane settles.`,
          2.6,
        );
      }
      t.wait(0.3);
    }

    const finalGround = bin.cellGround;
    const finalNon = bin.cellNonGround;
    t.add(1.2, {
      onUpdate: (v) => {
        cloud.restore();
        cloud.paint(finalGround, ctx.color.ground, 1);
        cloud.paint(finalNon, ctx.color.nonGround, v);
        slabSurf.opacity = 0.14 * (1 - v);
      },
    });
    t.say(
      `Three passes, and the cell splits: <em>${finalGround.length.toLocaleString()} ground</em>, <em>${finalNon.length.toLocaleString()} not</em>.`,
      3,
    );

    t.say(
      "This runs in all 504 cells. But R-GPF <em>always</em> returns a plane, even for a cell holding only a wall.",
      3.6,
    );

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        planeSurf.opacity = 0.32 * (1 - v);
        normalLine.opacity = 1 - v;
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
  steps: ["rvpf"],
  title: "R-VPF — peeling off vertical structure",
  subtitle:
    "When ground sits on a kerb or a wall, the wall's points are lower, so they win the seeding.",

  build(ctx: StageContext) {
    const { cloud } = ctx;
    const bin = ctx.bin(VERTICAL_CELL);
    const idx = bin.indices;

    cloud.setBaseRaw(ctx.color.raw);
    cloud.setAlphaAll(ctx.dim);
    cloud.setAlpha(idx, 1);
    cloud.setSize(idx, 2.6);
    cloud.paint(idx, "#64748b", 0.7);
    cloud.captureBase();

    ctx.legend([
      { color: ctx.color.focus, label: "vertical points", note: "peeled off by R-VPF" },
      { color: ctx.color.plane, label: "the fit", note: "before peeling: tilted" },
      { color: ctx.color.ground, label: "ground recovered" },
    ]);

    const prism = ctx.outline(bin, -2.0, 1.1, ctx.color.plane);
    prism.opacity = 0.55;

    const planeSurf = ctx.wedge(bin, ctx.color.plane, 0);
    const normalLine = ctx.segment(ctx.color.normal, 0);

    const showPlane = (normal: readonly number[], d: number, mean: readonly number[]) => {
      planeSurf.layOnPlane(normal as [number, number, number], d, [-2.0, 1.1]);
      const base = new Vector3(mean[0], mean[1], mean[2]);
      const tip = base
        .clone()
        .add(new Vector3(normal[0], normal[1], normal[2]).multiplyScalar(1.6));
      normalLine.set(base, tip);
    };

    const t = ctx.track();

    t.say(
      `A different cell, ${bin.radii[0].toFixed(1)}\u2013${bin.radii[1].toFixed(1)} m out. A low structure, with ground <em>on top of</em> it.`,
      3,
    ).with(
      2.1,
      ctx.rig.flyTo(ctx.binPose(bin, { distance: 8, height: 3.8, swing: 0.7 })),
      Ease.cinematic,
    );

    t.say(
      "That is still ground; a person can stand on it. But it sits <em>higher</em> than the wall, so seeding picks the wall.",
      3.4,
    );

    // Show the damage first: the plane you get without peeling.
    const first = bin.rvpf[0].plane;
    t.add(1.2, {
      onEnter: () => {
        showPlane(first.normal, first.d, first.mean);
      },
      onUpdate: (v) => {
        planeSurf.opacity = v * 0.3;
        normalLine.opacity = v;
      },
    });
    t.say(
      "Fit it as-is and the plane comes out standing on edge. It fits whatever it is given.",
      3.2,
    );

    t.say("R-VPF fits the <em>wall</em> first, on purpose, and deletes it.", 2.6);

    // Peel, iteration by iteration.
    let removedSoFar: number[] = [];
    bin.rvpf.forEach((pass, i) => {
      const from = bin.rvpf[i - 1]?.plane ?? pass.plane;
      t.add(
        1.0,
        {
          onUpdate: (v) => {
            const p = lerpPlane(from, pass.plane, v);
            showPlane(p.normal, p.d, p.mean);
            planeSurf.opacity = 0.3;
            normalLine.opacity = 1;
          },
        },
        Ease.inOut,
      );

      if (pass.peeled) {
        const snapshot = [...removedSoFar];
        const batch = pass.removed;
        t.add(1.2, {
          onUpdate: (v) => {
            cloud.restore();
            cloud.paint(Int32Array.from(snapshot), ctx.color.focus, 1);
            cloud.fadeTo(Int32Array.from(snapshot), Math.max(ctx.dim, 0.12), 1);
            cloud.paint(batch, ctx.color.focus, v);
            cloud.sizeTo(batch, 3.2, v);
          },
          onExit: () => {
            cloud.fadeTo(batch, Math.max(ctx.dim, 0.12), 1);
          },
        });
        removedSoFar = removedSoFar.concat(Array.from(batch));
        t.say(
          `Pass ${i + 1}: the plane is vertical, so the <em>${batch.length.toLocaleString()} points</em> lying in it are removed.`,
          2.8,
        );
      } else {
        t.say(
          `Pass ${i + 1}: the plane has <em>stood up</em>. The wall is gone, so R-VPF stops.`,
          2.8,
        );
      }
    });

    // The recovered ground.
    t.add(1.4, {
      onUpdate: (v) => {
        const plane = bin.plane!;
        showPlane(plane.normal, plane.d, plane.mean);
        cloud.paint(bin.cellGround, ctx.color.ground, v);
        cloud.fadeTo(bin.cellGround, 1, v);
        cloud.sizeTo(bin.cellGround, 2.6, v);
      },
    });
    t.say(
      `R-GPF now runs on the survivors and recovers <em>${bin.cellGround.length} points</em> Patchwork would have discarded.`,
      3.2,
    );

    t.say("It also makes the cell genuinely flat, which matters for the next test.", 2.8);

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        planeSurf.opacity = 0.3 * (1 - v);
        normalLine.opacity = 1 - v;
        prism.opacity = 0.55 * (1 - v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};
