# Sample LiDAR scans

`000000.bin` … `000005.bin` are six consecutive Velodyne HDL-64E scans from the
[KITTI](https://www.cvlibs.net/datasets/kitti/) odometry benchmark, redistributed here from the
Patchwork++ reference implementation ([url-kaist/patchwork-plusplus](https://github.com/url-kaist/patchwork-plusplus),
BSD-2-Clause), which ships them as demo data.

**Format:** raw little-endian `float32`, four values per point — `x, y, z, intensity`.
Axes are the sensor frame: **x forward, y left, z up**, with the sensor at the origin
(~1.72 m above the road). `intensity` is in `[0, 1]`.

```
points = bytes / 16
```

KITTI is published under CC BY-NC-SA 3.0. Cite Geiger et al., *"Are we ready for Autonomous
Driving? The KITTI Vision Benchmark Suite"*, CVPR 2012.
