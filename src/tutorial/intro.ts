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
    cloud.setBaseRaw(ctx.color.raw);

    // One colour, on purpose: a height ramp here would sort the scan into bands that look
    // like an answer, and the reader has to start with no answer at all.
    ctx.legend([{ color: ctx.color.raw, label: "one return", note: "unlabelled, unsorted" }]);

    // Sensor frame gizmo: x forward, y left, z up.
    const axisSpec: Array<[Vector3, Color, string, "" | "accent"]> = [
      [new Vector3(7, 0, 0), ctx.color.nonGround, "forward", ""],
      [new Vector3(0, 7, 0), ctx.color.ground, "left", ""],
      [new Vector3(0, 0, 4.5), ctx.color.plane, "up", "accent"],
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
      "One plane cannot do it — a real road has camber, kerbs and hills. So Patchwork++ fits <em>hundreds of small ones</em> and checks each.",
      3.0,
    );

    return t.build();
  },
};
