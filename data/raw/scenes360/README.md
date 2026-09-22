# The tutorial's scan (KITTI-360)

`02-010880` — sequence 02, frame 10880 — is the real frame the tutorial runs on: a
residential street with a steep grade, fetched directly from
[KITTI-360](https://www.cvlibs.net/datasets/kitti-360/)'s own open S3 bucket. The folder
holds the Velodyne HDL-64E scan, all four camera frames that rode alongside it, and the
vehicle's own calibration.

KITTI-360 carries two forward perspective cameras plus two sideways fisheye cameras
(~185° each, one facing left and one right). The fisheye pair overlaps in front of and
behind the car, so between all four lenses a ground-level lidar sweep typically gets
covered *completely* — unlike a single forward dash-cam, which only ever sees the
~15-20% of a sweep in front of it. `scripts/colorize-scenes-360.ts` does the projection:
pinhole for the two perspective cameras, the MEI omnidirectional model for the two
fisheye ones.

Picked by scoring every available frame in nine KITTI-360 sequences for local road grade
and heading change, shortlisting the curviest, then checking each shortlisted frame
still has two things a flat, straight demo frame wouldn't need to: real reflected noise
(for the RNR stage) and a real cell where the ground sits on a structure close enough to
the sensor for R-VPF to peel it — neither is guaranteed just because a road curves.
`scripts/dump-cells.ts` is what made that check fast: it runs the segmentation pipeline
headlessly against a `.pcq` and reports every cell that actually exhibits one of the
tutorial's teaching moments.

**Format**:

- `velodyne.bin` — raw little-endian `float32`, four values per point (`x, y, z,
  intensity`), sensor frame: x forward, y left, z up. Identical layout to `data/raw/*.bin`.
- `image_00.png` / `image_01.png` — the two rectified forward perspective cameras.
- `image_02.png` / `image_03.png` — the two raw fisheye cameras (left/right facing).

`calib/` (shared across every scene — KITTI-360 calibrates the whole vehicle rig once,
not per frame):

- `perspective.txt` — intrinsics/extrinsics/rectification for `image_00` and `image_01`.
- `image_02.yaml` / `image_03.yaml` — the MEI omnidirectional model parameters for each
  fisheye lens.
- `calib_cam_to_pose.txt` — each camera's pose in the vehicle's common body frame.
- `calib_cam_to_velo.txt` — camera 0's pose relative to the Velodyne.

KITTI-360 is published under CC BY-NC-SA 3.0 by the same group as KITTI odometry. Cite
Liao, Xie & Geiger, _"KITTI-360: A Novel Dataset and Benchmarks for Urban Scene
Understanding in 2D and 3D"_, PAMI 2022.
