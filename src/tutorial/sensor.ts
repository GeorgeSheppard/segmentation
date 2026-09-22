import { Vector3 } from "three";
import { Ease } from "../anim/timeline.ts";
import { pose } from "../viz/viewer.ts";
import { type Stage, type StageContext } from "./context.ts";

/**
 * Step 1 — where the points come from.
 *
 * Every later stage treats the scan as a given. It is not: it is ~120,000 time-of-flight
 * measurements taken by a head that turns ten times a second, and the shape
 * of the scan — dense near the car, sparse far out, polar rather than gridded — is the
 * reason the rest of the algorithm looks the way it does. So the scan is built on screen
 * the way the sensor builds it: one pulse, then a fan, then a turn.
 */

/** Azimuth buckets the turn is quantised into — one per degree. */
const BUCKETS = 360;
/** Beams drawn at once. Sixteen of the sixty-four: enough to read as a fan, not a wall. */
const BEAMS = 16;

/** Vertical field of view of an HDL-64E — +2° down to -24.8°, with a degree of slack. */
const ELEV_MAX = (3 * Math.PI) / 180;
const ELEV_MIN = (-26 * Math.PI) / 180;

const ORIGIN = new Vector3(0, 0, 0);

export const stageSensor: Stage = {
  id: "sensor",
  title: "How the scan is made",
  subtitle: "A pulse, a reflection, and the time between them — over a million times a second.",

  build(ctx: StageContext) {
    const { cloud, frame } = ctx;
    const { xyz, count } = frame.cloud;
    const sweep = bucketByAzimuth(xyz, count);

    // Nothing has been measured yet: the points are loaded, but invisible until a beam
    // reaches them.
    cloud.setBaseRaw(ctx.color.raw, 0);

    const head = ctx.sensorHead();
    const beams = Array.from({ length: BEAMS }, () => ctx.segment(ctx.color.plane, 0));
    const echo = ctx.segment(ctx.color.seed, 0);

    // The first pulse gets a real return to land on: something ahead of the car, far
    // enough away that the round trip is worth talking about.
    const hero = heroReturn(sweep, xyz);
    const heroPoint = new Vector3(xyz[hero * 3], xyz[hero * 3 + 1], xyz[hero * 3 + 2]);
    const heroRange = heroPoint.length();
    const heroDir = heroPoint.clone().normalize();

    // Both close-ups watch from the side, at a distance scaled off the hero ray rather
    // than hard-coded, so the shot holds whichever return this scan happens to offer. The
    // fan beat stays near the head on purpose: what it has to show is the *spread* of the
    // beams, and the long ones are free to run off the edge of the frame.
    //
    // The camera looks at the ray's midpoint, so each endpoint (the head, the hero return)
    // sits at roughly half the ray's length off-axis. At the raw out/up offsets that angle
    // is close enough to the vertical FOV's edge that a phone's narrower frame — which gets
    // only some of that back by widening the FOV — clips an endpoint out of frame entirely.
    // Pulling the camera back a third further costs some of the close-up's tightness but
    // keeps both ends on screen everywhere.
    const REACH = 1.35;
    const side = new Vector3(-heroDir.y, heroDir.x, 0).normalize();
    const alongRay = (lead: number, out: number, up: number) => {
      const target = heroDir.clone().multiplyScalar(heroRange * lead);
      return {
        position: target
          .clone()
          .addScaledVector(side, heroRange * out * REACH)
          .add(new Vector3(0, 0, heroRange * up * REACH)),
        target,
      };
    };

    /** Point the fan at one azimuth bucket, `on` of its beams lit. */
    const aimFan = (bucket: number, on: number, opacity: number) => {
      const fan = sweep.fans[bucket];
      for (let k = 0; k < BEAMS; k++) {
        const i = k < on ? fan[k] : -1;
        if (i < 0) {
          beams[k].opacity = 0;
          continue;
        }
        beams[k].set(ORIGIN, new Vector3(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]));
        beams[k].opacity = opacity;
        // A lit beam has, by definition, already measured whatever it ends on.
        cloud.setAlpha([i], 1);
      }
    };

    // Revealing is a prefix of the turn, so it only ever walks forward — except when the
    // clock is rewound by a replay, which rebuilds the stage anyway.
    let revealed = 0;
    const revealTo = (bucket: number) => {
      for (; revealed <= Math.min(bucket, BUCKETS - 1); revealed++) {
        cloud.setAlpha(sweep.buckets[revealed], 1);
      }
    };

    const t = ctx.track();

    t.say(
      `<em>${count.toLocaleString()} points</em>, ten times a second, from a <em>Velodyne HDL-64E</em> spinning on the car roof.`,
      3.4,
    )
      .with(2.6, ctx.rig.flyTo(pose([-3.4, -2.9, 1.6], [0.5, 0.1, -0.2])), Ease.cinematic)
      .with(1.2, { onUpdate: (v) => (head.opacity = v) });

    // ---- one pulse, out and back
    t.say("One laser fires a pulse of infrared light.", 1.8)
      .with(1.8, ctx.rig.flyTo(alongRay(0.5, 0.95, 0.3)), Ease.cinematic)
      .with(1.4, {
        onUpdate: (v) => {
          beams[0].set(ORIGIN, heroPoint.clone().multiplyScalar(v));
          beams[0].opacity = 1;
        },
      });

    t.say("It hits a surface, scatters, and a little of it comes back.", 2.4).with(1.8, {
      onUpdate: (v) => {
        // A short bright packet running back down the ray it went out on.
        const front = 1 - v;
        const back = Math.min(1, front + 0.18);
        echo.set(
          heroDir.clone().multiplyScalar(heroRange * front),
          heroDir.clone().multiplyScalar(heroRange * back),
        );
        echo.opacity = 1;
        beams[0].opacity = 1 - 0.75 * v;
      },
      onExit: () => {
        echo.opacity = 0;
      },
    });

    t.say(
      `Time the round trip, halve it, multiply by the speed of light: <em>${heroRange.toFixed(1)} m</em>. Range plus direction gives <em>one point</em>.`,
      3.6,
    ).with(1.2, {
      onUpdate: (v) => {
        cloud.setAlpha([hero], v);
        cloud.setSize([hero], 1 + 5 * v);
      },
    });

    // ---- the vertical fan
    t.say(
      "<em>64 lasers</em>, stacked in a fan, each aimed at its own angle. One pulse measures a whole vertical slice.",
      3.6,
    )
      .with(2.2, ctx.rig.flyTo(alongRay(0.5, 1.1, 0.15)), Ease.cinematic)
      .with(1.6, {
        onUpdate: (v) => {
          aimFan(0, Math.ceil(v * BEAMS), 0.85);
        },
        onExit: () => {
          cloud.setSize([hero], 1);
          revealTo(0);
        },
      });

    // ---- the turn
    t.say("Then the head spins. <em>Ten full turns a second</em>, each one a new scan.", 3.2);

    t.add(
      7.0,
      {
        onUpdate: (v) => {
          const angle = v * Math.PI * 2;
          const bucket = Math.min(BUCKETS - 1, Math.floor(v * BUCKETS));
          head.spin = angle;
          aimFan(bucket, BEAMS, 0.85);
          revealTo(bucket);
        },
        onExit: () => {
          revealTo(BUCKETS - 1);
          cloud.captureBase();
        },
      },
      Ease.inOut,
    ).with(7.0, ctx.rig.flyTo(pose([-48, -42, 36], [6, -1, -1.6])), Ease.cinematic);

    t.say(
      "Near the car the rings are packed tight. Farther out, the same 64 lasers are spread over a much bigger circle.",
      3.6,
    ).with(1.2, {
      onUpdate: (v) => {
        for (const b of beams) b.opacity = 0.85 * (1 - v);
        head.opacity = 1 - v * 0.4;
      },
    });

    t.say(
      "That is the whole input: ranges and directions. No colour, no classes, no idea which of it is road.",
      3.0,
    ).with(2.8, ctx.rig.flyTo(ctx.overview), Ease.cinematic);

    return t.build();
  },
};

