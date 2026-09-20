import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { isGroundLabel, type BinTrace, type PointLabel } from "../patchwork/types.ts";
import { COLORS } from "../viz/palette.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fitGlobalPlane } from "./helpers.ts";

/** Step 1 — look at what the sensor actually gives you. */
export const stageScan: Stage = {
  id: "scan",
  title: "One LiDAR scan",
  subtitle:
    "A single 360° sweep from a Velodyne HDL-64E on a car in Karlsruhe, coloured by height.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2);

    ctx.legend([
      { color: "#1e3a8a", label: "low", note: "road level and below" },
      { color: "#22d3ee", label: "mid", note: "cars, hedges" },
      { color: "#fb923c", label: "high", note: "walls, trees, poles" },
    ]);
    ctx.readout("Scan", [
      { label: "points", value: frame.cloud.count.toLocaleString() },
      { label: "range", value: "≤ 80 m" },
      { label: "rate", value: "10 Hz" },
    ]);

    // Sensor frame gizmo: x forward, y left, z up.
    const axisSpec: Array<[Vector3, string, string, "" | "accent"]> = [
      [new Vector3(7, 0, 0), COLORS.nonGround, "x — forward", ""],
      [new Vector3(0, 7, 0), COLORS.ground, "y — left", ""],
      [new Vector3(0, 0, 4.5), COLORS.accent, "z — up", "accent"],
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
      `This is what a self-driving car sees: <em>${frame.cloud.count.toLocaleString()} points</em>, ten times a second, with no labels at all.`,
      4.2,
    ).with(2.8, ctx.rig.flyTo(pose([-66, -62, 62], [8, -2, -1.6])), Ease.cinematic);

    t.say(
      "The sensor sits at the origin, about <em>1.72 m</em> above the road. Axes are <code>x</code> forward, <code>y</code> left, <code>z</code> up.",
      4.2,
    ).with(1.4, { onUpdate: setAxes });

    t.add(3.2, ctx.rig.flyTo(pose([-14, -10, 4.5], [3.5, 1, -1.6])), Ease.cinematic)
      .with(1.0, { onUpdate: (v) => setAxes(1 - v) });
    t.say(
      "Up close the beam pattern shows: <em>64 laser rings</em>, dense near the car and spreading fast with distance.",
      4.2,
    );

    t.add(4.2, ctx.rig.orbit(50), Ease.inOut);
    t.say(
      "The job: split every point into <em>ground</em> and <em>not ground</em> — fast enough to be a preprocessing step, on any road, with no training data.",
      4.4,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic);
    t.wait(0.3);

    return t.build();
  },
};

/** Step 2 — why the obvious approach fails. */
export const stageProblem: Stage = {
  id: "problem",
  title: "Why one plane is not enough",
  subtitle:
    "Fit a single plane to the whole scan and the road's own curvature turns real ground into phantom obstacles.",

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

    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2);

    ctx.legend([
      { color: COLORS.plane, label: "the one plane" },
      { color: COLORS.ground, label: "kept as ground" },
      { color: COLORS.nonGround, label: "called an obstacle" },
      { color: "#38bdf8", label: "road, thrown away", note: "under-segmentation" },
    ]);

    const lid = ctx.surface(ctx.params.minRange, ctx.params.maxRange, 0, Math.PI * 2, COLORS.plane, 0);
    lid.layOnPlane(plane.normal, plane.d);

    const t = ctx.track();

    t.say(
      "The classic approach: assume the world is flat, fit <em>one</em> plane to the lowest points, call everything near it ground.",
      4.2,
    ).with(2.4, ctx.rig.flyTo(pose([-66, -48, 24], [6, 0, -1.6])), Ease.cinematic);

    t.add(1.6, {
      onEnter: () =>
        ctx.readout("Single plane (GPF)", [
          { label: "normal z", value: plane.normal[2].toFixed(4) },
          { label: "ground", value: ground.length.toLocaleString() },
          { label: "obstacles", value: nonGround.length.toLocaleString() },
        ]),
      onUpdate: (v) => {
        lid.opacity = v * 0.16;
        cloud.paint(ground, COLORS.ground, v);
        cloud.paint(nonGround, COLORS.nonGround, v * 0.85);
      },
    });
    t.say("Near the car it works. The plane is fitted there, so the road lands on it.", 3.4);

    t.add(3.2, ctx.rig.flyTo(ctx.binPose(worst, { distance: 22, height: 11 })), Ease.cinematic);
    t.say(
      "Further out, the surface has drifted off the fit — and the algorithm has stopped believing it is road.",
      4.0,
    );

    t.add(1.4, {
      onEnter: () =>
        ctx.readout("Disagreement", [
          {
            label: "road thrown away",
            value: missedArr.length.toLocaleString(),
            state: "fail",
          },
          {
            label: "of true ground",
            value: `${((100 * missedArr.length) / Math.max(1, frame.groundCount)).toFixed(1)}%`,
          },
        ]),
      onUpdate: (v) => {
        cloud.paint(missedArr, "#38bdf8", v);
        cloud.sizeTo(missedArr, 1.9, v);
      },
    });
    t.say(
      `<em>${missedArr.length.toLocaleString()} points</em> of real road end up labelled as obstacles. Clustering will fuse them into walls that are not there.`,
      4.4,
    );

    t.add(3.4, ctx.rig.flyTo(ctx.overview), Ease.cinematic);
    t.say(
      "So: stop fitting one plane. Fit <em>hundreds of small ones</em>, and check every single one.",
      3.8,
    );

    return t.build();
  },
};

/** The bin holding the most disagreement — where the single-plane failure is easiest to see. */
function worstBin(ctx: StageContext, missed: Int32Array): BinTrace {
  const inBin = new Map<string, number>();
  const index = new Map<number, string>();
  for (const bin of ctx.frame.bins) {
    for (const i of bin.indices) index.set(i, bin.key);
  }
  for (const i of missed) {
    const key = index.get(i);
    if (key) inBin.set(key, (inBin.get(key) ?? 0) + 1);
  }
  let bestKey = "";
  let best = -1;
  for (const [key, n] of inBin) {
    const bin = ctx.frame.binsByKey.get(key)!;
    // Prefer the mid/far field: that is where the flat-world assumption actually breaks.
    if (bin.zone < 2) continue;
    if (n > best) {
      best = n;
      bestKey = key;
    }
  }
  return ctx.frame.binsByKey.get(bestKey) ?? ctx.frame.bins.find((b) => b.zone === 2)!;
}
