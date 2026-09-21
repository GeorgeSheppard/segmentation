import { Color } from "three";
import { PIPELINE_STEPS, type StepId } from "../patchwork/index.ts";
import { THEME_ORDER, THEMES, type ThemeId } from "../viz/themes.ts";

/** All DOM outside the canvas: titles, step rail, legend, caption, transport. */

export interface LegendItem {
  /** A CSS colour, or the scene Color the swatch must match exactly. */
  color: string | Color;
  label: string;
  note?: string;
}

export interface HudCallbacks {
  onContinue: () => void;
  onPrev: () => void;
  onReplay: () => void;
  onSpeed: (speed: number) => void;
  onJump: (index: number) => void;
  onTheme: (id: ThemeId) => void;
  onRecentre: () => void;
}

const SPEEDS = [0.5, 1, 1.5, 2];

/** How long the touch-gesture hint stays up if nobody touches anything. */
const HINT_MS = 9000;
const HINT_SEEN_KEY = "patchworkpp.gesture-hint-seen";

export class Hud {
  private readonly stepNum = byId("step-num");
  private readonly stepTotal = byId("step-total");
  private readonly title = byId("stage-title");
  private readonly subtitle = byId("stage-subtitle");
  private readonly captionText = byId("caption-text");
  private readonly legend = byId("legend");
  private readonly progressBar = byId("progress-bar");
  private readonly rail = byId("rail");
  private readonly chapters = byId("chapters");
  private readonly themes = byId("themes");
  private readonly chaptersToggle = byId("chapters-toggle") as HTMLButtonElement;
  private readonly themeToggle = byId("theme-toggle") as HTMLButtonElement;
  private readonly themeName = byId("theme-name");
  private readonly btnContinue = byId("btn-continue") as HTMLButtonElement;
  private readonly btnPrev = byId("btn-prev") as HTMLButtonElement;
  private readonly btnReplay = byId("btn-replay") as HTMLButtonElement;
  private readonly btnRecentre = byId("btn-recentre") as HTMLButtonElement;
  private readonly gestureHint = byId("gesture-hint");
  private readonly speedGroup = byId("speed");
  private readonly loading = byId("loading");
  private readonly loadingText = byId("loading-text");
  private readonly verdict: HTMLElement;

  private currentCaption = "";
  private verdictTimer = 0;
  private hintTimer = 0;
  private busy = false;
  private stageIndex = 0;

  constructor(private readonly cb: HudCallbacks) {
    this.verdict = document.createElement("div");
    this.verdict.id = "verdict";
    byId("app").appendChild(this.verdict);

    this.btnContinue.addEventListener("click", () => cb.onContinue());
    this.btnPrev.addEventListener("click", () => cb.onPrev());
    this.btnReplay.addEventListener("click", () => cb.onReplay());
    this.btnRecentre.addEventListener("click", () => cb.onRecentre());

    for (const s of SPEEDS) {
      const b = document.createElement("button");
      b.textContent = `${s}×`;
      b.dataset.speed = String(s);
      b.addEventListener("click", () => {
        cb.onSpeed(s);
        this.setSpeed(s);
      });
      this.speedGroup.appendChild(b);
    }
    this.setSpeed(1);

    this.buildRail();
    this.buildThemes();

    this.chaptersToggle.addEventListener("click", () => {
      const open = this.chapters.hidden;
      this.setPopover(this.chapters, this.chaptersToggle, open);
      if (open) this.setPopover(this.themes, this.themeToggle, false);
    });
    this.themeToggle.addEventListener("click", () => {
      const open = this.themes.hidden;
      this.setPopover(this.themes, this.themeToggle, open);
      if (open) this.setPopover(this.chapters, this.chaptersToggle, false);
    });

    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (this.busy && e.key !== "Escape") return;
    switch (e.key) {
      case " ":
      case "Enter":
      case "ArrowRight":
        e.preventDefault();
        this.cb.onContinue();
        break;
      case "ArrowLeft":
        e.preventDefault();
        this.cb.onPrev();
        break;
      case "r":
      case "R":
        this.cb.onReplay();
        break;
      case "Escape":
        this.setPopover(this.chapters, this.chaptersToggle, false);
        this.setPopover(this.themes, this.themeToggle, false);
        break;
    }
  }

