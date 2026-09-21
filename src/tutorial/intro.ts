import { Color, Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { type CellTrace, isGroundLabel, type PointLabel } from "../patchwork/index.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fitGlobalPlane } from "./helpers.ts";

/** Step 2 — look at what the sensor actually gives you. */
export const stageScan: Stage = {
  id: "scan",
  title: "One LiDAR scan",
  subtitle: "One finished 360° sweep, exactly as the algorithm receives it.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    cloud.setBaseRaw(ctx.color.raw);

    // One colour, on purpose: a height ramp here would sort the scan into bands that look
    // like an answer, and the reader has to start with no answer at all.
    ctx.legend([{ color: ctx.color.raw, label: "one return", note: "unlabelled, unsorted" }]);

    // Sensor frame gizmo: x forward, y left, z up.
    const axisSpec: Array<[Vector3, Color, string, "" | "accent"]> = [
      [new Vector3(7, 0, 0), ctx.color.nonGround, "x — forward", ""],
      [new Vector3(0, 7, 0), ctx.color.ground, "y — left", ""],
      [new Vector3(0, 0, 4.5), ctx.color.plane, "z — up", "accent"],
    ];
    const axisLines = axisSpec.map(([v, c]) => {
      const s = ctx.segment(c, 0);
      s.set(new Vector3(0, 0, 0), v);
      return s;
    });
    const axisLabels = axisSpec.map(([v, , text, variant]) =>
      ctx.label(text, v.clone().multiplyScalar(1.14), variant),
    );
    const setAxes = (v: number) => {
      for (const a of axisLines) a.opacity = v;
      for (const l of axisLabels) l.opacity = v;
    };
    setAxes(0);

    const t = ctx.track();

    t.say(
      `The finished sweep: <em>${frame.cloud.count.toLocaleString()} points</em>, every one of them a surface that sent a pulse back.`,
      2.6,
    ).with(2.3, ctx.rig.flyTo(pose([-66, -62, 62], [8, -2, -1.6])), Ease.cinematic);

    t.say(
      "Sensor at the origin, <em>1.72 m</em> above the road. <code>x</code> forward, <code>y</code> left, <code>z</code> up.",
      3.2,
    ).with(1.4, { onUpdate: setAxes });

    t.add(2.6, ctx.rig.flyTo(pose([-14, -10, 4.5], [3.5, 1, -1.6])), Ease.cinematic).with(1.0, {
      onUpdate: (v) => setAxes(1 - v),
    });
    t.say("<em>64 laser rings</em>. Dense near the car, sparse far out.", 2.4);

    t.add(4.2, ctx.rig.orbit(50), Ease.inOut);
    t.say(
      "The job: label every point <em>ground</em> or <em>not ground</em>. Fast, on any road, without training data.",
      3.2,
    );

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic);
    t.wait(0.3);

    return t.build();
  },
};

/** Step 3 — why the obvious approach fails. */
export const stageProblem: Stage = {
  id: "problem",
  title: "Why one plane is not enough",
  subtitle:
    "Fit one plane to the whole scan and the road's curvature turns real ground into obstacles.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    const { plane, ground, nonGround } = fitGlobalPlane(frame.cloud, ctx.params);

    // Where the single plane and Patchwork++ disagree: real road the plane throws away.
    const singleIsGround = new Uint8Array(frame.cloud.count);
    for (const i of ground) singleIsGround[i] = 1;
    const missed: number[] = [];
    for (let i = 0; i < frame.cloud.count; i++) {
      if (!singleIsGround[i] && isGroundLabel(frame.labels[i] as PointLabel)) missed.push(i);
    }
    const missedArr = Int32Array.from(missed);

    // Zoom to wherever the disagreement is worst, rather than a hard-coded cell.
    const worst = worstBin(ctx, missedArr);

    cloud.setBaseRaw(ctx.color.raw);

    ctx.legend([
      { color: ctx.color.plane, label: "the one plane" },
      { color: ctx.color.ground, label: "kept as ground" },
      { color: ctx.color.nonGround, label: "called an obstacle" },
      { color: "#38bdf8", label: "road, thrown away", note: "under-segmentation" },
    ]);

    const lid = ctx.surface(
      ctx.params.minRange,
      ctx.params.maxRange,
      0,
      Math.PI * 2,
      ctx.color.plane,
      0,
    );
    lid.layOnPlane(plane.normal, plane.d);

    const t = ctx.track();

    t.say(
      "The obvious approach: fit <em>one</em> plane to the lowest points. Anything near it is ground.",
      3,
    ).with(2.0, ctx.rig.flyTo(pose([-66, -48, 24], [6, 0, -1.6])), Ease.cinematic);

    t.add(1.6, {
      onUpdate: (v) => {
        lid.opacity = v * 0.16;
        cloud.paint(ground, ctx.color.ground, v);
        cloud.paint(nonGround, ctx.color.nonGround, v * 0.85);
      },
    });
    t.say("Near the car it works. The fit is anchored there.", 2.2);

    t.add(2.6, ctx.rig.flyTo(ctx.binPose(worst, { distance: 22, height: 11 })), Ease.cinematic);
    t.say("Further out, the road curves away from the plane.", 2.4);

    t.add(1.4, {
      onUpdate: (v) => {
        cloud.paint(missedArr, "#38bdf8", v);
        cloud.sizeTo(missedArr, 1.9, v);
      },
    });
    t.say(
      `<em>${missedArr.length.toLocaleString()} points</em> of road, labelled obstacle. Clustering turns those into walls that are not there.`,
      3.4,
    );

    t.add(2.7, ctx.rig.flyTo(ctx.overview), Ease.cinematic);
    t.say("So fit <em>hundreds of small planes</em> instead, and check each one.", 2.8);

    return t.build();
  },
};

/** The bin holding the most disagreement — where the single-plane failure is easiest to see. */
function worstBin(ctx: StageContext, missed: Int32Array): CellTrace {
  const inBin = new Map<string, number>();
  const index = new Map<number, string>();
  for (const bin of ctx.frame.cells) {
    for (const i of bin.indices) index.set(i, bin.key);
  }
  for (const i of missed) {
    const key = index.get(i);
    if (key) inBin.set(key, (inBin.get(key) ?? 0) + 1);
  }
  let bestKey = "";
  let best = -1;
  for (const [key, n] of inBin) {
    const bin = ctx.frame.cellsByKey.get(key)!;
    // Prefer the mid/far field: that is where the flat-world assumption actually breaks.
    if (bin.zone < 2) continue;
    if (n > best) {
      best = n;
      bestKey = key;
    }
  }
  return ctx.frame.cellsByKey.get(bestKey) ?? ctx.frame.cells.find((b) => b.zone === 2)!;
}
