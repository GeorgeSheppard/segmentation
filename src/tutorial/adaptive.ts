import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import {
  isGroundLabel,
  PIPELINE_STEPS,
  type PointLabel,
  ringFromConcentric,
  ringRadii,
} from "../patchwork/index.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fitGlobalPlane, fmt } from "./helpers.ts";

/** Step 11 — A-GLE: the algorithm tunes its own thresholds from what it just saw. */
export const stageAgle: Stage = {
  id: "agle",
  steps: ["agle"],
  title: "A-GLE — it tunes itself",
  subtitle:
    "The thresholds are measured every frame, from the cells the algorithm was surest about.",

  build(ctx: StageContext) {
    const { cloud, frame, params, czm } = ctx;
    const before = frame.stateBefore;
    const after = frame.stateAfter;

    cloud.setBaseLabels(frame.labels, ctx.color);
    cloud.fadeAllTo(Math.max(ctx.dim, 0.14), 1);
    cloud.captureBase();

    ctx.legend([
      { color: ctx.color.ground, label: "definite ground", note: "upright, low, near — set Dₘ" },
      { color: ctx.color.plane, label: "elevation threshold", note: "learned per ring" },
    ]);

    // The four rings of interest, and the definite-ground cells inside them.
    const roi = Array.from({ length: params.numRingsOfInterest }, (_, m) => {
      const { zone, ring } = ringFromConcentric(params, m);
      const [r0, r1] = ringRadii(czm, zone, ring);
      const disc = ctx.surface(r0, r1, 0, Math.PI * 2, ctx.color.plane, 0, 72, 2);
      disc.layFlat(0);
      const cells = frame.cells.filter((b) => b.concentricIdx === m && b.gle?.isDefiniteGround);
      // Each ring's label gets its own bearing, or they stack on top of each other.
      const bearing = 1.15 - m * 0.42;
      const label = ctx.label(
        `ring ${m}`,
        new Vector3(((r0 + r1) / 2) * Math.cos(bearing), ((r0 + r1) / 2) * Math.sin(bearing), 0.5),
        "accent",
      );
      label.text = `ring ${m} · ${fmt(before.elevationThr[m])} m`;
      label.opacity = 0;
      return { m, r0, r1, disc, cells, label, bearing };
    });

    const definiteIdx: number[] = [];
    for (const r of roi) for (const c of r.cells) definiteIdx.push(...c.cellGround);
    const definite = Int32Array.from(definiteIdx);

    const cellSurfaces = roi.flatMap((r) =>
      r.cells.map((b) => {
        const w = ctx.wedge(b, ctx.color.ground, 0);
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
      "Two of those tests need a threshold. Patchwork had a human pick them, and the right value differs by scene.",
      3.2,
    ).with(2.3, ctx.rig.flyTo(pose([-26, -30, 26], [4, 0, -1.6])), Ease.cinematic);

    t.add(1.4, {
      onUpdate: (v) => {
        for (const r of roi) {
          r.disc.opacity = v * 0.14;
          r.label.opacity = v;
        }
      },
    });
    t.say(
      `A-GLE measures them instead, from the inner <em>${params.numRingsOfInterest} rings</em>. Past ${czm.minRanges[1].toFixed(0)} m the tests are off anyway.`,
      3.2,
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
        cloud.paint(definite, ctx.color.ground, v);
        cloud.fadeTo(definite, 1, v);
      },
    });
    t.say(
      "Cells that passed <em>every</em> test with room to spare: the <em>definite ground</em>. About 96% are road.",
      3.4,
    );

    t.say(
      "Good enough to measure against. Next frame’s thresholds are <em>mean + a few standard deviations</em> of these.",
      3.4,
    );

    // Drop the threshold discs from the cold-start zero down to the learned values.
    t.add(
      2.6,
      {
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
      },
      Ease.inOut,
    );
    t.at(t.time - 2.6).say(
      "Watch them fall. They started this scan at <em>zero</em> and land on the road.",
      2.6,
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
      "Flatness is learned the same way, describing how rough <em>this</em> road is rather than roads in general.",
      3.4,
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
      `The innermost ring also measures the <em>sensor height</em>. Told 1.723 m, measured <em>${after.sensorHeight.toFixed(3)} m</em>. RNR’s floor rides on it.`,
      3.8,
    );

    t.say("So the noise filter follows the car downhill instead of eating the road.", 2.8);

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
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
  subtitle: "Ground and not-ground, one CPU core, a few milliseconds, nothing learned in advance.",

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
      { color: ctx.color.ground, label: "ground", note: `${g.length.toLocaleString()} points` },
      {
        color: ctx.color.nonGround,
        label: "not ground",
        note: `${n.length.toLocaleString()} points`,
      },
      { color: ctx.color.focus, label: "the single plane missed these" },
    ]);

    const t = ctx.track();

    t.say(
      `Every point placed: <em>${g.length.toLocaleString()} ground</em>, <em>${n.length.toLocaleString()} not</em>.`,
      2.4,
    )
      .with(2.0, ctx.rig.flyTo(pose([-46, -38, 20], [6, 0, -1.6])), Ease.cinematic)
      .with(1.6, {
        onEnter: () =>
          ctx.readout("Patchwork++", [
            { label: "ground", value: g.length.toLocaleString(), state: "pass" },
            { label: "not ground", value: n.length.toLocaleString() },
            { label: "cells fitted", value: String(frame.cells.filter((b) => b.plane).length) },
            { label: "this run", value: `${frame.elapsedMs.toFixed(0)} ms (JS)` },
          ]),
        onUpdate: (v) => {
          cloud.paint(g, ctx.color.ground, v);
          cloud.paint(n, ctx.color.nonGround, v);
        },
      });

    t.add(1.4, {
      onUpdate: (v) => {
        cloud.paint(g, ctx.color.ground, 1);
        cloud.fadeTo(n, Math.max(ctx.dim, 0.1), v);
      },
    });
    t.say(
      "Ground alone: kerbs, the road’s camber, the pavement rising onto the verge. None of it assumed flat.",
      3.4,
    );

    t.add(1.4, {
      onUpdate: (v) => {
        cloud.fadeTo(n, Math.max(ctx.dim, 0.1), 1);
        cloud.paint(rescued, ctx.color.focus, v);
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
      `In cyan, the <em>${rescued.length.toLocaleString()} points</em> of road the single plane threw away.`,
      3,
    );

    t.add(4.5, ctx.rig.orbit(65), Ease.inOut).with(1.0, {
      onEnter: () =>
        ctx.readout(
          "Where the time went",
          PIPELINE_STEPS.filter((step) => step.timed).map((step) => ({
            label: step.name,
            value: `${frame.timings[step.id].toFixed(1)} ms`,
          })),
        ),
    });
    t.say(
      "<em>RNR</em> drops reflections. <em>CZM</em> sizes the cells. <em>R-VPF</em> peels walls. <em>R-GPF</em> fits. <em>GLE</em> judges. <em>A-GLE</em> learns the thresholds. <em>TGR</em> re-hears the close calls.",
      4.4,
    );

    t.add(2.4, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(2.0, {
      onUpdate: (v) => cloud.fadeTo(n, 0.9, v),
    });
    t.say("Drag to look around, or start again from the top.", 2.6);

    return t.build();
  },
};