  // ------------------------------------------------------------------ loading

  setLoading(text: string, progress?: number): void {
    this.loadingText.textContent = text;
    const bar = document.getElementById("loading-bar");
    if (!bar) return;
    // Indeterminate until there is something real to report.
    bar.style.opacity = progress === undefined ? "0" : "1";
    bar.style.setProperty("--p", `${Math.round((progress ?? 0) * 100)}%`);
  }

  hideLoading(): void {
    this.loading.classList.add("hidden");
    window.setTimeout(() => {
      this.loading.style.display = "none";
    }, 600);
  }

  /**
   * While the scan is still downloading the page is fully drawn but there is nothing to
   * step through yet, so the transport is held rather than hidden.
   */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.btnContinue.disabled = busy;
    this.btnReplay.disabled = busy;
    this.btnPrev.disabled = busy || this.stageIndex === 0;
  }

  // ------------------------------------------------------------------ camera

  /** The camera is the viewer's while `manual` holds; offer them the way back. */
  setManualCamera(manual: boolean): void {
    this.btnRecentre.hidden = !manual;
    if (manual) this.dismissGestureHint();
  }

  /**
   * Touch devices get one line telling them what their fingers do. It goes away at the
   * first touch, and never comes back once it has been read.
   */
  armGestureHint(): void {
    const touch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!touch || readFlag(HINT_SEEN_KEY)) return;
    this.gestureHint.hidden = false;
    // Next frame, so the transition has a hidden->shown edge to run on.
    requestAnimationFrame(() => this.gestureHint.classList.add("visible"));
    this.hintTimer = window.setTimeout(() => this.dismissGestureHint(), HINT_MS);
  }

  private dismissGestureHint(): void {
    if (this.gestureHint.hidden) return;
    window.clearTimeout(this.hintTimer);
    this.gestureHint.classList.remove("visible");
    writeFlag(HINT_SEEN_KEY);
    window.setTimeout(() => {
      this.gestureHint.hidden = true;
    }, 400);
  }

  // ------------------------------------------------------------------ step rail

  /** The pipeline, always on screen, so "where are we" never needs to be inferred. */
  private buildRail(): void {
    this.rail.replaceChildren();
    for (const step of PIPELINE_STEPS) {
      const li = document.createElement("li");
      li.dataset.step = step.id;
      li.title = `${step.name} — ${step.summary}`;
      li.innerHTML = `<span class="bar"></span><span class="name">${step.name}</span>`;
      this.rail.appendChild(li);
    }
  }

  /** Light the steps this stage covers and mark everything before them as done. */
  setRailSteps(steps: StepId[] | undefined): void {
    const order = PIPELINE_STEPS.map((s) => s.id);
    const active = new Set(steps ?? []);
    const firstIdx = steps?.length ? Math.min(...steps.map((s) => order.indexOf(s))) : -1;

    for (const [i, li] of [...this.rail.children].entries()) {
      const isActive = active.has(order[i]);
      li.classList.toggle("active", isActive);
      li.classList.toggle("done", firstIdx >= 0 && i < firstIdx);
    }
    const lead = this.rail.children[firstIdx] as HTMLElement | undefined;
    lead?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }

  // ------------------------------------------------------------------ stage

  setStage(index: number, total: number, title: string, subtitle: string): void {
    this.stageIndex = index;
    this.stepNum.textContent = String(index + 1);
    this.stepTotal.textContent = String(total);
    this.title.textContent = title;
    this.subtitle.innerHTML = subtitle;
    this.btnPrev.disabled = this.busy || index === 0;
    this.btnContinue.querySelector("span")!.textContent =
      index === total - 1 ? "Start over" : "Continue";
    for (const [i, el] of [...this.chapters.children].entries()) {
      el.classList.toggle("active", i === index);
    }
  }

  setChapters(titles: string[]): void {
    this.chapters.replaceChildren();
    titles.forEach((t, i) => {
      const b = document.createElement("button");
      b.innerHTML = `<span class="idx">${String(i + 1).padStart(2, "0")}</span><span>${t}</span>`;
      b.addEventListener("click", () => {
        this.cb.onJump(i);
        this.setPopover(this.chapters, this.chaptersToggle, false);
      });
      this.chapters.appendChild(b);
    });
  }

  // ------------------------------------------------------------------ themes

  private buildThemes(): void {
    this.themes.replaceChildren();
    for (const id of THEME_ORDER) {
      const theme = THEMES[id];
      const b = document.createElement("button");
      b.dataset.theme = id;
      b.innerHTML =
        `<span class="dots">` +
        `<i style="background:${theme.ground}"></i>` +
        `<i style="background:${theme.nonGround}"></i>` +
        `<i style="background:${theme.focus}"></i>` +
        `</span><span>${theme.name}<span class="meta">${theme.note}</span></span>`;
      b.addEventListener("click", () => {
        this.cb.onTheme(id);
        this.setPopover(this.themes, this.themeToggle, false);
      });
      this.themes.appendChild(b);
    }
  }

  setTheme(id: ThemeId): void {
    this.themeName.textContent = THEMES[id].name;
    for (const el of this.themes.children) {
      el.classList.toggle("active", (el as HTMLElement).dataset.theme === id);
    }
  }

  private setPopover(panel: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  // ------------------------------------------------------------------ caption

  setCaption(text: string): void {
    if (text === this.currentCaption) return;
    this.currentCaption = text;
    if (!text) {
      this.captionText.classList.remove("visible");
      return;
    }
    this.captionText.classList.remove("visible");
    // Let the fade-out land before swapping the text.
    window.setTimeout(() => {
      if (this.currentCaption !== text) return;
      this.captionText.innerHTML = text;
      this.captionText.classList.add("visible");
    }, 130);
  }

  /**
   * A loud, short-lived call-out for the moment a step decides something.
   * Passing null clears it immediately (used when a stage is rebuilt).
   */
  showVerdict(text: string | null, tone: "good" | "bad" | "focus" = "focus"): void {
    window.clearTimeout(this.verdictTimer);
    if (!text) {
      this.verdict.classList.remove("visible");
      return;
    }
    this.verdict.className = tone;
    this.verdict.textContent = text;
    // Force a reflow so re-showing the same text replays the transition.
    void this.verdict.offsetWidth;
    this.verdict.classList.add("visible");
    this.verdictTimer = window.setTimeout(() => {
      this.verdict.classList.remove("visible");
    }, 2600);
  }

  // ------------------------------------------------------------------ panels

  setLegend(items: LegendItem[] | null): void {
    if (!items || items.length === 0) {
      this.legend.hidden = true;
      return;
    }
    this.legend.hidden = false;
    this.legend.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "row";
      const css = toCss(item.color);
      // The note is its own element so a phone can drop it and keep the strip to one line.
      row.innerHTML =
        `<span class="swatch" style="background:${css};color:${css}"></span>` +
        `<strong>${item.label}</strong>${item.note ? `<i>— ${item.note}</i>` : ""}`;
      this.legend.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ transport

  setProgress(p: number): void {
    this.progressBar.style.width = `${Math.round(p * 100)}%`;
  }

  setFinished(finished: boolean): void {
    this.btnContinue.classList.toggle("pulse", finished);
  }

  private setSpeed(speed: number): void {
    for (const b of this.speedGroup.children) {
      b.classList.toggle("active", (b as HTMLElement).dataset.speed === String(speed));
    }
  }
}

/** Storage is a nicety here: a browser that refuses it just shows the hint again. */
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string): void {
  try {
    window.localStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

function toCss(color: string | Color): string {
  return typeof color === "string" ? color : `#${color.getHexString()}`;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}
