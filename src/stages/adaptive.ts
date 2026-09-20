import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { ringFromConcentric, ringRadii } from "../patchwork/czm.ts";
import { isGroundLabel, type PointLabel } from "../patchwork/types.ts";
import { COLORS } from "../viz/palette.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fitGlobalPlane, fmt } from "./helpers.ts";

/** Step 11 — A-GLE: the algorithm tunes its own thresholds from what it just saw. */
export const stageAgle: Stage = {
  id: "agle",
  title: "A-GLE — it tunes itself",
  subtitle:
    "The elevation and flatness thresholds are not set by a human. They are measured, every frame, from the cells the algorithm was most sure about.",

  build(ctx: StageContext) {
    const { cloud, frame, params, czm } = ctx;
    const before = frame.stateBefore;
    const after = frame.stateAfter;

    cloud.setBaseLabels(frame.labels);
    cloud.fadeAllTo(0.14, 1);
    cloud.captureBase();

    ctx.legend([
      { color: COLORS.ground, label: "definite ground", note: "upright, low, near — set Dₘ" },
      { color: COLORS.plane, label: "elevation threshold", note: "learned per ring" },
    ]);

    // The four rings of interest, and the definite-ground cells inside them.
    const roi = Array.from({ length: params.numRingsOfInterest }, (_, m) => {
      const { zone, ring } = ringFromConcentric(params, m);
      const [r0, r1] = ringRadii(czm, zone, ring);
      const disc = ctx.surface(r0, r1, 0, Math.PI * 2, COLORS.plane, 0, 72, 2);
      disc.layFlat(0);
      const cells = frame.bins.filter((b) => b.concentricIdx === m && b.gle?.isDefiniteGround);
      // Each ring's label gets its own bearing, or they stack on top of each other.
      const bearing = 1.15 - m * 0.42;
      const label = ctx.label(
        `ring ${m}`,
        new Vector3(
          ((r0 + r1) / 2) * Math.cos(bearing),
          ((r0 + r1) / 2) * Math.sin(bearing),
          0.5,
        ),
        "accent",
      );
      label.text = `ring ${m} · ${fmt(before.elevationThr[m])} m`;
      label.opacity = 0;
      return { m, r0, r1, disc, cells, label, bearing };
    });

    const definiteIdx: number[] = [];
    for (const r of roi) for (const c of r.cells) definiteIdx.push(...c.binGround);
    const definite = Int32Array.from(definiteIdx);

    const cellSurfaces = roi.flatMap((r) =>
      r.cells.map((b) => {
        const w = ctx.wedge(b, COLORS.ground, 0);
        w.layFlat(b.gle!.elevation);
        return w;
      }),
    );

    const thresholdRows = () =>
      roi.map((r) => ({
        label: `ring ${r.m}`,
        value: `${fmt(before.elevationThr[r.m])} → ${fmt(after.elevationThr[r.m])}`,
        state: "pass" as const,
      }));

    const t = ctx.track();

    t.say(
      "Two of those three tests needed a threshold. In Patchwork, a human picked them — and the right value is different on a motorway, in a suburb, and on a country lane.",
      3.2,
    ).with(2.8, ctx.rig.flyTo(pose([-26, -30, 26], [4, 0, -1.6])), Ease.cinematic);

    t.add(1.4, {
      onUpdate: (v) => {
        for (const r of roi) {
          r.disc.opacity = v * 0.14;
          r.label.opacity = v;
        }
      },
    });
    t.say(
      `A-GLE measures them instead. Only the inner <em>${params.numRingsOfInterest} rings</em> take part — out past ${czm
        .minRanges[1].toFixed(0)} m the tests are off anyway.`,
      4.6,
    );

    t.add(1.6, {
      onEnter: () =>
        ctx.readout("Definite ground Dₘ", [
          { label: "cells", value: String(roi.reduce((s, r) => s + r.cells.length, 0)) },
          { label: "points", value: definite.length.toLocaleString() },
          { label: "purity (paper)", value: "95.8%", state: "pass" },
        ]),
      onUpdate: (v) => {
        for (const c of cellSurfaces) c.opacity = v * 0.35;
        cloud.paint(definite, COLORS.ground, v);
        cloud.fadeTo(definite, 1, v);
      },
    });
    t.say(
      "These are the cells that passed <em>every</em> test with room to spare — the <em>definite ground</em>. Roughly 96% of them really are road.",
      4.8,
    );

    t.say(
      "So they make a good ruler. Take their heights, take their thicknesses, and set the next frame's thresholds to <em>mean + a few standard deviations</em>.",
      4.8,
    );

    // Drop the threshold discs from the cold-start zero down to the learned values.
    t.add(2.6, {
      onEnter: () => ctx.readout("Elevation threshold", thresholdRows()),
      onUpdate: (v) => {
        for (const r of roi) {
          const z =
            before.elevationThr[r.m] + (after.elevationThr[r.m] - before.elevationThr[r.m]) * v;
          r.disc.layFlat(z);
          r.disc.opacity = 0.14 + 0.1 * v;
          r.label.text = `ring ${r.m} · ${fmt(z)} m`;
          r.label.setPosition(
            new Vector3(
              ((r.r0 + r.r1) / 2) * Math.cos(r.bearing),
              ((r.r0 + r.r1) / 2) * Math.sin(r.bearing),
              z + 0.5,
            ),
          );
        }
      },
    }, Ease.inOut);
    t.at(t.time - 2.6).say(
      "Watch them fall. They started this scan at <em>zero</em> — the cold-start value — and land on the road.",
      2.8,
    );
    t.wait(1.2);

    t.add(1.4, {
      onEnter: () =>
        ctx.readout("Flatness threshold λ₃", [
          ...roi.map((r) => ({
            label: `ring ${r.m}`,
            value: after.flatnessThr[r.m].toExponential(1),
            state: "pass" as const,
          })),
        ]),
    });
    t.say(
      "The flatness thresholds are learned the same way — and they end up describing how rough <em>this</em> road actually is, not how rough roads are in general.",
      4.8,
    );

    // The sensor height correction, and its effect on RNR.
    t.add(1.4, {
      onEnter: () =>
        ctx.readout("Self-calibration", [
          { label: "assumed height", value: `${before.sensorHeight.toFixed(3)} m` },
          { label: "measured", value: `${after.sensorHeight.toFixed(3)} m`, state: "pass" },
          {
            label: "RNR floor",
            value: `${fmt(-after.sensorHeight - 0.8)} m`,
          },
        ]),
    });
    t.say(
      `There is a bonus: the innermost ring also measures the <em>sensor height</em>. It was told 1.723 m; it measured <em>${after.sensorHeight.toFixed(
        3,
      )} m</em> — and that number is what RNR's floor rides on.`,
      5.4,
    );

    t.say(
      "So the noise filter follows the car downhill instead of eating the road. Every part of the loop feeds the next frame.",
      4.4,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        for (const r of roi) {
          r.disc.opacity = 0.24 * (1 - v);
          r.label.opacity = 1 - v;
        }
        for (const c of cellSurfaces) c.opacity = 0.35 * (1 - v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

/** Step 12 — the result, against the strawman from step 2. */
export const stageResult: Stage = {
  id: "result",
  title: "The result",
  subtitle: "Ground and not-ground, from one CPU core, in a few milliseconds, with nothing learned in advance.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    const { ground: naiveGround } = fitGlobalPlane(frame.cloud, ctx.params);

    const groundIdx: number[] = [];
    const nonGroundIdx: number[] = [];
    for (let i = 0; i < frame.cloud.count; i++) {
      if (isGroundLabel(frame.labels[i] as PointLabel)) groundIdx.push(i);
      else nonGroundIdx.push(i);
    }
    const g = Int32Array.from(groundIdx);
    const n = Int32Array.from(nonGroundIdx);

    const naiveIsGround = new Uint8Array(frame.cloud.count);
    for (const i of naiveGround) naiveIsGround[i] = 1;
    const rescued = Int32Array.from(groundIdx.filter((i) => !naiveIsGround[i]));

    cloud.setBaseUniform("#475569", 0.9);

    ctx.legend([
      { color: COLORS.ground, label: "ground", note: `${g.length.toLocaleString()} points` },
      { color: COLORS.nonGround, label: "not ground", note: `${n.length.toLocaleString()} points` },
      { color: COLORS.groundReverted, label: "the single plane missed these" },
    ]);

    const t = ctx.track();

    t.say(
      `Every point placed: <em>${g.length.toLocaleString()} ground</em>, <em>${n.length.toLocaleString()} not</em>. The road is continuous, the cars are solid, the walls stand.`,
      3.4,
    )
      .with(2.4, ctx.rig.flyTo(pose([-46, -38, 20], [6, 0, -1.6])), Ease.cinematic)
      .with(1.6, {
        onEnter: () =>
          ctx.readout("Patchwork++", [
            { label: "ground", value: g.length.toLocaleString(), state: "pass" },
            { label: "not ground", value: n.length.toLocaleString() },
            { label: "cells fitted", value: String(frame.bins.filter((b) => b.plane).length) },
            { label: "this run", value: `${frame.elapsedMs.toFixed(0)} ms (JS)` },
          ]),
        onUpdate: (v) => {
          cloud.paint(g, COLORS.ground, v);
          cloud.paint(n, COLORS.nonGround, v);
        },
      });

    t.add(1.4, { onUpdate: (v) => { cloud.paint(g, COLORS.ground, 1); cloud.fadeTo(n, 0.1, v); } });
    t.say(
      "Ground alone: kerbs, the crown of the road, the pavement rising onto the verge — it followed all of it, because it never assumed any of it was flat.",
      5.0,
    );

    t.add(1.4, {
      onUpdate: (v) => {
        cloud.fadeTo(n, 0.1, 1);
        cloud.paint(rescued, COLORS.groundReverted, v);
        cloud.sizeTo(rescued, 2.2, v);
      },
      onEnter: () =>
        ctx.readout("vs a single plane", [
          { label: "recovered road", value: rescued.length.toLocaleString(), state: "pass" },
          { label: "F1 on SemanticKITTI", value: "96.51%" },
          { label: "reference speed", value: "55 Hz (C++)" },
        ]),
    });
    t.say(
      `In cyan: the <em>${rescued.length.toLocaleString()} points</em> of road that step 2's single plane threw away. That gap is the whole point of the paper.`,
      4.8,
    );

    t.add(4.5, ctx.rig.orbit(65), Ease.inOut);
    t.say(
      "<em>RNR</em> kills the reflections. <em>CZM</em> sizes the cells to the data. <em>R-VPF</em> peels the walls. <em>R-GPF</em> fits. <em>GLE</em> judges. <em>A-GLE</em> learns the thresholds. <em>TGR</em> gives the close calls a second hearing.",
      6.0,
    );

    t.add(3.0, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(2.0, {
      onUpdate: (v) => cloud.fadeTo(n, 0.9, v),
    });
    t.say(
      "Seven ideas, no training data, one CPU core. Drag to look around — or start again from the top.",
      4.0,
    );

    return t.build();
  },
};
