import { Color, Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { type CellTrace, PointLabel } from "../patchwork/index.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fmt, thickness } from "./helpers.ts";

const GOOD_CELL = "0/0/12";
/** A plane fitted to a car roof: horizontal, but above the sensor origin. */
const ROOF_CELL = "1/0/9";
/** A wall: the normal is nowhere near vertical. */
const WALL_CELL = "1/0/6";

/** Step 8 — GLE: the three tests that decide whether a fitted plane is really ground. */
export const stageGle: Stage = {
  id: "gle",
  steps: ["gle"],
  title: "GLE — is that plane really ground?",
  subtitle: "R-GPF always returns a plane. GLE is the veto: uprightness, elevation, flatness.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    const good = ctx.bin(GOOD_CELL);
    const roof = ctx.bin(ROOF_CELL);
    const wall = ctx.bin(WALL_CELL);

    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2, ctx.theme);
    cloud.setAlphaAll(ctx.dim);
    // All three cells stay dim until it is their turn, so it is never ambiguous which
    // one the narration is talking about.
    for (const b of [good, roof, wall]) {
      cloud.setAlpha(b.indices, 0.3);
      cloud.setSize(b.indices, 1.4);
    }
    cloud.captureBase();

    ctx.legend([
      { color: ctx.color.ground, label: "passes", note: "accepted as ground" },
      { color: ctx.color.nonGround, label: "not upright", note: "normal tilted > 45°" },
      { color: ctx.color.nonGround, label: "above the sensor", note: "roof or bonnet" },
    ]);

    const makeCell = (bin: CellTrace, color: Color) => {
      const outline = ctx.outline(bin, -2.1, 1.2, color);
      outline.opacity = 0;
      const surf = ctx.wedge(bin, color, 0);
      surf.layOnPlane(bin.plane!.normal, bin.plane!.d, [-2.1, 1.2]);
      const nLine = ctx.segment(ctx.color.normal, 0);
      const base = new Vector3(...bin.plane!.mean);
      nLine.set(base, base.clone().add(new Vector3(...bin.plane!.normal).multiplyScalar(2.0)));
      const nLabel = ctx.label(
        "",
        base.clone().add(new Vector3(...bin.plane!.normal).multiplyScalar(2.4)),
        "accent",
      );
      nLabel.opacity = 0;
      return { outline, surf, nLine, nLabel, bin };
    };

    const cells = {
      good: makeCell(good, ctx.color.ground),
      roof: makeCell(roof, ctx.color.nonGround),
      wall: makeCell(wall, ctx.color.nonGround),
    };

    const reveal = (c: ReturnType<typeof makeCell>, v: number, planeOpacity = 0.3) => {
      c.outline.opacity = v * 0.85;
      c.surf.opacity = v * planeOpacity;
      c.nLine.opacity = v;
      c.nLabel.opacity = v;
      cloud.fadeTo(c.bin.indices, 0.3 + 0.7 * v, 1);
      cloud.sizeTo(c.bin.indices, 1.4 + 1.0 * v, 1);
    };

    const t = ctx.track();

    // ---- Test 1: uprightness, shown on the wall cell.
    t.say("R-GPF fits whatever is in the cell. This one holds a wall.", 2.4).with(
      2.1,
      ctx.rig.flyTo(ctx.binPose(wall, { distance: 9, height: 4.5 })),
      Ease.cinematic,
    );

    t.add(1.0, {
      onEnter: () => {
        cells.wall.nLabel.text = `facing up ${wall.gle!.uprightness.toFixed(2)}`;
        ctx.verdict("Rejected — not upright", "bad");
      },
      onUpdate: (v) => reveal(cells.wall, v),
    });
    t.say(
      "First test, the cheapest: does the plane face <em>up</em>? This one is nearly on edge.",
      3,
    );
    t.add(1.0, { onUpdate: (v) => cloud.paint(wall.cellGround, ctx.color.nonGround, v) });
    t.wait(0.6);

    // ---- Test 2: elevation, shown on the roof cell.
    t.add(2.3, ctx.rig.flyTo(ctx.binPose(roof, { distance: 9, height: 4.5 })), Ease.cinematic);
    t.add(1.0, {
      onEnter: () => {
        cells.roof.nLabel.text = `facing up ${roof.gle!.uprightness.toFixed(2)}`;
      },
      onUpdate: (v) => reveal(cells.roof, v),
    });
    t.say(
      "Facing up is not enough on its own. This plane passes easily, because it is a <em>car roof</em>.",
      3.2,
    );

    const sensorDisc = ctx.surface(
      0.4,
      roof.radii[1] + 2,
      0,
      Math.PI * 2,
      ctx.color.plane,
      0,
      48,
      3,
    );
    sensorDisc.layFlat(0);
    const originLabel = ctx.label("sensor height — z = 0", new Vector3(3, 0, 0.35), "accent");
    originLabel.opacity = 0;

    t.add(1.2, {
      onEnter: () => {
        ctx.verdict("Rejected — above the sensor", "bad");
      },
      onUpdate: (v) => {
        sensorDisc.opacity = v * 0.1;
        originLabel.opacity = v;
      },
    });
    t.say(
      `Second test: where does the plane <em>sit</em>? Ground passes below the sensor. This one ` +
        `sits <em>${fmt(roof.gle!.heading)} m</em> above it.`,
      3.2,
    );
    t.add(1.0, { onUpdate: (v) => cloud.paint(roof.cellGround, ctx.color.nonGround, v) });
    t.say(
      "Elevation only discriminates near the sensor. Far out a high patch may be a hill, so past <em>17 m</em> the test is off.",
      3.6,
    );

    // ---- Test 3: flatness, on the good cell.
    t.add(2.3, ctx.rig.flyTo(ctx.binPose(good, { distance: 8.5, height: 4.2 })), Ease.cinematic);
    t.add(1.0, {
      onEnter: () => {
        cells.good.nLabel.text = `facing up ${good.gle!.uprightness.toFixed(2)}`;
        ctx.verdict("Accepted — ground", "good");
      },
      onUpdate: (v) => {
        reveal(cells.good, v);
        cloud.paint(good.cellGround, ctx.color.ground, v);
        sensorDisc.opacity = 0.1 * (1 - v);
        originLabel.opacity = 1 - v;
      },
    });
    t.say(
      "The third test rescues rather than rejects. A steep but smooth slope fails elevation and is still a surface.",
      3.4,
    );

    t.say(
      `So thickness gets a vote. This patch is <em>${thickness(good.gle!.flatness)}</em> thick: road texture, not an object.`,
      3.2,
    );

    t.say(
      "Patchwork measured thickness relative to the cell's own size, which moved when the cell shape changed. Patchwork++ measures it outright.",
      4,
    );

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        for (const c of Object.values(cells)) reveal(c, 1 - v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

/** Step 9 — run the whole thing: 504 cells, judged ring by ring. */
export const stageSweep: Stage = {
  id: "sweep",
  steps: ["seeds", "rvpf", "rgpf", "gle"],
  title: "504 cells, one scan",
  subtitle: "Everything so far, over the whole sweep, ring by ring outward.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;

    cloud.setBaseHeightRamp(frame.cloud.xyz, -3.2, 2.2, ctx.theme);
    cloud.fadeAllTo(Math.max(ctx.dim, 0.32), 1);
    cloud.captureBase();

    // Only three meanings on screen: ground, not-ground, and the one class this step is
    // about. Peeled vertical points are simply non-ground here — R-VPF's own stage is where
    // they get singled out.
    ctx.legend([
      { color: ctx.color.ground, label: "ground" },
      { color: ctx.color.nonGround, label: "not ground" },
      { color: ctx.color.focus, label: "undecided", note: "handed to TGR" },
    ]);

    const grid = ctx.grid();
    grid.setOpacity(0.25);

    // Group the bins by concentric ring so the reveal really is the processing order.
    const byRing = new Map<number, CellTrace[]>();
    for (const bin of frame.cells) {
      const list = byRing.get(bin.concentricIdx) ?? [];
      list.push(bin);
      byRing.set(bin.concentricIdx, list);
    }
    const ringOrder = [...byRing.keys()].sort((a, b) => a - b);

    const candidateIdx: number[] = [];
    for (const b of frame.cells) {
      if (b.gle?.decision === "candidate") candidateIdx.push(...b.cellGround);
    }

    const t = ctx.track();

    t.say("Seed, peel, fit, judge. Now in every cell, ring by ring, outward.", 2.6).with(
      2.1,
      ctx.rig.flyTo({
        position: new Vector3(-14, -24, 86),
        target: new Vector3(0, 0, -1.7),
      }),
      Ease.cinematic,
    );

    // A bright annulus that flashes over the ring currently being processed.
    const sweepRing = ctx.surface(0, 1, 0, Math.PI * 2, ctx.color.plane, 0, 72, 1);

    const perRing = 0.48;
    for (const ringIdx of ringOrder) {
      const ringBins = byRing.get(ringIdx)!;
      const [rIn, rOut] = ringBins[0].radii;
      const ground: number[] = [];
      const nonGround: number[] = [];
      const vertical: number[] = [];
      const undecided: number[] = [];
      for (const b of ringBins) {
        for (const r of b.rvpf) vertical.push(...r.removed);
        nonGround.push(...b.cellNonGround);
        if (b.gle?.decision === "candidate") undecided.push(...b.cellGround);
        else if (b.gle?.decision === "ground") ground.push(...b.cellGround);
        else nonGround.push(...b.cellGround);
        if (b.skipped) nonGround.push(...b.indices);
      }
      const g = Int32Array.from(ground);
      const n = Int32Array.from(nonGround);
      const u = Int32Array.from(undecided);

      t.add(perRing, {
        onEnter: () => {
          sweepRing.setRadii(rIn, rOut);
          sweepRing.layFlat(ctx.groundZ + 0.02);
        },
        onUpdate: (p) => {
          sweepRing.opacity = 0.22 * Math.sin(Math.PI * p);
          cloud.paint(g, ctx.color.ground, p);
          cloud.fadeTo(g, 1, p);
          cloud.paint(n, ctx.color.nonGround, p * 0.9);
          cloud.fadeTo(n, 0.85, p);
          cloud.paint(u, ctx.color.focus, p);
          cloud.fadeTo(u, 1, p);
          cloud.sizeTo(u, 5.5, p);
        },
      });
    }

    t.at(1.0).say(
      "The cell is the unit of work: 504 small problems, each one flat enough for the assumption to hold.",
      3.4,
    );
    t.say("No training data, no per-scene tuning, no random sampling.", 2.6);

    t.at(Math.max(t.time, 2.6 + ringOrder.length * perRing + 0.4));
    t.wait(1.2);
    t.say(
      "Nearly all decided. The amber points sit in cells GLE could not call. This scan has <em>one</em>.",
      3,
    );

    t.add(2.4, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.4, {
      onUpdate: (v) => {
        grid.setOpacity(0.25 * (1 - v));
        sweepRing.opacity = 0;
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

/** Step 10 — TGR: a second opinion, from this frame's own statistics. */
export const stageTgr: Stage = {
  id: "tgr",
  steps: ["tgr"],
  title: "TGR — Temporal Ground Revert",
  subtitle: "Borderline cells get one more hearing, against the other cells in their own ring.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;

    const candidates = frame.cells.filter((b) => b.gle?.decision === "candidate");
    const hero = candidates[0] ?? frame.cells.find((b) => b.gle?.isDefiniteGround)!;
    const ring = frame.rings.find((r) => r.concentricIdx === hero.concentricIdx)!;
    const peers = frame.cells.filter(
      (b) => b.concentricIdx === hero.concentricIdx && b.gle?.isDefiniteGround,
    );

    cloud.setBaseLabels(frame.labels, ctx.color);
    cloud.fadeAllTo(Math.max(ctx.dim, 0.22), 1);
    cloud.captureBase();

    ctx.legend([
      { color: ctx.color.focus, label: "candidate", note: "GLE could not decide" },
      { color: ctx.color.ground, label: "this ring's definite ground", note: "the reference set" },
      { color: ctx.color.focus, label: "reverted to ground" },
    ]);

    const peerCells = peers.map((b) => {
      const w = ctx.wedge(b, ctx.color.ground, 0);
      w.layFlat(b.plane ? b.plane.mean[2] : ctx.groundZ);
      return w;
    });
    const heroOutline = ctx.outline(
      hero,
      hero.gle!.elevation - 2.0,
      hero.gle!.elevation + 2.0,
      ctx.color.focus,
    );
    heroOutline.opacity = 0;
    const heroCell = ctx.wedge(hero, ctx.color.focus, 0);
    heroCell.layOnPlane(hero.plane!.normal, hero.plane!.d, [
      hero.gle!.elevation - 2.0,
      hero.gle!.elevation + 2.0,
    ]);

    const heroLabel = ctx.label(
      `${thickness(hero.gle!.flatness)} thick`,
      ctx.centreOf(hero, hero.gle!.elevation + 1.0),
      "warn",
    );
    heroLabel.opacity = 0;

    const t = ctx.track();

    t.say(
      `That cell: a small patch ${hero.radii[0].toFixed(1)} m out, <em>above</em> the elevation threshold and not flat enough to rescue.`,
      3.2,
    )
      .with(2.3, ctx.rig.flyTo(ctx.binPose(hero, { distance: 10, height: 5 })), Ease.cinematic)
      .with(1.2, {
        onUpdate: (v) => {
          heroOutline.opacity = v * 0.9;
          heroCell.opacity = v * 0.22;
          heroLabel.opacity = v;
          cloud.paint(hero.cellGround, ctx.color.focus, v);
          cloud.fadeTo(hero.cellGround, 1, v);
          cloud.sizeTo(hero.cellGround, 5, v);
        },
      });

    t.say(
      "Those thresholds came from <em>hundreds</em> of past frames, so a patch that is rough only today has no chance.",
      3.4,
    );

    t.add(1.4, {
      onUpdate: (v) => {
        for (const c of peerCells) c.opacity = v * 0.3;
      },
    });
    t.say(
      `TGR asks a different question: how flat is <em>this ring, this scan</em>? These ${ring.flatnessSamples.length} cells are the reference.`,
      3.4,
    );

    const verdict = hero.tgr!;
    t.add(1.4, {
      onEnter: () => {
        ctx.verdict(
          verdict.reverted ? "Reverted to ground" : "Final reject",
          verdict.reverted ? "good" : "bad",
        );
      },
      onUpdate: (v) => {
        if (verdict.reverted) {
          cloud.paint(hero.cellGround, ctx.color.focus, v);
          heroCell.color = ctx.color.focus;
          heroOutline.color = ctx.color.focus;
        }
        heroLabel.variant = verdict.reverted ? "good" : "bad";
      },
    });
    t.say("Against its neighbours it is not rough at all. Reverted to ground.", 2.6);

    t.say(
      "One guard first. A guardrail seen edge-on is thin too, so a patch that is long and narrow rather than broad is refused.",
      3.6,
    );

    t.say("Across SemanticKITTI: <em>+0.5% recall</em>, precision unchanged to rounding.", 2.8);

    t.add(2.6, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
      onUpdate: (v) => {
        cloud.fadeAllTo(1, v);
        heroOutline.opacity = 0.9 * (1 - v);
        heroCell.opacity = 0.3 * (1 - v);
        heroLabel.opacity = 1 - v;
        for (const c of peerCells) c.opacity = 0.3 * (1 - v);
      },
    });
    t.wait(0.3);

    return t.build();
  },
};

export { PointLabel };
