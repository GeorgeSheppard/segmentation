import { Color } from "three";
import { PIPELINE_STEPS, type StepId } from "../patchwork/index.ts";

/** All DOM outside the canvas: header, step rail, stage panel, transport. */

export interface LegendItem {
  /** A CSS colour, or the scene Color the swatch must match exactly. */
  color: string | Color;
  label: string;
  note?: string;
}

/** One row of the stage panel's parameter list: what it is, its name in the code, its value. */
export interface ParamRow {
  label: string;
  key: string;
  value: string;
}

/** One test in a stage's checklist, and how it has come out so far. */
export interface CheckRow {
  label: string;
  state: "pending" | "pass" | "fail";
}

/** What the stage panel needs to know about a stage. */
export interface StageInfo {
  title: string;
  /** What the acronym in the title stands for, when the title does not already say. */
  fullName?: string;
  steps?: StepId[];
}

/** What the transport button does right now, and what it shows for it. */
export type TransportState = "play" | "pause" | "next" | "explore";

export interface HudCallbacks {
  onPlayPause: () => void;
  /** The reader clicked (or dragged to) this fraction [0, 1] of the current stage. */
  onSeek: (fraction: number) => void;
  onPrev: () => void;
  onReplay: () => void;
  onJump: (index: number) => void;
  onRecentre: () => void;
  onRestart: () => void;
}

/** Earlier lines of narration kept on screen above the current one. */
const HISTORY_LINES = 2;

const SCOPE_LABEL = { frame: "whole scan", cell: "per cell", ring: "per ring" } as const;

const CHECK_LABEL = { pending: "—", pass: "Pass", fail: "Fail" } as const;

const VERDICT_ICON = {
  good: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>`,
  bad: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>`,
  focus: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 17h.01" /></svg>`,
} as const;

/** How long the touch-gesture hint stays up if nobody touches anything. */
const HINT_MS = 9000;
const HINT_SEEN_KEY = "patchworkpp.gesture-hint-seen";

export class Hud {
  private readonly stepNum = byId("step-num");
  private readonly stepTotal = byId("step-total");
  private readonly scope = byId("stage-scope");
  private readonly title = byId("stage-title");
  private readonly subtitle = byId("stage-subtitle");
  private readonly chaptersCount = byId("chapters-count");
  private readonly captionHistory = byId("caption-history");
  private readonly captionText = byId("caption-text");
  private readonly legend = byId("legend");
  private readonly checks = byId("checks");
  private readonly checksTitle = byId("checks-title");
  private readonly params = byId("params");
  private readonly progress = byId("progress");
  private readonly progressBar = byId("progress-bar");
  private readonly progressThumb = byId("progress-thumb");
  private readonly progressPreview = byId("progress-preview");
  private readonly timeElapsed = byId("time-elapsed");
  private readonly timeTotal = byId("time-total");
  private readonly rail = byId("rail");
  private readonly chapters = byId("chapters");
  private readonly chaptersToggle = byId("chapters-toggle") as HTMLButtonElement;
  private readonly shortcuts = byId("shortcuts");
  private readonly shortcutsToggle = byId("shortcuts-toggle") as HTMLButtonElement;
  private readonly btnPlay = byId("btn-play") as HTMLButtonElement;
  private readonly btnPrev = byId("btn-prev") as HTMLButtonElement;
  private readonly btnReplay = byId("btn-replay") as HTMLButtonElement;
  private readonly btnRecentre = byId("btn-recentre") as HTMLButtonElement;
  private readonly btnRestart = byId("btn-restart") as HTMLButtonElement;
  private readonly app = byId("app");
  private readonly gestureHint = byId("gesture-hint");
  private readonly loading = byId("loading");
  private readonly loadingText = byId("loading-text");
  private readonly verdict: HTMLElement;

  private currentCaption = "";
  /** Every line this stage has said so far, oldest first; the last one is on screen. */
  private captions: string[] = [];
  private verdictTimer = 0;
  private hintTimer = 0;
  private busy = false;
  private exploring = false;
  private stageIndex = 0;
  /** Where each line of narration lands, as fractions of the stage — snap targets, not drawn. */
  private checkpoints: number[] = [];
  private duration = 0;
  private scrubbing = false;

