/** A LiDAR sweep in the sensor frame: x forward, y left, z up, sensor at the origin. */
export interface PointCloud {
  /** Interleaved xyz, length = 3 * count. */
  xyz: Float32Array;
  /** Return intensity in [0, 1], one per point. */
  intensity: Float32Array;
  count: number;
}
