# Candidate coloured scenes (KITTI-360)

Four real frames from [KITTI-360](https://www.cvlibs.net/datasets/kitti-360/), fetched
directly from its own open S3 bucket — the Velodyne HDL-64E scan, all four camera frames
that rode alongside it, and the vehicle's own calibration.

KITTI-360 carries two forward perspective cameras plus two sideways fisheye cameras
(~185° each, one facing left and one right). The fisheye pair overlaps in front of and
behind the car, so between all four lenses a ground-level lidar sweep typically gets
covered *completely* — unlike the single forward dash-cam in `data/raw/scenes/` (the
original KITTI odometry candidates, now superseded), which only ever sees the ~15-20%
of a sweep in front of it. `scripts/colorize-scenes-360.ts` does the projection: pinhole
for the two perspective cameras, the MEI omnidirectional model for the two fisheye ones.

Picked the same way as before — scoring every available frame in nine KITTI-360
sequences for local road grade and heading change over a ~30-sample window — then
eyeballing the front camera to skip anything where the road itself isn't actually
visible (thick hedges, etc).

| id          | sequence / frame | grade | curve | what's in shot                            |
| ----------- | ----------------- | ----- | ----- | ------------------------------------------ |
| `02-011000` | 0002 / 11000       | 7.2%  | 143°  | a hillside road curving past a junction     |
| `02-016139` | 0002 / 16139       | 8.2%  | 122°  | a row of garages, a red car parked outside  |
| `09-008242` | 0009 / 8242        | 1.1%  | 135°  | a tree-lined street, vans and cars parked   |
| `06-003489` | 0006 / 3489        | 2.7%  | 128°  | a house and garden behind a low hedge       |

**Format**, per scene folder:

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