  constructor(private readonly cb: HudCallbacks) {
    this.verdict = document.createElement("div");
    this.verdict.id = "verdict";
    this.verdict.setAttribute("role", "status");
    byId("stage").appendChild(this.verdict);

    this.btnPlay.addEventListener("click", () => {
      this.dismissGestureHint();
      cb.onPlayPause();
    });
    this.btnPrev.addEventListener("click", () => cb.onPrev());
    this.btnReplay.addEventListener("click", () => cb.onReplay());
    this.btnRecentre.addEventListener("click", () => cb.onRecentre());
    this.btnRestart.addEventListener("click", () => cb.onRestart());

    // Click (or drag) anywhere on the bar to jump straight there, snapping to the start of a
    // line of narration when the pointer lands close enough to one, so a seek never lands
    // mid-sentence. Hovering first (mouse only; touch has no hover) previews exactly where
    // that click would land, before it happens.
    this.progress.addEventListener("pointerdown", (e) => this.beginScrub(e));
    this.progress.addEventListener("pointermove", (e) => {
      if (this.scrubbing) return;
      this.showPreview(e.clientX);
    });
    this.progress.addEventListener("pointerleave", () => {
      if (this.scrubbing) return;
      this.hidePreview();
    });

    this.buildRail();

    this.chaptersToggle.addEventListener("click", () => {
      this.setPopover(this.shortcuts, this.shortcutsToggle, false);
      this.setPopover(this.chapters, this.chaptersToggle, this.chapters.hidden);
    });
    this.shortcutsToggle.addEventListener("click", () => {
      this.setPopover(this.chapters, this.chaptersToggle, false);
      this.setPopover(this.shortcuts, this.shortcutsToggle, this.shortcuts.hidden);
    });
    // A press anywhere else closes whichever menu is open.
    document.addEventListener("pointerdown", (e) => {
      const target = e.target as Node;
      for (const [panel, toggle] of [
        [this.chapters, this.chaptersToggle],
        [this.shortcuts, this.shortcutsToggle],
      ] as const) {
        if (!panel.hidden && !panel.contains(target) && !toggle.contains(target)) {
          this.setPopover(panel, toggle, false);
        }
      }
    });

    document.addEventListener("keydown", (e) => this.onKey(e));
  }