interface Sweep {
  /** Point indices per azimuth bucket, in sweep order. */
  buckets: Int32Array[];
  /** Up to BEAMS representative returns per bucket, top of the fan to the bottom. */
  fans: Int32Array[];
}

/**
 * Sort the scan into azimuth buckets, and pick a fan of returns for each.
 *
 * One pass. Within a bucket the fan is chosen by elevation slot rather than by ring index
 * — the scan carries no ring numbers — and the longest return in each slot wins, because a
 * beam that reaches a wall reads better than one that dies on the tarmac two metres out.
 */
function bucketByAzimuth(xyz: Float32Array, count: number): Sweep {
  const lists: number[][] = Array.from({ length: BUCKETS }, () => []);
  const fanIndex = new Int32Array(BUCKETS * BEAMS).fill(-1);
  const fanRange = new Float32Array(BUCKETS * BEAMS);
  const span = ELEV_MAX - ELEV_MIN;

  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3];
    const y = xyz[i * 3 + 1];
    const z = xyz[i * 3 + 2];
    const flat = Math.hypot(x, y);

    const turn = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2);
    const bucket = Math.min(BUCKETS - 1, Math.floor((turn / (Math.PI * 2)) * BUCKETS));
    lists[bucket].push(i);

    // Returns from inside the car's own footprint make for beams that go nowhere.
    if (flat < 2) continue;
    const slot = Math.floor(((Math.atan2(z, flat) - ELEV_MIN) / span) * BEAMS);
    if (slot < 0 || slot >= BEAMS) continue;
    const o = bucket * BEAMS + (BEAMS - 1 - slot);
    const range = Math.hypot(flat, z);
    if (range > fanRange[o]) {
      fanRange[o] = range;
      fanIndex[o] = i;
    }
  }

  return {
    buckets: lists.map((l) => Int32Array.from(l)),
    fans: Array.from({ length: BUCKETS }, (_, b) => fanIndex.slice(b * BEAMS, (b + 1) * BEAMS)),
  };
}

/**
 * A return to fire the first pulse at.
 *
 * It has to be roughly straight ahead, so the beam flies down the x axis and the camera
 * can watch it side-on; it has to stand above the road, so it reads as a *thing* the pulse
 * hit rather than tarmac; and it has to be around fifteen metres out, because the whole
 * ray plus the sensor has to fit in one shot with the head still big enough to see.
 */
function heroReturn(sweep: Sweep, xyz: Float32Array): number {
  let best = -1;
  let bestScore = Infinity;
  for (let d = -8; d <= 8; d++) {
    for (const i of sweep.fans[(d + BUCKETS) % BUCKETS]) {
      if (i < 0) continue;
      const range = Math.hypot(xyz[i * 3], xyz[i * 3 + 1], xyz[i * 3 + 2]);
      if (range < 7 || range > 26) continue;
      const score = Math.abs(range - 15) + (xyz[i * 3 + 2] < -1.2 ? 25 : 0) + Math.abs(d) * 0.3;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
  }
  return best >= 0 ? best : (sweep.fans[0].find((i) => i >= 0) ?? sweep.buckets[0][0]);
}
