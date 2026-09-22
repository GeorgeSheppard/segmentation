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
 * All ten are the same street as 11000 (the pick two rounds ago) and 10925 (the pick one
 * round ago) — 11000 turned out too open for R-VPF, and 10925 turned out to have zero
 * reflected-noise points for the RNR stage. These ten were found by scanning ~150 frames
 * along the same street for ones with *both* real R-VPF peeling and real RNR noise, so
 * every one of them can actually run the whole tutorial — this round is purely "which do
 * you like the look of."
 */
interface Scene {
  id: string;
  label: string;
  description: string;
}

const SCENES: Scene[] = [
  {
    id: "02-010880",
    label: "02 / 10880",
    description:
      "A red-flowered hedge along the street, houses beyond — 10.9% grade, the steepest of the ten.",
  },
  {
    id: "02-010860",
    label: "02 / 10860",
    description:
      "A sharp-edged modern house at a junction, a flowering shrub by the garage — wide turn.",
  },
  {
    id: "02-010640",
    label: "02 / 10640",
    description: "A modern house behind a curved stone wall, manicured hedges and topiary.",
  },
  {
    id: "02-010600",
    label: "02 / 10600",
    description: "A textured stone retaining wall right at the roadside, hedges above it.",
  },
  {
    id: "02-010580",
    label: "02 / 10580",
    description: "A stone garden wall and hedge, a car parked in the drive — 3.1% grade.",
  },
  {
    id: "02-011200",
    label: "02 / 11200",
    description:
      "A blue delivery truck and a van parked in a driveway, red-roofed houses — 5.2% grade.",
  },
  {
    id: "02-011220",
    label: "02 / 11220",
    description: "The same trucks, much closer — an electrician's van fills half the shot.",
  },
  {
    id: "02-011280",
    label: "02 / 11280",
    description: "A parked Audi, a graffitied truck, a brick wall and houses — 5.2% grade.",
  },
  {
    id: "02-011300",
    label: "02 / 11300",
    description: "A row of garages, a white VW Beetle, red-tiled roofs — 5.4% grade.",
  },
  {
    id: "02-011320",
    label: "02 / 11320",
    description: "A brick driveway lined with flowers, garages either side — 4.5% grade.",
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