  private onKey(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement) return;
    if (this.exploring) return;
    if (this.busy && e.key !== "Escape") return;
    switch (e.key) {
      case " ":
      case "Enter":
      case "ArrowRight":
        e.preventDefault();
        this.cb.onPlayPause();
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
        this.setPopover(this.shortcuts, this.shortcutsToggle, false);
        break;
    }
  }

  /**
   * A drag scrubs the whole bar the same way a click does: each move reports the fraction
   * under the pointer, coalesced to one report per frame so a fast drag doesn't flood the
   * caller with seeks the render loop can't keep up with.
   */
  private beginScrub(down: PointerEvent): void {
    if (this.busy) return;
    this.dismissGestureHint();
    const el = this.progress;
    el.setPointerCapture(down.pointerId);
    this.scrubbing = true;
    let pending: number | null = null;
    let raf = 0;

    const report = (e: PointerEvent) => {
      pending = this.snapTarget(e.clientX);
      this.showPreview(e.clientX);
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (pending !== null) this.cb.onSeek(pending);
      });
    };
    const onMove = (e: PointerEvent) => report(e);
    const onUp = (e: PointerEvent) => {
      report(e);
      this.scrubbing = false;
      this.hidePreview();
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    report(down);
  }

  /**
   * The bar position under `clientX`, snapped to the nearest checkpoint (or either end) if
   * the pointer is within `SNAP_PX` of it. A fixed pixel radius, not a fraction of the bar's
   * width, so a snap point is exactly as easy to hit on a short bar as a long one.
   */
  private snapTarget(clientX: number): number {
    const SNAP_PX = 16;
    const rect = this.progress.getBoundingClientRect();
    const raw = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const clamped = Math.max(0, Math.min(1, raw));

    let best = clamped;
    let bestPx = SNAP_PX;
    for (const f of [0, 1, ...this.checkpoints]) {
      const px = Math.abs(f - clamped) * rect.width;
      if (px < bestPx) {
        bestPx = px;
        best = f;
      }
    }
    return best;
  }

  /** Show, at `clientX`, exactly where releasing the pointer now would land. */
  private showPreview(clientX: number): void {
    this.progressPreview.style.left = `${this.snapTarget(clientX) * 100}%`;
    this.progressPreview.classList.add("visible");
  }

  private hidePreview(): void {
    this.progressPreview.classList.remove("visible");
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
    this.btnPlay.disabled = busy;
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
   * Nothing here waits for a click to keep going — the tour plays itself — so first-time
   * visitors get one line saying so, plus how to steer: drag the scene, or drag the
   * timeline. It goes away at the first sign they've found either, and never comes back
   * once it's been read.
   */
  armGestureHint(): void {
    if (readFlag(HINT_SEEN_KEY)) return;
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
    for (const [i, step] of PIPELINE_STEPS.entries()) {
      const li = document.createElement("li");
      li.dataset.step = step.id;
      li.title = `${step.name} — ${step.summary}`;
      li.innerHTML =
        `<span class="bar"></span>` +
        `<span class="name"><span class="num">${i + 1}</span>${step.name}</span>`;
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
  }

  // ------------------------------------------------------------------ stage

  setStage(index: number, total: number, stage: StageInfo): void {
    this.stageIndex = index;
    this.stepNum.textContent = String(index + 1);
    this.stepTotal.textContent = String(total);
    this.chaptersCount.textContent = `${index + 1} of ${total}`;

    const scope = stage.steps?.length
      ? PIPELINE_STEPS.find((s) => s.id === stage.steps![0])?.scope
      : undefined;
    this.scope.textContent = scope ? ` · ${SCOPE_LABEL[scope]}` : "";

    // "R-GPF — fit, re-select, repeat" becomes the acronym as the heading, with what it
    // stands for and what it does underneath.
    const [head, tail] = stage.title.split(" — ");
    this.title.textContent = head;
    const sub = tail ? (stage.fullName ? `${stage.fullName} — ${tail}` : capitalise(tail)) : "";
    this.subtitle.textContent = sub;
    this.subtitle.hidden = !sub;

    this.btnPrev.disabled = this.busy || index === 0;
    for (const [i, el] of [...this.chapters.querySelectorAll("button")].entries()) {
      el.classList.toggle("active", i === index);
      el.classList.toggle("seen", i < index);
      el.toggleAttribute("aria-current", i === index);
    }
  }

  setChapters(titles: string[]): void {
    this.chapters.replaceChildren();
    const heading = document.createElement("p");
    heading.className = "popover-title";
    heading.textContent = "Chapters";
    this.chapters.appendChild(heading);
    titles.forEach((t, i) => {
      const b = document.createElement("button");
      b.innerHTML =
        `<span class="idx">${i + 1}</span><span class="name">${t}</span>` +
        `<svg class="seen-mark" viewBox="0 0 24 24" role="img" aria-label="Seen"><path d="M5 12l5 5 9-10" /></svg>`;
      b.addEventListener("click", () => {
        this.cb.onJump(i);
        this.setPopover(this.chapters, this.chaptersToggle, false);
      });
      this.chapters.appendChild(b);
    });
  }

  private setPopover(panel: HTMLElement, toggle: HTMLButtonElement, open: boolean): void {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  }

  // ------------------------------------------------------------------ caption

  /**
   * The current line of narration. Earlier lines of the same stage stay above it, faded,
   * so the reader can glance back at what was just said; an empty string starts the stage
   * afresh.
   */
  setCaption(text: string): void {
    if (text === this.currentCaption) return;
    this.currentCaption = text;
    if (!text) {
      this.captions = [];
      this.captionHistory.replaceChildren();
      this.captionText.classList.remove("visible");
      this.captionText.innerHTML = "";
      return;
    }
    this.captions.push(text);
    this.captionHistory.replaceChildren(
      ...this.captions.slice(-1 - HISTORY_LINES, -1).map((line) => {
        const p = document.createElement("p");
        p.innerHTML = line;
        return p;
      }),
    );
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
    // "Rejected — not upright": the outcome as a label, the reason beside it.
    const [label, detail] = text.includes(" — ") ? text.split(" — ") : ["", text];
    this.verdict.className = tone;
    this.verdict.innerHTML =
      `<span class="icon">${VERDICT_ICON[tone]}</span>` +
      (label ? `<span class="label">${label}</span>` : "") +
      `<span class="detail">${capitalise(detail)}</span>`;
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
    const rows = this.legend.querySelector(".rows")!;
    rows.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "row";
      // The note is its own element so a phone can drop it and keep the key to one line.
      // It is always there, empty or not, so every row fills the same three columns.
      row.innerHTML =
        `<span class="swatch" style="background:${toCss(item.color)}"></span>` +
        `<strong>${capitalise(item.label)}</strong>` +
        `<i>${item.note ?? ""}</i>`;
      rows.appendChild(row);
    }
  }

  /** A stage's tests and how each has come out so far; null hides the list. */
  setChecks(title: string, rows: CheckRow[]): void;
  setChecks(title: null): void;
  setChecks(title: string | null, rows: CheckRow[] = []): void {
    this.checks.hidden = title === null;
    if (title === null) return;
    this.checksTitle.textContent = title;
    const list = this.checks.querySelector("ol")!;
    list.replaceChildren();
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.className = r.state;
      li.innerHTML =
        `<span class="idx">${i + 1}</span><span class="name">${r.label}</span>` +
        `<span class="state">${CHECK_LABEL[r.state]}</span>`;
      list.appendChild(li);
    });
  }

  /** The parameters this stage turns on, as the code names them; null hides the list. */
  setParams(rows: ParamRow[] | null): void {
    this.params.hidden = !rows?.length;
    const list = this.params.querySelector("dl")!;
    list.replaceChildren();
    for (const r of rows ?? []) {
      const dt = document.createElement("dt");
      dt.innerHTML = `${r.label} <code>${r.key}</code>`;
      const dd = document.createElement("dd");
      dd.textContent = r.value;
      list.append(dt, dd);
    }
  }

  // ------------------------------------------------------------------ transport

  setProgress(p: number): void {
    this.progressBar.style.width = `${Math.round(p * 100)}%`;
    this.progressThumb.style.left = `${p * 100}%`;
    this.timeElapsed.textContent = formatTime(p * this.duration);
  }

  /** The current stage's length in seconds, for the time read-outs either side of the bar. */
  setDuration(seconds: number): void {
    this.duration = seconds;
    this.timeTotal.textContent = formatTime(seconds);
  }

  /** Where each line of narration lands — never drawn, but the scrubber snaps to them. */
  setCheckpoints(fractions: number[]): void {
    this.checkpoints = fractions;
  }

  /**
   * What the transport button does right now: invite a play (or a next-stage / explore tap)
   * with the idle pulse, or show a plain pause glyph while it is actually playing and there
   * is nothing for the reader to do.
   */
  setTransport(state: TransportState): void {
    this.btnPlay.dataset.state = state;
    this.btnPlay.classList.toggle("pulse", state !== "pause");
    this.btnPlay.querySelector("span")!.textContent =
      state === "play"
        ? "Play"
        : state === "pause"
          ? "Pause"
          : state === "next"
            ? "Continue"
            : "Explore";
  }

  /**
   * One distinct beat per press, independent of the idle "waiting" pulse: the reader should
   * always feel a click on the transport land, whatever it does next.
   */
  flashPlay(): void {
    this.btnPlay.classList.remove("flash");
    // Force a reflow so back-to-back clicks each restart the animation from scratch.
    void this.btnPlay.offsetWidth;
    this.btnPlay.classList.add("flash");
  }

  // ------------------------------------------------------------------ explore

  /**
   * The tour is done. Every band steps aside — header, rail, stage panel, transport — and
   * only the Restart button remains, so the finished scene is the whole screen and dragging
   * it is the only thing left to do.
   */
  setExploring(exploring: boolean): void {
    this.exploring = exploring;
    this.app.classList.toggle("exploring", exploring);
    this.btnRestart.hidden = !exploring;
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

/** Seconds as m:ss, floored so the read-out ticks over the way a media player's does. */
function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toCss(color: string | Color): string {
  return typeof color === "string" ? color : `#${color.getHexString()}`;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
}
