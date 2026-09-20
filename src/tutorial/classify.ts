import { Color, Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { type CellTrace, PointLabel } from "../patchwork/index.ts";
import { type Stage, type StageContext } from "./context.ts";
import { fmt } from "./helpers.ts";

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
  subtitle:
    "R-GPF always returns a plane. Ground Likelihood Estimation is the veto: uprightness, elevation, flatness.",

  build(ctx: StageContext) {
    const { cloud, frame, params } = ctx;
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
    t.say(
      "R-GPF is not allowed to have an opinion — it fits a plane to whatever is in the cell. This cell contains a wall.",
      3.0,
    ).with(2.6, ctx.rig.flyTo(ctx.binPose(wall, { distance: 9, height: 4.5 })), Ease.cinematic);

    t.add(1.0, {
      onEnter: () => {
        cells.wall.nLabel.text = `n<sub>z</sub> = ${wall.gle!.uprightness.toFixed(3)}`;
        ctx.readout("Test 1 · uprightness", [
          { label: "normal z", value: wall.gle!.uprightness.toFixed(3) },
          { label: "threshold", value: `> ${params.uprightnessThr}` },
          { label: "verdict", value: "REJECT", state: "fail" },
        ]);
        ctx.verdict("Rejected — not upright", "bad");
      },
      onUpdate: (v) => reveal(cells.wall, v),
    });
    t.say(
      `The first test is the cheapest: does the normal point <em>up</em>? Here n<sub>z</sub> = ${wall.gle!.uprightness.toFixed(
        3,
      )}, nowhere near the 0.707 needed for 45°. Rejected.`,
      4.6,
    );
    t.add(1.0, { onUpdate: (v) => cloud.paint(wall.cellGround, ctx.color.nonGround, v) });
    t.wait(0.6);

    // ---- Test 2: elevation, shown on the roof cell.
    t.add(2.8, ctx.rig.flyTo(ctx.binPose(roof, { distance: 9, height: 4.5 })), Ease.cinematic);
    t.add(1.0, {
      onEnter: () => {
        cells.roof.nLabel.text = `n<sub>z</sub> = ${roof.gle!.uprightness.toFixed(3)}`;
        ctx.readout("Test 1 · uprightness", [
          { label: "normal z", value: roof.gle!.uprightness.toFixed(3) },
          { label: "threshold", value: `> ${params.uprightnessThr}` },
          { label: "verdict", value: "PASS", state: "pass" },
        ]);
      },
      onUpdate: (v) => reveal(cells.roof, v),
    });
    t.say(
      `Uprightness is not enough on its own. This plane passes it easily — n<sub>z</sub> = ${roof.gle!.uprightness.toFixed(
        3,
      )} — because it is the <em>roof of a car</em>, and roofs are horizontal.`,
      4.8,
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
        ctx.readout("Test 2 · elevation", [
          { label: "plane mean z", value: `${fmt(roof.gle!.elevation)} m` },
          { label: "heading n·p̄", value: fmt(roof.gle!.heading), state: "fail" },
          { label: "verdict", value: "REJECT", state: "fail" },
        ]);
        ctx.verdict("Rejected — above the sensor", "bad");
      },
      onUpdate: (v) => {
        sensorDisc.opacity = v * 0.1;
        originLabel.opacity = v;
      },
    });
    t.say(
      "So the second test asks where the plane <em>sits</em>. A real ground plane passes below the sensor. This one does not — its supporting point is above the origin.",
      5.0,
    );
    t.add(1.0, { onUpdate: (v) => cloud.paint(roof.cellGround, ctx.color.nonGround, v) });
    t.say(
      "Near the sensor, elevation is a sharp discriminator. Far away it stops being one — a high patch might just be a hill — so past <em>17 m</em> the test is switched off and uprightness decides alone.",
      5.2,
    );

    // ---- Test 3: flatness, on the good cell.
    t.add(2.8, ctx.rig.flyTo(ctx.binPose(good, { distance: 8.5, height: 4.2 })), Ease.cinematic);
    t.add(1.0, {
      onEnter: () => {
        cells.good.nLabel.text = `n<sub>z</sub> = ${good.gle!.uprightness.toFixed(4)}`;
        ctx.readout("All three tests", [
          { label: "uprightness", value: good.gle!.uprightness.toFixed(4), state: "pass" },
          { label: "elevation", value: `${fmt(good.gle!.elevation)} m`, state: "pass" },
          { label: "flatness λ₃", value: good.gle!.flatness.toExponential(2), state: "pass" },
          { label: "verdict", value: "GROUND", state: "pass" },
        ]);
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
      "The third test is a rescue, not a rejection. A steep but genuinely smooth slope fails elevation — yet it is obviously a surface.",
      4.6,
    );

    t.say(
      `So flatness gets a vote: <em>λ₃</em>, the smallest eigenvalue, is the plane's physical thickness. Here it is ${good.gle!.flatness.toExponential(
        2,
      )} m² — a few millimetres of road texture.`,
      5.0,
    );

    t.say(
      "Patchwork used a <em>ratio</em> of eigenvalues here. Patchwork++ dropped that: because CZM cells differ in size and shape, the ratio moved even when the ground did not. Raw λ₃ means the same thing everywhere.",
      5.6,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
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
  subtitle: "Everything so far, applied to the whole sweep — ring by ring, outward from the car.",

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

    t.say(
      "That whole procedure — seed, peel, fit, judge — now runs in every cell, ring by ring, working outward.",
      3.0,
    ).with(
      2.6,
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
      "The cell itself is the unit of work — 504 independent little problems, each small enough that the flat-world assumption actually holds.",
      4.4,
    );
    t.say(
      "Notice what is <em>not</em> here: no training data, no per-scene tuning, and no random sampling anywhere.",
      4.0,
    );

    t.at(Math.max(t.time, 2.6 + ringOrder.length * perRing + 0.4));
    t.add(1.2, {
      onEnter: () =>
        ctx.readout("This scan", [
          { label: "ground", value: frame.groundCount.toLocaleString(), state: "pass" },
          { label: "not ground", value: frame.nonGroundCount.toLocaleString() },
          { label: "undecided", value: candidateIdx.length.toLocaleString(), state: "fail" },
          { label: "compute", value: `${frame.elapsedMs.toFixed(0)} ms` },
        ]),
    });
    t.say(
      `Almost everything is decided. Almost — the amber points sit in cells GLE could not call either way. On this scan there is exactly <em>one such cell</em>.`,
      4.4,
    );

    t.add(3.0, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.4, {
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
  subtitle:
    "The borderline cells get one more hearing — judged against the other cells in their own ring, right now.",

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
      `λ₃ = ${hero.gle!.flatness.toExponential(2)}`,
      ctx.centreOf(hero, hero.gle!.elevation + 1.0),
      "warn",
    );
    heroLabel.opacity = 0;

    const t = ctx.track();

    t.say(
      `Here is one of them: a small patch ${hero.radii[0].toFixed(
        1,
      )} m out, sitting <em>above</em> the elevation threshold and not flat enough to be rescued.`,
      3.4,
    )
      .with(2.8, ctx.rig.flyTo(ctx.binPose(hero, { distance: 10, height: 5 })), Ease.cinematic)
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
      "The thresholds it failed were learned from <em>hundreds</em> of past frames. A patch of gravel or grass that is rough <em>today</em> will always lose that argument.",
      5.0,
    );

    t.add(1.4, {
      onEnter: () =>
        ctx.readout("This ring, this frame", [
          { label: "definite ground", value: String(ring.flatnessSamples.length) },
          { label: "mean λ₃", value: hero.tgr!.ringMean.toExponential(2) },
          { label: "µ = mean + 1.5σ", value: hero.tgr!.mu.toExponential(2) },
        ]),
      onUpdate: (v) => {
        for (const c of peerCells) c.opacity = v * 0.3;
      },
    });
    t.say(
      `So TGR asks a different question: how flat are the cells in <em>this ring, in this scan</em>? These ${ring.flatnessSamples.length} are the ones GLE was confident about.`,
      5.0,
    );

    const verdict = hero.tgr!;
    t.add(1.4, {
      onEnter: () => {
        ctx.readout("TGR verdict", [
          { label: "λ₃", value: hero.gle!.flatness.toExponential(2) },
          { label: "µ", value: verdict.mu.toExponential(2) },
          { label: "p(flat)", value: verdict.probFlatness.toFixed(3), state: "pass" },
          {
            label: "λ₁/λ₂",
            value: `${hero.gle!.lineVariable.toFixed(1)} ≤ 8`,
            state: "pass",
          },
          {
            label: "verdict",
            value: verdict.reverted ? "REVERT" : "REJECT",
            state: verdict.reverted ? "pass" : "fail",
          },
        ]);
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
    t.say(
      `Against its own neighbours it is <em>not</em> rough — λ₃ = ${hero.gle!.flatness.toExponential(
        2,
      )} against µ = ${verdict.mu.toExponential(2)}. Reverted to ground.`,
      4.6,
    );

    t.say(
      "One more guard before it counts: <em>λ₁/λ₂</em>. A guardrail seen edge-on is thin too — but it is a <em>line</em>, not a surface, and a ratio above 8 vetoes the revert.",
      5.2,
    );

    t.say(
      "Across SemanticKITTI this buys about <em>+0.5% recall</em> for a rounding error of precision. It is the difference between 'nearly always works' and 'no partial failures'.",
      5.0,
    );

    t.add(3.2, ctx.rig.flyTo(ctx.overview), Ease.cinematic).with(1.8, {
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
