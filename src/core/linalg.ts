/** Minimal linear algebra for the plane fits. Everything is allocation-free on the hot path. */

export type Vec3 = [number, number, number];

/** Symmetric 3x3 matrix, packed as [xx, yy, zz, xy, xz, yz]. */
export type Sym3 = Float64Array;

export interface PlaneFit {
  /** Unit normal, always oriented so that nz >= 0. */
  normal: Vec3;
  /** Plane offset: n . p + d = 0, i.e. d = -n . mean. */
  d: number;
  /** Centroid of the fitted point set. */
  mean: Vec3;
  /** Eigenvalues of the covariance, DESCENDING: [l1, l2, l3]. l3 is the plane thickness. */
  eigenvalues: Vec3;
}

/**
 * Eigen-decomposition of a real symmetric 3x3 matrix by the closed-form trigonometric
 * method (Smith 1961), with a robust orthonormal completion for the eigenvectors.
 *
 * The matrix is normalised by its largest entry first, so every tolerance below is
 * scale-free — LiDAR bin covariances have entries spanning many orders of magnitude
 * (a flat patch's smallest eigenvalue is ~1e-4 m^2, its largest ~10 m^2).
 *
 * Returns eigenvalues ASCENDING with their unit eigenvectors as a right-handed basis,
 * matching Eigen's `SelfAdjointEigenSolver::computeDirect` used by the reference C++.
 */
export function eigenSym3(m: Sym3): { values: Vec3; vectors: [Vec3, Vec3, Vec3] } {
  let maxAbs = 0;
  for (let i = 0; i < 6; i++) maxAbs = Math.max(maxAbs, Math.abs(m[i]));
  if (maxAbs === 0) {
    return {
      values: [0, 0, 0],
      vectors: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    };
  }

  const s = 1 / maxAbs;
  const a = new Float64Array(6);
  for (let i = 0; i < 6; i++) a[i] = m[i] * s;
  const xx = a[0],
    yy = a[1],
    zz = a[2],
    xy = a[3],
    xz = a[4],
    yz = a[5];

  // Eigenvalues of the normalised matrix.
  let values: Vec3;
  const offDiag = xy * xy + xz * xz + yz * yz;
  if (offDiag < 1e-30) {
    values = [xx, yy, zz].sort((p, q) => p - q) as unknown as Vec3;
  } else {
    const q = (xx + yy + zz) / 3;
    const dxx = xx - q,
      dyy = yy - q,
      dzz = zz - q;
    const p2 = dxx * dxx + dyy * dyy + dzz * dzz + 2 * offDiag;
    const p = Math.sqrt(p2 / 6);
    const inv = 1 / p;
    const bxx = dxx * inv,
      byy = dyy * inv,
      bzz = dzz * inv;
    const bxy = xy * inv,
      bxz = xz * inv,
      byz = yz * inv;
    const detB =
      bxx * (byy * bzz - byz * byz) - bxy * (bxy * bzz - byz * bxz) + bxz * (bxy * byz - byy * bxz);
    const phi = Math.acos(Math.max(-1, Math.min(1, detB / 2))) / 3;
    const hi = q + 2 * p * Math.cos(phi);
    const lo = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
    values = [lo, 3 * q - lo - hi, hi];
  }

  // Eigenvectors: solve for the null spaces, then force an orthonormal right-handed basis.
  const v0 = eigenvectorFor(a, values[0]);
  const v2raw = eigenvectorFor(a, values[2]);

  let v1: Vec3;
  let v2: Vec3;
  const c = cross(v2raw, v0);
  if (dot(c, c) < 1e-12) {
    // Repeated eigenvalue (or an isotropic matrix): any complement of v0 will do.
    [v1, v2] = orthonormalComplement(v0);
  } else {
    v1 = normalize(c);
    v2 = normalize(cross(v0, v1));
  }

  return {
    values: [values[0] * maxAbs, values[1] * maxAbs, values[2] * maxAbs],
    vectors: [v0, v1, v2],
  };
}

/**
 * Unit vector spanning the null space of (m - lambda I), for a normalised `m`.
 *
 * Normally the null space is the cross product of two independent rows. When
 * (m - lambda I) drops to rank 1 (a repeated eigenvalue) every such cross product
 * vanishes, and any vector orthogonal to the surviving row is an eigenvector.
 */
function eigenvectorFor(m: Sym3, lambda: number): Vec3 {
  const [xx, yy, zz, xy, xz, yz] = m as unknown as number[];
  const r0: Vec3 = [xx - lambda, xy, xz];
  const r1: Vec3 = [xy, yy - lambda, yz];
  const r2: Vec3 = [xz, yz, zz - lambda];

  let best: Vec3 = [0, 0, 0];
  let bestNorm = 0;
  for (const [a, b] of [
    [r0, r1],
    [r0, r2],
    [r1, r2],
  ] as const) {
    const c = cross(a, b);
    const n = dot(c, c);
    if (n > bestNorm) {
      bestNorm = n;
      best = c;
    }
  }
  // Rows are O(1) after normalisation, so this is a scale-free test for rank < 2.
  if (bestNorm > 1e-12) return normalize(best);

  let row: Vec3 = r0;
  let rowNorm = dot(r0, r0);
  for (const r of [r1, r2]) {
    const n = dot(r, r);
    if (n > rowNorm) {
      rowNorm = n;
      row = r;
    }
  }
  if (rowNorm < 1e-12) return [0, 0, 1]; // m is lambda * I
  return orthonormalComplement(normalize(row))[0];
}

