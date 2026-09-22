import "./style.css";
import "./compare.css";
import { decodeQuantizedCloud } from "./core/pcq.ts";
import { applyThemeToCss, THEME } from "./viz/themes.ts";
import { CloudView } from "./viz/cloud.ts";
import { Viewer, pose } from "./viz/viewer.ts";

/**
 * A standalone comparison page: real camera colour, four candidate KITTI frames, nothing
 * else. It shares the tutorial's Viewer and CloudView so what you see here is exactly what
 * the tutorial would render, but skips the stage/timeline machinery entirely — the point is
 * to look at a scene and decide, not to walk through the algorithm on all four at once.
 */
interface Scene {
  id: string;
  label: string;
  description: string;
}

const SCENES: Scene[] = [
  {
    id: "00-003433",
    label: "00 / 3433",
    description: "A residential street bending past a corner house — 7.2% grade, 45° of turn.",
  },
  {
    id: "02-003406",
    label: "02 / 3406",
    description: "A walled junction under autumn hedgerow — 7.5% grade, 49° of turn.",
  },
  {
    id: "09-000297",
    label: "09 / 297",
    description: "A visibly cresting, curving suburban road — 12.2% grade, 18° of turn.",
  },
  {
    id: "10-000865",
    label: "10 / 865",
    description: "A tight bend squeezed between apartment buildings — 10.1% grade, 59° of turn.",
  },
];

/**
 * Every scene shares this pose: a driver's-eye three-quarter view looking down the camera's
 * own forward cone, close enough that the real colour reads as colour and not a smudge.
 * Hand-tuned per-scene poses looked worse — each one is centred at the origin with the same
 * forward axis, so one good angle on that cone works for all four.
 */
const DEFAULT_VIEW = pose([-9, -5, 5], [20, 2, -1.5]);

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

    const res = await fetch(`${import.meta.env.BASE_URL}data/scene-${scene.id}.pcq`);
    if (!res.ok) throw new Error(`Failed to load scene-${scene.id}.pcq: ${res.status}`);
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
    this.cloud.worldSize = 0.09;
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
