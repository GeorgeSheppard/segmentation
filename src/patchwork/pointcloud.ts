/** A LiDAR sweep in the sensor frame: x forward, y left, z up, sensor at the origin. */
export interface PointCloud {
  /** Interleaved xyz, length = 3 * count. */
  xyz: Float32Array;
  /** Return intensity in [0, 1], one per point. */
  intensity: Float32Array;
  count: number;
  /**
   * Real camera colour, where the scene has it — interleaved RGB in [0, 1], length
   * 3 * count. Only the cone the camera actually saw is populated; `colorMask` says which.
   * Undefined entirely for scans with no camera to draw from.
   */
  color?: Float32Array;
  /** 1 where `color` is a real sampled pixel, 0 where the point is outside the camera's view. */
  colorMask?: Uint8Array;
}
