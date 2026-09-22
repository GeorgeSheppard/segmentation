import "./style.css";
import "./compare.css";
import { decodeQuantizedCloud } from "./core/pcq.ts";
import { applyThemeToCss, THEME } from "./viz/themes.ts";
import { CloudView } from "./viz/cloud.ts";
import { Viewer, pose } from "./viz/viewer.ts";

/**
 * A standalone comparison page: real camera colour, candidate KITTI-360 frames, nothing
 * else. It shares the tutorial's Viewer and CloudView so what you see here is exactly what
 * the tutorial would render, but skips the stage/timeline machinery entirely — the point is
 * to look at a scene and decide, not to walk through the algorithm on all of them at once.
 *
 * These are KITTI-360 frames, not the original KITTI odometry ones: KITTI-360's two
 * sideways fisheye cameras plus its two forward perspective cameras between them see
 * essentially the entire lidar sweep, instead of just the ~15-20% a single forward
 * dash-cam can reach. See `scripts/colorize-scenes-360.ts` and
 * `data/raw/scenes360/README.md` for how and why.
 *
 * The first two entries (10925, 11100) aren't new picks — they're the same street as
 * 11000, a little further along, tried because 11000's immediate surroundings turned out
 * too open to demonstrate R-VPF (peeling a wall out from under the ground plane).
 */
interface Scene {
  id: string;
  label: string;
  description: string;
}

const SCENES: Scene[] = [
  {
    id: "02-010925",
    label: "02 / 10925",
    description:
      "Same street, ~75 frames before 11000 — a junction with houses either side. Has a real kerb close to the sensor, unlike 11000.",
  },
  {
    id: "02-011100",
    label: "02 / 11100",
    description:
      "Same street, ~100 frames after 11000 — a tree and hedge-lined stretch. Also has a real kerb close to the sensor.",
  },
  {
    id: "02-011000",
    label: "02 / 11000",
    description:
      "The pick so far — a hillside road curving past a junction. Its near field turned out too open for the R-VPF stage, which is why 10925 and 11100 are here.",
  },
  {
    id: "02-016139",
    label: "02 / 16139",
    description: "A row of garages, a red car parked outside — 8.2% grade, 122° of turn.",
  },
  {
    id: "09-008242",
    label: "09 / 8242",
    description: "A tree-lined street, vans and cars parked along it — 1.1% grade, 135° of turn.",
  },
  {
    id: "06-003489",
    label: "06 / 3489",
    description: "A house and garden behind a low hedge — 2.7% grade, 128° of turn.",
  },
];

/**
 * Every scene shares this pose: a pulled-back, elevated three-quarter view over the origin.
 * KITTI-360's fisheye pair colours the *whole* sweep, not just a forward cone, so unlike the
 * old KITTI odometry candidates there's no single direction worth favouring — an overview
 * that takes in the full ~80 m radius reads better than framing on any one side.
 */
const DEFAULT_VIEW = pose([-22, -19, 19], [0, 0, -2]);

class ComparePage {
  private readonly viewer: Viewer;
  private cloud: CloudView | null = null;
  private current = "";
  private hasFramed = false;

  private readonly strip = document.getElementById("cmp-strip")!;
  private readonly desc = document.getElementById("cmp-desc")!;
  private readonly stats = document.getElementById("cmp-stats")!;
  private readonly info = document.getElementById("cmp-info")!;
  private readonly loading = document.getElementById("loading")!;
  private readonly loadingText = document.getElementById("loading-text")!;

  constructor() {
    applyThemeToCss(THEME);
    const canvas = document.getElementById("view") as HTMLCanvasElement;
    this.viewer = new Viewer(canvas);
    this.viewer.setBackground(THEME.surface);
    this.viewer.onFrame(() => this.tick());
    this.viewer.start();

    for (const scene of SCENES) {
      const b = document.createElement("button");
      b.textContent = scene.label;
      b.addEventListener("click", () => this.select(scene));
      this.strip.appendChild(b);
    }

    void this.select(SCENES[0]);
  }

  /** Nothing here animates frame to frame; the scan just needs its projection kept in sync. */
  private tick(): void {
    if (!this.cloud) return;
    this.cloud.syncProjection(this.viewer.renderer, this.viewer.camera);
    this.cloud.commit();
  }

  private async select(scene: Scene): Promise<void> {
    if (this.current === scene.id) return;
    this.current = scene.id;
    for (const [i, b] of [...this.strip.children].entries()) {
      const el = b as HTMLButtonElement;
      el.classList.toggle("active", SCENES[i].id === scene.id);
      el.disabled = true;
    }

    this.loading.classList.remove("hidden");
    this.loading.style.display = "";
    this.loadingText.textContent = `Fetching ${scene.label}…`;
    this.info.hidden = true;

    const res = await fetch(`${import.meta.env.BASE_URL}data/scene360-${scene.id}.pcq`);
    if (!res.ok) throw new Error(`Failed to load scene360-${scene.id}.pcq: ${res.status}`);
    const buffer = await res.arrayBuffer();
    // A late click while a fetch is in flight should not paint the wrong scene.
    if (this.current !== scene.id) return;

    const points = decodeQuantizedCloud(buffer);

    if (this.cloud) {
      this.viewer.remove(this.cloud.points);
      this.cloud.dispose();
    }
    this.cloud = new CloudView(points);
    // A little larger than the tutorial's own points: nothing here is measuring a plane fit,
    // and real colour reads better as a visible patch than as a scatter of pinpricks.
    this.cloud.worldSize = 0.14;
    this.cloud.setBaseCaptured(THEME.raw);
    this.viewer.add(this.cloud.points);
    // Only reset the camera on the very first load — switching scenes afterwards keeps
    // whatever angle the reader dragged to, so comparing two scenes means one click, not a
    // re-orbit every time.
    if (!this.hasFramed) {
      this.viewer.applyPose(DEFAULT_VIEW);
      this.hasFramed = true;
    }

    const coloured = points.colorMask
      ? Math.round((100 * points.colorMask.reduce((a, b) => a + b, 0)) / points.count)
      : 0;
    this.desc.textContent = scene.description;
    this.stats.textContent = `${points.count.toLocaleString()} points · ${coloured}% seen by the camera`;
    this.info.hidden = false;

    this.loading.classList.add("hidden");
    window.setTimeout(() => {
      this.loading.style.display = "none";
    }, 500);
    for (const b of this.strip.children) {
      (b as HTMLButtonElement).disabled = false;
    }
  }
}

new ComparePage();
