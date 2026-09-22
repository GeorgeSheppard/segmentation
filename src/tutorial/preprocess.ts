import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { zoneColors } from "../viz/palette.ts";
import { CzmGrid } from "../viz/gizmos.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fmt, uniformGrid } from "./helpers.ts";

/** Step 3 — RNR: the mirror-image points hiding under the road. */
export const stageRnr: Stage = {
  id: "rnr",
  steps: ["rnr"],
  title: "RNR — Reflected Noise Removal",
  subtitle: "A few points arrive from under the road. Each one ruins the cell it lands in.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    const params = ctx.params;
    cloud.setBaseRaw(ctx.color.raw);

    ctx.legend([
      { color: ctx.color.focus, label: "reflected noise", note: "removed by RNR" },
      { color: ctx.color.plane, label: "RNR floor", note: "well below the road surface" },
    ]);

    const noise = frame.noiseIndices;
    // The deepest one is the clearest illustration.
    let hero = noise[0] ?? 0;
    for (const i of noise) {
      if (ctx.xyz[i * 3 + 2] < ctx.xyz[hero * 3 + 2]) hero = i;
    }
    const heroPos = ctx.pointAt(hero);
    const heroIntensity = frame.cloud.intensity[hero];
    const heroRange = Math.hypot(heroPos.x, heroPos.y);
    const heroAngle = (Math.atan2(heroPos.z, heroRange) * 180) / Math.PI;

    // The ray that produced it: straight out from the sensor, through the phantom point.
    const ray = ctx.segment(ctx.color.focus, 0, true);
    ray.set(new Vector3(0, 0, 0), heroPos);
    // Where that ray crosses the road — roughly where the reflective surface must be.
    const s = Math.abs(ctx.groundZ / heroPos.z);
    const incidence = heroPos.clone().multiplyScalar(s);
    const incidenceMark = ctx.segment(ctx.color.seed, 0);
    incidenceMark.set(
      incidence.clone().add(new Vector3(0, 0, -0.6)),
      incidence.clone().add(new Vector3(0, 0, 1.2)),
    );

    const floor = ctx.surface(
      params.minRange,
      params.maxRange,
      0,
      Math.PI * 2,
      ctx.color.plane,
      0,
      64,
      6,
    );
    floor.layFlat(-frame.stateBefore.sensorHeight - 0.8);

    const t = ctx.track();

    t.say("First, Patchwork++ throws a handful of points away.", 2.2).with(
      2.1,
      ctx.rig.flyTo(pose([-52, -40, 8], [10, 2, -5])),
      Ease.cinematic,
    );

    // Blow the noise points up so a handful of points among ~120,000 are actually findable.
    t.add(1.4, {
      onUpdate: (v) => {
        cloud.paint(noise, ctx.color.focus, v);
        cloud.sizeTo(noise, 7, v);
        cloud.fadeAllTo(Math.max(ctx.dim, 0.12), v);
        cloud.fadeTo(noise, 1, v);
      },
    });
    t.say(`<em>${noise.length} points</em>, all of them metres <em>below</em> the road.`, 2.4);

    t.add(
      2.4,
      ctx.rig.flyTo({
        position: heroPos.clone().add(new Vector3(-13, -11, 7)),
        target: heroPos.clone().add(new Vector3(0, 0, 2.5)),
      }),
      Ease.cinematic,
    );
    t.say(`This one sits <em>${fmt(heroPos.z)} m</em> down, eight metres under the car.`, 2.6);

    t.add(1.2, { onUpdate: (v) => (ray.opacity = v * 0.9) });
    t.say(
      "It's a reflection: the beam bounced off something mirror-like — a bonnet, a roof, glass — and came back late, landing the point far out along the ray.",
      4.0,
    );
    t.add(1.0, { onUpdate: (v) => (incidenceMark.opacity = v) });
    t.wait(1.2);

    t.say(
      "Every plane fit starts from <em>the lowest points in a cell</em>. One phantom point tips the whole fit.",
      3.2,
    );

    // The three tests.
    t.add(0.8, {
      onUpdate: (v) => (floor.opacity = v * 0.1),
    });
    t.say(
      `RNR needs <em>all three</em>: a ray pointing down — this one <em>${fmt(heroAngle, 0)}°</em> below ` +
        `horizontal — a point well under the road, and a dim return, <em>${(heroIntensity * 100).toFixed(0)}%</em> ` +
        `here. Reflections lose energy on the extra bounce.`,
      4.2,
    );

    t.say(
      "The intensity test is what makes it safe. A plain height cutoff would delete real road on every downhill.",
      3.4,
    );

    t.add(1.6, {
      onUpdate: (v) => {
        cloud.setAlpha(noise, 1 - v);
        ray.opacity = 0.9 * (1 - v);
        incidenceMark.opacity = 1 - v;
        floor.opacity = 0.1 * (1 - v);
      },
    });
    t.say("Removed. The rest of the pipeline never sees them.", 2.2);

    t.add(2.4, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.4, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        cloud.setAlpha(noise, 0); // the removed points stay removed
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

/** Names for the four zones, closest to farthest — plain words, not the paper's Z1..Z4. */
const BAND_NAMES = ["closest band", "band 2", "band 3", "farthest band"];

/** Step 4 — CZM: the grid whose cells are sized to the sensor's density falloff. */
export const stageCzm: Stage = {
  id: "czm",
  steps: ["czm"],
  title: "CZM — the Concentric Zone Model",
  subtitle: "504 cells in four bands, each sized to match how crowded that distance is.",

  build(ctx: StageContext) {
    const { cloud, czm, params } = ctx;
    cloud.setBaseRaw(ctx.color.raw);

    ctx.legend(
      zoneColors(ctx.theme).map((c, i) => ({
        color: `#${c.getHexString()}`,
        label: BAND_NAMES[i],
        note: `${czm.minRanges[i].toFixed(1)}–${czm.maxRanges[i].toFixed(1)} m · ${
          params.numRingsEachZone[i]
        } rings, ${params.numSectorsEachZone[i]} wedges`,
      })),
    );

    const grid = ctx.grid();
    grid.setOpacity(0);

    // A uniform polar grid, for the comparison.
    const uni = uniformGrid(params);
    const uniGrid = ctx.own(new CzmGrid(uni.czm, uni.params, ctx.groundZ, [ctx.color.dim]));
    uniGrid.setOpacity(0);
    ctx.scratch.add(uniGrid.group);

    const focus = ctx.bin("0/0/12");
    const focusOutline = ctx.outline(focus, ctx.groundZ, null, ctx.color.seed);
    focusOutline.opacity = 0;

    const t = ctx.track();

    t.say(
      "From above. The further out, the fewer points land in the same patch of road.",
      2.4,
    ).with(2.3, ctx.rig.flyTo(pose([-4, -6, 96], [0, 0, -1.7])), Ease.cinematic);

    t.add(1.4, { onUpdate: (v) => uniGrid.setOpacity(v * 0.5) }).with(1.4, {
      onUpdate: (v) => cloud.fadeAllTo(0.35, v),
    });
    t.say(
      "An even grid fails twice. Far cells hold three or four points. Near cells are smaller than the road’s own texture.",
      3.8,
    );

    t.add(1.6, { onUpdate: (v) => uniGrid.setOpacity(0.5 * (1 - v)) });
    t.say(
      "The Concentric Zone Model sizes each cell to match its distance. Four bands, four cell sizes.",
      3,
    );

    // Build the bands one at a time, outward — drawn, not faded in. A hand sweeps round
    // from straight ahead the way the sensor does, the ring arcs trail behind it, and each
    // spoke appears as the sweep crosses it.
    // Focus colour, not the grid colour — otherwise the hand looks like just another spoke.
    const hand = ctx.segment(ctx.color.focus, 0, true);
    const sweepTo = (zone: number, turn: number) => {
      grid.setZoneSweep(zone, turn);
      const angle = turn * Math.PI * 2;
      const inner = czm.minRanges[zone];
      const outer = czm.maxRanges[zone];
      hand.set(
        [Math.cos(angle) * inner, Math.sin(angle) * inner, ctx.groundZ],
        [Math.cos(angle) * outer, Math.sin(angle) * outer, ctx.groundZ],
      );
    };

    for (let z = 0; z < 4; z++) {
      grid.setZoneSweep(z, 0);
      t.add(
        1.25,
        {
          onEnter: () => grid.setZoneOpacity(z, 0.78),
          onUpdate: (v) => {
            sweepTo(z, v);
            // The hand fades out as it closes the loop, leaving the finished band behind.
            hand.opacity = 0.9 * Math.min(1, (1 - v) * 4);
          },
          onExit: () => {
            grid.setZoneSweep(z, 1);
            hand.opacity = 0;
          },
        },
        Ease.inOut,
      );
      t.wait(0.2);
    }

    t.at(t.time - 5.8).say(
      "<em>Band 1</em> is deliberately coarse. Cells small enough to fit the kerb would be too noisy to trust.",
      3.2,
    );
    t.say(
      "<em>Bands 2 and 3</em> hold the dense middle field, so cells get finer. Band 3 alone has 54 wedges.",
      3.2,
    );
    t.say("<em>Band 4</em> coarsens again. Past 41 m there is barely any data to work with.", 2.6);

    t.wait(0.8);
    t.say(
      `<em>${czm.numBins} cells</em> instead of ${uni.czm.numBins.toLocaleString()}. More reliable, and six times cheaper to compute.`,
      3,
    );

    // Drop into a single cell: this is the unit everything else works on.
    t.add(1.0, { onUpdate: (v) => (focusOutline.opacity = v) });
    t.add(
      2.4,
      ctx.rig.flyTo(ctx.binPose(focus, { distance: 9, height: 4.5 })),
      Ease.cinematic,
    ).with(1.6, {
      onUpdate: (v) => {
        cloud.focusOn(focus.indices, ctx.dim, v, 2.4);
        grid.setOpacity(0.75 * (1 - v * 0.75));
      },
    });
    t.say(
      `Everything from here happens in one cell: <em>${focus.indices.length.toLocaleString()} points</em>, ${focus.radii[0].toFixed(1)}\u2013${focus.radii[1].toFixed(1)} m out, 22.5° wide.`,
      3.4,
    );

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        cloud.sizeTo(focus.indices, 1, v);
        grid.setOpacity(0.19 + 0.06 * v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};
