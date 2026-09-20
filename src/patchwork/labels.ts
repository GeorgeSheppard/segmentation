/**
 * Why a point ended up where it did — the pipeline's per-point output.
 *
 * A const object rather than a TS `enum` so the module stays erasable (and so the values
 * can be iterated for the legend).
 */
export const PointLabel = {
  /** Never assigned — should not happen; painted magenta so bugs are loud. */
  Unassigned: 0,
  /** Removed by Reflected Noise Removal. */
  Noise: 1,
  /** Outside [minRange, maxRange]. */
  OutOfRange: 2,
  /** In a cell with fewer than numMinPts points. */
  SparseCell: 3,
  /** Peeled off by Region-wise Vertical Plane Fitting. */
  VerticalPlane: 4,
  /** Inside a cell but further than thDist above its ground plane. */
  AbovePlane: 5,
  /** Its cell's plane failed the uprightness test. */
  RejectedTilted: 6,
  /** Its cell's plane sits above the sensor origin (car roof / bonnet). */
  RejectedHeading: 7,
  /** A TGR candidate that TGR finally rejected. */
  RejectedCandidate: 8,
  /** Accepted as ground by the elevation or flatness test. */
  Ground: 9,
  /** Accepted as ground on uprightness alone, beyond the rings of interest. */
  GroundFar: 10,
  /** Accepted as ground by Temporal Ground Revert. */
  GroundReverted: 11,
} as const;

export type PointLabel = (typeof PointLabel)[keyof typeof PointLabel];

export function isGroundLabel(label: PointLabel): boolean {
  return (
    label === PointLabel.Ground ||
    label === PointLabel.GroundFar ||
    label === PointLabel.GroundReverted
  );
}

/** Write `label` at every index in `indices`. */
export function paintLabels(
  labels: Uint8Array,
  indices: ArrayLike<number>,
  label: PointLabel,
): void {
  for (let i = 0; i < indices.length; i++) labels[indices[i]] = label;
}
