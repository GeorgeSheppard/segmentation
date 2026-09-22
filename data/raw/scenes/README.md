# Candidate coloured scenes

Four single frames from the [KITTI odometry benchmark](https://www.cvlibs.net/datasets/kitti/eval_odometry.php),
fetched directly from KITTI's own S3 bucket (`data_odometry_velodyne.zip`,
`data_odometry_color.zip`, `data_odometry_calib.zip`) — the real Velodyne HDL-64E scan, the
matching `image_2` (left colour camera) frame, and that sequence's calibration, not
redistributed demo data. Picked by scoring every frame in sequences 00–10 (the ones with
released ground-truth poses) for local road grade and heading change over a ~15-frame
window, favouring a mix of slope and curve over the dead-flat, dead-straight frame the
tutorial ships today:

| id          | sequence / frame | grade | curve | what's in shot                                 |
| ----------- | ---------------- | ----- | ----- | ---------------------------------------------- |
| `00-003433` | 00 / 3433        | 7.2%  | 44.8° | residential street bending past a corner house |
| `02-003406` | 02 / 3406        | 7.5%  | 48.6° | a walled junction with autumn hedgerow         |
| `09-000297` | 09 / 297         | 12.2% | 17.7° | a visibly cresting, curving suburban road      |
| `10-000865` | 10 / 865         | 10.1% | 58.6° | a tight bend between apartment buildings       |

**Format**, per scene folder:

- `velodyne.bin` — raw little-endian `float32`, four values per point (`x, y, z, intensity`),
  sensor frame: x forward, y left, z up. Identical layout to `data/raw/*.bin`.
- `image_2.png` — the left colour camera frame for the same index, used to project real
  colour onto the points a camera could see; `scripts/colorize-scenes.ts` is what does it.
- `calib.txt` — that sequence's `P0`–`P3` projection matrices and `Tr` (Velodyne → camera 0),
  in KITTI odometry's own format.

KITTI is published under CC BY-NC-SA 3.0. Cite Geiger et al., _"Are we ready for Autonomous
Driving? The KITTI Vision Benchmark Suite"_, CVPR 2012.