/** Two unit vectors completing `v` into a right-handed orthonormal basis. */
function orthonormalComplement(v: Vec3): [Vec3, Vec3] {
  const ax: Vec3 =
    Math.abs(v[0]) < Math.abs(v[1])
      ? Math.abs(v[0]) < Math.abs(v[2])
        ? [1, 0, 0]
        : [0, 0, 1]
      : Math.abs(v[1]) < Math.abs(v[2])
        ? [0, 1, 0]
        : [0, 0, 1];
  const u1 = normalize(cross(v, ax));
  const u2 = normalize(cross(v, u1));
  return [u1, u2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalize(a: Vec3): Vec3 {
  const n = Math.hypot(a[0], a[1], a[2]);
  if (n < 1e-20) return [0, 0, 1];
  return [a[0] / n, a[1] / n, a[2] / n];
}

/**
 * PCA plane fit over `count` points addressed through `indices` into a flat xyz array.
 *
 * Mirrors `PatchWorkpp::estimate_plane`: single-pass second moments, covariance with the
 * (n-1) denominator, normal = eigenvector of the smallest eigenvalue flipped to nz >= 0.
 * Returns null for fewer than 3 points.
 */
export function fitPlane(
  xyz: Float32Array,
  indices: ArrayLike<number>,
  count: number,
): PlaneFit | null {
  if (count < 3) return null;

  let sx = 0,
    sy = 0,
    sz = 0;
  let sxx = 0,
    syy = 0,
    szz = 0,
    sxy = 0,
    sxz = 0,
    syz = 0;
  for (let i = 0; i < count; i++) {
    const o = indices[i] * 3;
    const x = xyz[o],
      y = xyz[o + 1],
      z = xyz[o + 2];
    sx += x;
    sy += y;
    sz += z;
    sxx += x * x;
    syy += y * y;
    szz += z * z;
    sxy += x * y;
    sxz += x * z;
    syz += y * z;
  }
  const invN = 1 / count;
  const mx = sx * invN,
    my = sy * invN,
    mz = sz * invN;
  const invD = 1 / (count > 1 ? count - 1 : 1);

  const cov = new Float64Array(6);
  cov[0] = (sxx - count * mx * mx) * invD;
  cov[1] = (syy - count * my * my) * invD;
  cov[2] = (szz - count * mz * mz) * invD;
  cov[3] = (sxy - count * mx * my) * invD;
  cov[4] = (sxz - count * mx * mz) * invD;
  cov[5] = (syz - count * my * mz) * invD;

  const { values, vectors } = eigenSym3(cov);
  let normal = vectors[0]; // smallest eigenvalue -> surface normal
  if (normal[2] < 0) normal = [-normal[0], -normal[1], -normal[2]];

  const mean: Vec3 = [mx, my, mz];
  return {
    normal,
    d: -dot(normal, mean),
    mean,
    // descending, clamped: eigenvalues of a covariance are non-negative
    eigenvalues: [Math.max(0, values[2]), Math.max(0, values[1]), Math.max(0, values[0])],
  };
}

/** Signed point-to-plane distance: n . p + d. */
export function planeDistance(xyz: Float32Array, index: number, normal: Vec3, d: number): number {
  const o = index * 3;
  return normal[0] * xyz[o] + normal[1] * xyz[o + 1] + normal[2] * xyz[o + 2] + d;
}

/**
 * Interpolate between two fitted planes.
 *
 * Used by the tutorial so a refit visibly *settles* instead of snapping: the normal is
 * interpolated and renormalised, the offset linearly. `t` is eased by the caller.
 */
export function lerpPlane(
  a: { normal: Vec3; d: number; mean: Vec3 },
  b: { normal: Vec3; d: number; mean: Vec3 },
  t: number,
): { normal: Vec3; d: number; mean: Vec3 } {
  const normal = normalize([
    a.normal[0] + (b.normal[0] - a.normal[0]) * t,
    a.normal[1] + (b.normal[1] - a.normal[1]) * t,
    a.normal[2] + (b.normal[2] - a.normal[2]) * t,
  ]);
  const mean: Vec3 = [
    a.mean[0] + (b.mean[0] - a.mean[0]) * t,
    a.mean[1] + (b.mean[1] - a.mean[1]) * t,
    a.mean[2] + (b.mean[2] - a.mean[2]) * t,
  ];
  return { normal, d: a.d + (b.d - a.d) * t, mean };
}

export function meanStdev(values: ArrayLike<number>): { mean: number; stdev: number } {
  const n = values.length;
  if (n === 0) return { mean: 0, stdev: 0 };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += values[i];
  const mean = sum / n;
  if (n <= 1) return { mean, stdev: 0 };
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const dv = values[i] - mean;
    acc += dv * dv;
  }
  return { mean, stdev: Math.sqrt(acc / (n - 1)) };
}
