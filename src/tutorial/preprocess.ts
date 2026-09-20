import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { COLORS, ZONE_COLORS } from "../viz/palette.ts";
import { CzmGrid } from "../viz/gizmos.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fmt, uniformGrid } from "./helpers.ts";

/** Step 3 — RNR: the mirror-image points hiding under the road. */
export const stageRnr: Stage = {
  id: "rnr",
  title: "RNR — Reflected Noise Removal",
  subtitle:
    "A handful of points arrive from under the road. Each one, left alone, wrecks an entire cell.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    const params = ctx.params;
    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2);

    ctx.legend([
      { color: COLORS.noise, label: "reflected noise", note: "removed by RNR" },
      { color: COLORS.plane, label: "RNR floor", note: "−sensorHeight − 0.8 m" },
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
    const ray = ctx.segment(COLORS.noise, 0, true);
    ray.set(new Vector3(0, 0, 0), heroPos);
    // Where that ray crosses the road — roughly where the reflective surface must be.
    const s = Math.abs(ctx.groundZ / heroPos.z);
    const incidence = heroPos.clone().multiplyScalar(s);
    const incidenceMark = ctx.segment(COLORS.seed, 0);
    incidenceMark.set(
      incidence.clone().add(new Vector3(0, 0, -0.6)),
      incidence.clone().add(new Vector3(0, 0, 1.2)),
    );

    const floor = ctx.surface(
      params.minRange,
      params.maxRange,
      0,
      Math.PI * 2,
      COLORS.plane,
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
      "Before anything else, Patchwork++ throws away a few points. Only a few — but they are the dangerous ones.",
      3.0,
    ).with(2.6, ctx.rig.flyTo(pose([-52, -40, 8], [10, 2, -5])), Ease.cinematic);

    // Blow the noise points up so three points among 124,000 are actually findable.
    t.add(1.4, {
      onUpdate: (v) => {
        cloud.paint(noise, COLORS.noise, v);
        cloud.sizeTo(noise, 7, v);
        cloud.fadeAllTo(0.25, v * 0.8);
        cloud.fadeTo(noise, 1, v);
      },
    });
    t.say(
      `There they are: <em>${noise.length} points</em> that claim to be metres <em>below</em> the road surface.`,
      3.4,
    );

    t.add(
      3.0,
      ctx.rig.flyTo({
        position: heroPos.clone().add(new Vector3(-13, -11, 7)),
        target: heroPos.clone().add(new Vector3(0, 0, 2.5)),
      }),
      Ease.cinematic,
    );
    t.add(1.0, { onUpdate: (v) => (heroLabel.opacity = v) });
    t.say(
      `This one sits at <em>z = ${fmt(heroPos.z)} m</em> — more than eight metres under the car. No road does that.`,
      3.8,
    );

    t.add(1.2, { onUpdate: (v) => (ray.opacity = v * 0.9) });
    t.say(
      "It is a reflection. The beam hit something mirror-like, bounced, and came back late — so the sensor reports a point far out along the outgoing ray.",
      4.6,
    );
    t.add(1.0, {
      onUpdate: (v) => {
        incidenceMark.opacity = v;
        incLabel.opacity = v;
      },
    });
    t.wait(1.2);

    t.say(
      "Why it matters: every plane fit in Patchwork++ starts from <em>the lowest points in a cell</em>. One phantom point below the road tips the whole plane over.",
      4.8,
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
      "RNR only removes a point if <em>all three</em> hold: it came from a downward ray, it is well below the road, and it came back dim — reflections lose energy on the extra bounce.",
      5.4,
    );

    t.say(
      "That last test is what makes it safe. A blunt <code>z &lt; threshold</code> filter would delete real road every time the car drives downhill.",
      4.4,
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
    t.say("Gone. The rest of the pipeline never sees them.", 2.4);

    t.add(3.0, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.4, {
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
  title: "CZM — the Concentric Zone Model",
  subtitle:
    "504 polar cells, in four zones, with bin sizes chosen to fight sparsity far away and over-resolution up close.",

  build(ctx: StageContext) {
    const { cloud, frame, czm, params } = ctx;
    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2);

    ctx.legend(
      ZONE_COLORS.slice(0, 4).map((c, i) => ({
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
    const uniGrid = ctx.own(new CzmGrid(uni.czm, uni.params, ctx.groundZ));
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
    const focusOutline = ctx.outline(focus, ctx.groundZ, null, COLORS.seed);
    focusOutline.opacity = 0;

    const t = ctx.track();

    t.say(
      "Looking straight down. Point density is not uniform — it falls off roughly as <em>1/r²</em>.",
      3.0,
    ).with(2.8, ctx.rig.flyTo(pose([-4, -6, 96], [0, 0, -1.7])), Ease.cinematic);

    t.add(1.4, { onUpdate: (v) => uniGrid.setOpacity(v * 0.5) }).with(1.4, {
      onUpdate: (v) => cloud.fadeAllTo(0.35, v),
    });
    t.say(
      "So an even polar grid gets it wrong twice: cells far out hold three or four points — too few to fit anything — while cells up close are smaller than the road's own texture.",
      5.4,
    );

    t.add(1.6, { onUpdate: (v) => uniGrid.setOpacity(0.5 * (1 - v)) });
    t.say(
      "The Concentric Zone Model sizes the cells to match the data. Four zones, each with its own resolution.",
      3.6,
    );

    // Build the zones one at a time, outward.
    for (let z = 0; z < 4; z++) {
      t.add(0.9, {
        onUpdate: (v) => {
          grid.setZoneOpacity(z, v * 0.75);
          zoneLabels[z].opacity = v;
        },
      });
      t.wait(0.35);
    }

    t.at(t.time - 5).say(
      "<em>Z1</em> is deliberately coarse — cells small enough to fit the kerb would give a meaningless normal.",
      2.6,
    );
    t.say(
      "<em>Z2</em> and <em>Z3</em> are the dense middle field, so the cells get finer. Z3 gets the most sectors of all: 54.",
      3.0,
    );
    t.say(
      "<em>Z4</em> goes coarse again — past 41 m there is barely any data, so cells have to be big to hold enough points to fit.",
      3.2,
    );

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
      `That is <em>${czm.numBins} cells</em> instead of ${uni.czm.numBins.toLocaleString()} — better conditioned <em>and</em> six times cheaper.`,
      4.0,
    );

    // Drop into a single cell: this is the unit everything else works on.
    t.add(1.0, { onUpdate: (v) => (focusOutline.opacity = v) });
    t.add(
      3.0,
      ctx.rig.flyTo(ctx.binPose(focus, { distance: 9, height: 4.5 })),
      Ease.cinematic,
    ).with(1.6, {
      onUpdate: (v) => {
        cloud.focusOn(focus.indices, 0.12, v, 1.5);
        grid.setOpacity(0.75 * (1 - v * 0.75));
      },
    });
    t.say(
      `From here on, everything happens inside one cell like this one — <em>${focus.indices.length.toLocaleString()} points</em>, ${focus.radii[0].toFixed(
        1,
      )}–${focus.radii[1].toFixed(1)} m out, 22.5° wide.`,
      4.6,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
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
