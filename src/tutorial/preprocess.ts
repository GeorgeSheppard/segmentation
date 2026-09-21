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
    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2, ctx.theme);

    ctx.legend([
      { color: ctx.color.focus, label: "reflected noise", note: "removed by RNR" },
      { color: ctx.color.plane, label: "RNR floor", note: "−sensorHeight − 0.8 m" },
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

    // The ray that produced it: straight out from the sensor, through the virtual point.
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

    const heroLabel = ctx.label(
      "virtual point",
      heroPos.clone().add(new Vector3(0, 0, -1.3)),
      "warn",
    );
    const incLabel = ctx.label(
      "reflective surface — bonnet, roof or glass",
      incidence.clone().add(new Vector3(0, 0, 1.8)),
      "accent",
    );
    heroLabel.opacity = 0;
    incLabel.opacity = 0;

    const t = ctx.track();

    t.say(
      "First, Patchwork++ discards a handful of points. Very few, but they do real damage.",
      3,
    ).with(2.1, ctx.rig.flyTo(pose([-52, -40, 8], [10, 2, -5])), Ease.cinematic);

    // Blow the noise points up so three points among 124,000 are actually findable.
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
    t.add(1.0, { onUpdate: (v) => (heroLabel.opacity = v) });
    t.say(`This one reads <em>z = ${fmt(heroPos.z)} m</em>. Eight metres under the car.`, 2.6);

    t.add(1.2, { onUpdate: (v) => (ray.opacity = v * 0.9) });
    t.say(
      "It is a reflection. The beam bounced off something mirror-like and returned late, so the point lands far out along the outgoing ray.",
      3.8,
    );
    t.add(1.0, {
      onUpdate: (v) => {
        incidenceMark.opacity = v;
        incLabel.opacity = v;
      },
    });
    t.wait(1.2);

    t.say(
      "Every plane fit starts from <em>the lowest points in a cell</em>. One phantom point tips the whole fit.",
      3.2,
    );

    // The three tests.
    t.add(0.8, {
      onEnter: () =>
        ctx.readout("RNR tests", [
          {
            label: "vertical angle",
            value: `${fmt(heroAngle, 1)}° < −15°`,
            state: "pass",
          },
          {
            label: "height",
            value: `${fmt(heroPos.z)} < ${fmt(-frame.stateBefore.sensorHeight - 0.8)}`,
            state: "pass",
          },
          {
            label: "intensity",
            value: `${fmt(heroIntensity, 3)} < 0.2`,
            state: "pass",
          },
        ]),
      onUpdate: (v) => (floor.opacity = v * 0.1),
    });
    t.say(
      "RNR needs <em>all three</em>: a downward ray, well below the road, and dim. Reflections lose energy on the extra bounce.",
      3.8,
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
        heroLabel.opacity = 1 - v;
        incLabel.opacity = 1 - v;
        floor.opacity = 0.1 * (1 - v);
      },
    });
    t.say("Gone. Nothing downstream sees them.", 2);

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

/** Step 4 — CZM: the polar grid whose cells are sized to the sensor's density falloff. */
export const stageCzm: Stage = {
  id: "czm",
  steps: ["czm"],
  title: "CZM — the Concentric Zone Model",
  subtitle:
    "504 polar cells in four zones, sized against sparsity far out and over-resolution up close.",

  build(ctx: StageContext) {
    const { cloud, frame, czm, params } = ctx;
    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2, ctx.theme);

    ctx.legend(
      zoneColors(ctx.theme).map((c, i) => ({
        color: `#${c.getHexString()}`,
        label: ["Z1 central", "Z2 quarter", "Z3 half", "Z4 outer"][i],
        note: `${czm.minRanges[i].toFixed(1)}–${czm.maxRanges[i].toFixed(1)} m · ${
          params.numRingsEachZone[i]
        }×${params.numSectorsEachZone[i]}`,
      })),
    );

    const grid = ctx.grid();
    grid.setOpacity(0);

    // A uniform polar grid, for the comparison.
    const uni = uniformGrid(params);
    const uniGrid = ctx.own(new CzmGrid(uni.czm, uni.params, ctx.groundZ, [ctx.color.dim]));
    uniGrid.setOpacity(0);
    ctx.scratch.add(uniGrid.group);

    const zoneLabels = [0, 1, 2, 3].map((z) => {
      const r = (czm.minRanges[z] + czm.maxRanges[z]) / 2;
      const l = ctx.label(
        `Z${z + 1} · ${params.numRingsEachZone[z]} rings × ${params.numSectorsEachZone[z]} sectors`,
        new Vector3(r * Math.cos(Math.PI * 0.32), r * Math.sin(Math.PI * 0.32), ctx.groundZ + 0.4),
        "accent",
      );
      l.opacity = 0;
      return l;
    });

    const focus = ctx.bin("0/0/12");
    const focusOutline = ctx.outline(focus, ctx.groundZ, null, ctx.color.seed);
    focusOutline.opacity = 0;

    const t = ctx.track();

    t.say("From above. Density falls off as <em>1/r²</em>.", 2.2).with(
      2.3,
      ctx.rig.flyTo(pose([-4, -6, 96], [0, 0, -1.7])),
      Ease.cinematic,
    );

    t.add(1.4, { onUpdate: (v) => uniGrid.setOpacity(v * 0.5) }).with(1.4, {
      onUpdate: (v) => cloud.fadeAllTo(0.35, v),
    });
    t.say(
      "An even grid fails twice. Far cells hold three or four points. Near cells are smaller than the road’s own texture.",
      3.8,
    );

    t.add(1.6, { onUpdate: (v) => uniGrid.setOpacity(0.5 * (1 - v)) });
    t.say("The Concentric Zone Model sizes cells to the data. Four zones, four resolutions.", 2.8);

    // Build the zones one at a time, outward — drawn, not faded in. A hand sweeps round
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
            // The hand fades out as it closes the loop, leaving the finished zone behind.
            hand.opacity = 0.9 * Math.min(1, (1 - v) * 4);
            zoneLabels[z].opacity = Math.min(1, v * 2.2);
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
      "<em>Z1</em> is deliberately coarse. Cells small enough to fit the kerb give a meaningless normal.",
      3,
    );
    t.say(
      "<em>Z2</em> and <em>Z3</em> hold the dense middle field, so cells get finer. Z3 takes 54 sectors.",
      3,
    );
    t.say("<em>Z4</em> coarsens again. Past 41 m there is barely any data to fit.", 2.6);

    t.add(0.8, {
      onUpdate: (v) => {
        for (const l of zoneLabels) l.opacity = 1 - v;
      },
    });
    t.add(0.8, {
      onEnter: () =>
        ctx.readout("Grid", [
          { label: "uniform", value: `${uni.czm.numBins.toLocaleString()} bins` },
          { label: "CZM", value: `${czm.numBins} bins`, state: "pass" },
          {
            label: "occupied",
            value: String(frame.cells.filter((b) => b.indices.length > 0).length),
          },
        ]),
    });
    t.say(
      `<em>${czm.numBins} cells</em> instead of ${uni.czm.numBins.toLocaleString()}. Better conditioned and six times cheaper.`,
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
