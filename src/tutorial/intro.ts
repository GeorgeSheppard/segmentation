import { Color, Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";

/** Step 2 — look at what the sensor actually gives you. */
export const stageScan: Stage = {
  id: "scan",
  title: "One LiDAR scan",
  subtitle: "One finished 360° sweep, exactly as the algorithm receives it.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    // One colour, on purpose: a height ramp here would sort the scan into bands that look
    // like an answer, and the reader has to start with no answer at all.
    cloud.setBaseRaw(ctx.color.raw);

    // Sensor frame gizmo: three arrows, coloured rather than labelled — the caption names
    // them as they appear, and the road running out ahead already says which one is forward.
    const axisSpec: Array<[Vector3, Color]> = [
      [new Vector3(7, 0, 0), ctx.color.nonGround],
      [new Vector3(0, 7, 0), ctx.color.ground],
      [new Vector3(0, 0, 4.5), ctx.color.plane],
    ];
    const axisLines = axisSpec.map(([v, c]) => {
      const s = ctx.segment(c, 0);
      s.set(new Vector3(0, 0, 0), v);
      return s;
    });
    const setAxes = (v: number) => {
      for (const a of axisLines) a.opacity = v;
    };
    setAxes(0);

    const t = ctx.track();

    t.say(
      `The finished sweep: <em>${frame.cloud.count.toLocaleString()} points</em>, each one a returned pulse.`,
      2.6,
    ).with(2.3, ctx.rig.flyTo(pose([-66, -62, 62], [8, -2, -1.6])), Ease.cinematic);

    t.say(
      "Sensor at the origin, <em>1.72 m</em> above the road. Three directions: forward, left, and up.",
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
    t.say(
      "One plane can't do it: real roads have camber, kerbs, hills. Patchwork++ fits <em>hundreds of small ones</em> instead, and checks each.",
      3.0,
    );

    return t.build();
  },
};
