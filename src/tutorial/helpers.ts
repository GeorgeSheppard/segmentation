import { fitPlane, planeDistance, type PlaneFit } from "../core/linalg.ts";
import { cloneParams, type CzmGeometry, type Params, type PointCloud } from "../patchwork/index.ts";

/**
 * Cache a derivation by object identity. A stage's `build()` reruns on every rebuild — a
 * fresh load, Replay, or a backward seek — but `frame` (the algorithm's already-computed
 * trace) never changes for the app's lifetime, so anything a stage derives purely from it
 * only needs computing once rather than on every rebuild.
 */
export function memoize<K extends object, V>(compute: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key: K) => {
    let v = cache.get(key);
    if (v === undefined) {
      v = compute(key);
      cache.set(key, v);
    }
    return v;
  };
}

/**
 * The naive baseline: Zermas' GPF run over the whole cloud as a single segment.
 *
 * This is exactly the "fit one plane to everything" strawman — the same seed selection and
 * the same three PCA refinements Patchwork++ runs per bin, just without the bins.
 */
export function fitGlobalPlane(
  cloud: PointCloud,
  params: Params,
): { plane: PlaneFit; ground: Int32Array; nonGround: Int32Array } {
  const { xyz, count } = cloud;
  const order = new Int32Array(count);
  for (let i = 0; i < count; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => xyz[a * 3 + 2] - xyz[b * 3 + 2]);

  // Skip the handful of points below any plausible road, then take the LPR of the next 250.
  let start = 0;
  const floor = -params.sensorHeight * 1.8;
  while (start < sorted.length && xyz[sorted[start] * 3 + 2] < floor) start++;

  const nLPR = 250;
  let sum = 0;
  let n = 0;
  for (let i = start; i < sorted.length && n < nLPR; i++, n++) sum += xyz[sorted[i] * 3 + 2];
  const cutoff = (n ? sum / n : 0) + 0.4;

  let seeds: number[] = [];
  for (const i of sorted) {
    if (xyz[i * 3 + 2] < cutoff) seeds.push(i);
    else break;
  }

  let plane = fitPlane(xyz, seeds, seeds.length)!;
  let ground: number[] = seeds;
  for (let it = 0; it < 3; it++) {
    ground = [];
    for (let i = 0; i < count; i++) {
      if (Math.abs(planeDistance(xyz, i, plane.normal, plane.d)) < 0.25) ground.push(i);
    }
    const refit = fitPlane(xyz, ground, ground.length);
    if (!refit) break;
    plane = refit;
  }

  const isGround = new Uint8Array(count);
  for (const i of ground) isGround[i] = 1;
  const nonGround: number[] = [];
  for (let i = 0; i < count; i++) if (!isGround[i]) nonGround.push(i);

  return { plane, ground: Int32Array.from(ground), nonGround: Int32Array.from(nonGround) };
}

/**
 * A uniform polar grid with the same coverage as the CZM, for the side-by-side in the CZM
 * stage. Shaped as a CzmGeometry/Params pair so it can reuse the same grid renderer.
 */
export function uniformGrid(
  params: Params,
  rings = 45,
  sectors = 72,
): { czm: CzmGeometry; params: Params } {
  const p = cloneParams(params);
  p.numZones = 1;
  p.numRingsEachZone = [rings];
  p.numSectorsEachZone = [sectors];

  const czm: CzmGeometry = {
    minRanges: [params.minRange],
    maxRanges: [params.maxRange],
    ringSizes: [(params.maxRange - params.minRange) / rings],
    sectorSizes: [(2 * Math.PI) / sectors],
    numBins: rings * sectors,
    concentricIndex: (_z, r) => r,
  };
  return { czm, params: p };
}

/** Indices of `pool`, ordered by distance from the sensor — for ripple-outward reveals. */
export function orderByRange(xyz: Float32Array, pool: ArrayLike<number>): Int32Array {
  const arr = Array.from({ length: pool.length }, (_, k) => pool[k]);
  arr.sort(
    (a, b) => Math.hypot(xyz[a * 3], xyz[a * 3 + 1]) - Math.hypot(xyz[b * 3], xyz[b * 3 + 1]),
  );
  return Int32Array.from(arr);
}

/** All point indices carrying any of the given labels. */
export function indicesWithLabels(labels: Uint8Array, wanted: number[]): Int32Array {
  const set = new Set(wanted);
  const out: number[] = [];
  for (let i = 0; i < labels.length; i++) if (set.has(labels[i])) out.push(i);
  return Int32Array.from(out);
}

/**
 * A patch's thickness, in millimetres.
 *
 * The algorithm carries flatness as a variance along the surface normal (m²). Its square
 * root is the spread of the points either side of the plane, which is a length a reader can
 * picture — 28 mm of road texture against 140 mm of car roof.
 */
export function thickness(flatness: number): string {
  return `${(Math.sqrt(Math.max(flatness, 0)) * 1000).toFixed(0)} mm`;
}

/**
 * Which way a fitted plane leans, in plain words.
 *
 * The algorithm carries this as `n_z` — the vertical component of the plane's unit normal,
 * i.e. the cosine of how far it leans from pointing straight up. Read as raw decimal
 * ("facing up 0.98") it means nothing without doing trigonometry in your head; converted to
 * a tilt angle, it is the same number a reader would reach for unprompted — "tilted 8°".
 */
export function facingLabel(uprightVector: number): string {
  const deg = (Math.acos(Math.max(-1, Math.min(1, uprightVector))) * 180) / Math.PI;
  if (deg < 3) return "dead flat";
  return `tilted ${deg.toFixed(0)}°`;
}

export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "—";
  if (v !== 0 && Math.abs(v) < 1e-2) return v.toExponential(1);
  return v.toFixed(digits);
}
