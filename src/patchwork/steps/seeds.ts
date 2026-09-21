import type { Params } from "../params.ts";

/**
 * Step: seed selection (GPF's Lowest Point Representative).
 *
 * The single assumption the whole algorithm rests on: the lowest points in a cell are
 * probably ground. Average the lowest `numLPR` of them, then take everything within
 * `thSeed` above that average as the seed set for a plane fit.
 *
 * Deterministic — no random sampling — which is what makes running this 500 times per
 * scan affordable.
 */
export interface SeedSelection {
  /** Mean z of the LPR points. */
  lprHeight: number;
  /** The seed cutoff, `lprHeight + thSeed`. */
  cutoff: number;
  /**
   * Seeds are the FIRST `count` entries of the sorted input. Because the input is sorted
   * ascending by z and the test is `z < cutoff`, the seed set is always a prefix — which
   * is also what lets the visualisation show it without storing a second index list.
   */
  count: number;
  /** Where LPR averaging started; non-zero only when adaptive seed selection skipped points. */
  lprStart: number;
}

/**
 * @param sorted point indices, ascending in z
 * @param zone   CZM zone; adaptive seed selection only applies in zone 0
 */
export function selectSeeds(
  xyz: Float32Array,
  sorted: readonly number[],
  zone: number,
  thSeed: number,
  params: Params,
  sensorHeight: number,
): SeedSelection {
  // Adaptive initial seed selection (Patchwork): in the central zone, skip points far below
  // any plausible road so that a reflection cannot drag the LPR down with it. RNR is the
  // more surgical version of the same idea; the reference keeps both.
  let lprStart = 0;
  if (zone === 0) {
    const floor = params.adaptiveSeedSelectionMargin * sensorHeight;
    while (lprStart < sorted.length && xyz[sorted[lprStart] * 3 + 2] < floor) lprStart++;
  }

  let sum = 0;
  let n = 0;
  for (let i = lprStart; i < sorted.length && n < params.numLPR; i++) {
    sum += xyz[sorted[i] * 3 + 2];
    n++;
  }
  const lprHeight = n !== 0 ? sum / n : 0;
  const cutoff = lprHeight + thSeed;

  // Counted from the very start of the sorted list: the reference does not exclude the
  // points skipped above from the seed set itself, only from the LPR average.
  let count = 0;
  while (count < sorted.length && xyz[sorted[count] * 3 + 2] < cutoff) count++;

  return { lprHeight, cutoff, count, lprStart };
}
